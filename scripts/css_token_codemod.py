#!/usr/bin/env python3
"""Token-centralization codemod for src/App.css.

Replaces hard-coded hex colours that are *exact duplicates* of existing design tokens with
`var(--token)` references, so token refinements propagate consistently. Values are identical to
the token values at the time of the codemod, so the rendered result is unchanged until tokens are
refined. Property-aware and theme-context-aware:

* dark rules  = every selector in the list contains `.gp-dark-mode`
* light rules = no selector contains `.gp-dark-mode` and the rule is not nested in a
  `prefers-color-scheme` / `forced-colors` / `print` at-rule
Mixed selector lists, :root blocks, @font-face/@property and keyframe steps are left alone.
"""
import re
import sys
from collections import Counter

PATH = sys.argv[1]
src = open(PATH, encoding='utf8').read()

DARK = {
    'bg': {
        '#131314': 'var(--gp-bg-window)',
        '#1e1f20': 'var(--gp-bg-canvas)',
        '#18191b': 'var(--gp-bg-panel)',
        '#23262b': 'var(--gp-bg-elevated)',
        '#282a2c': 'var(--mbc-surface-hover)',
        '#1b3a6b': 'var(--gp-bg-selected)',
    },
    'border': {
        '#3c4043': 'var(--gp-border)',
        '#2d2f31': 'var(--gp-border-light)',
        '#8ab4f8': 'var(--gp-blue)',
    },
    'color': {
        '#e3e3e3': 'var(--gp-text-main)',
        '#c4c7c5': 'var(--gp-text-secondary)',
        '#9aa0a6': 'var(--gp-text-muted)',
        '#8ab4f8': 'var(--gp-blue)',
        '#d3e3fd': 'var(--gp-text-selected)',
    },
}
LIGHT = {
    'bg': {
        '#ffffff': 'var(--gp-bg-canvas)',
        '#fff': 'var(--gp-bg-canvas)',
        '#f4f7fc': 'var(--gp-bg-panel)',
        '#f0f4f9': 'var(--gp-bg-toolbar)',
        '#eaf1fb': 'var(--gp-bg-elevated)',
        '#e8f0fe': 'var(--gp-bg-selected-soft)',
        '#d3e3fd': 'var(--gp-bg-selected)',
        '#f5f8fd': 'var(--gp-bg-canvas-muted)',
    },
    'border': {
        '#c4d1e3': 'var(--gp-border)',
        '#e1e8f2': 'var(--gp-border-light)',
        '#1a73e8': 'var(--gp-blue)',
    },
    'color': {
        '#1f1f1f': 'var(--gp-text-main)',
        '#444746': 'var(--gp-text-secondary)',
        '#5f6368': 'var(--gp-text-muted)',
        '#1a73e8': 'var(--gp-blue)',
        '#041e49': 'var(--gp-text-selected)',
    },
}


def category(prop):
    prop = prop.strip().lower()
    if prop in ('background', 'background-color'):
        return 'bg'
    if prop.startswith('border') or prop.startswith('outline'):
        return 'border'
    if prop in ('color', 'fill', 'stroke', 'caret-color', 'text-decoration-color'):
        return 'color'
    return None


HEX_RE = re.compile(r'#[0-9a-fA-F]{3,8}\b')
stats = Counter()


def rewrite_decls(body, table):
    if 'data:' in body or 'gradient' in body and False:
        return body
    out = []
    for decl in re.split(r'(;)', body):
        if ':' not in decl or decl == ';':
            out.append(decl)
            continue
        prop, _, value = decl.partition(':')
        cat = category(prop)
        if cat is None or 'gradient' in value:
            out.append(decl)
            continue
        mapping = table[cat]

        def sub(m):
            key = m.group(0).lower()
            if key in mapping:
                stats[(cat, key)] += 1
                return mapping[key]
            return m.group(0)

        out.append(prop + ':' + HEX_RE.sub(sub, value))
    return ''.join(out)


def strip_comments(s):
    return re.sub(r'/\*.*?\*/', '', s, flags=re.S)


def split_selectors(sel):
    parts, depth, cur = [], 0, ''
    for ch in sel:
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        if ch == ',' and depth == 0:
            parts.append(cur)
            cur = ''
        else:
            cur += ch
    parts.append(cur)
    return [p.strip() for p in parts if p.strip()]


out = []
stack = []  # preludes of open blocks
i, n = 0, len(src)
buf_start = 0
while i < n:
    if src.startswith('/*', i):
        j = src.find('*/', i + 2)
        i = j + 2
        continue
    ch = src[i]
    if ch == '{':
        prelude_raw = src[buf_start:i]
        prelude = strip_comments(prelude_raw).strip()
        # Is this an innermost declaration block? Look ahead for '}' before any '{'.
        j = i + 1
        depth_ok = True
        k = j
        while k < n:
            if src.startswith('/*', k):
                k = src.find('*/', k + 2) + 2
                continue
            if src[k] == '{':
                depth_ok = False
                break
            if src[k] == '}':
                break
            k += 1
        if depth_ok and not prelude.startswith('@'):
            body = src[j:k]
            ctx = ' '.join(stack)
            sels = split_selectors(prelude)
            skip = (
                not sels
                or any(s.startswith(':root') for s in sels)
                or re.match(r'^(from|to|\d+(\.\d+)?%)\b', prelude)
                or re.search(r'prefers-color-scheme|forced-colors|print|@keyframes', ctx)
            )
            new_body = body
            if not skip:
                darks = [('.gp-dark-mode' in s) for s in sels]
                if all(darks):
                    new_body = rewrite_decls(body, DARK)
                elif not any(darks):
                    new_body = rewrite_decls(body, LIGHT)
            out.append(src[buf_start:j])
            out.append(new_body)
            out.append('}')
            i = k + 1
            buf_start = i
            continue
        stack.append(prelude)
        out.append(src[buf_start:i + 1])
        i += 1
        buf_start = i
        continue
    if ch == '}':
        if stack:
            stack.pop()
        out.append(src[buf_start:i + 1])
        i += 1
        buf_start = i
        continue
    i += 1
out.append(src[buf_start:])
result = ''.join(out)
assert result.count('{') == src.count('{') and result.count('}') == src.count('}')
open(PATH, 'w', encoding='utf8').write(result)
total = sum(stats.values())
print('replacements:', total)
for (cat, key), c in stats.most_common():
    print(f'  {cat:6} {key:8} x{c}')
