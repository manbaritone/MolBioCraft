// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The live DOM: the node tree, window and browser environment React DOM's client renderer writes to
 * when a test mounts the App with `createRoot`, the renderer the app itself runs. The repo carries no
 * DOM library (jsdom, happy-dom), so the browser is modelled here. It is copied from the live trees of
 * documentTableBottom.test.tsx (nodes, events along the path, focus) and alignmentPaneResize.test.tsx
 * (inline styles, animation frames, resize observers, memory and blocked storage), which keep their
 * own copies, and extended to what the whole App and its studios use:
 *
 * - events run along the target's path to the window, capture listeners from the window down and
 *   bubble listeners back up (only for an event that bubbles); a passive listener cannot cancel one;
 * - a click carries the browser's activation behaviour: a checkbox or radio flips before the click
 *   and back if it is cancelled, a submit button submits its form, a label clicks its control, and a
 *   link with `download` hands its file to the document's download list;
 * - fields keep their value and checkedness as properties on the element prototype, as a browser
 *   does, so React DOM's value tracker works; a select's value is its selected option's;
 * - focus is the element `focus()` was last called on, while it can take focus and stays in the
 *   tree (the focus fixup rule); no focus events are fired;
 * - one selector engine (tags, ids, classes, attributes, the four combinators and the structural,
 *   form-state and logical pseudo-classes) serves querySelectorAll, matches and closest, and the
 *   App.css cascade reader (cssCascade.ts). A part it cannot evaluate makes the match unknown, which
 *   querySelectorAll reports by name instead of guessing;
 * - the window reports a desktop browser environment (light theme, no motion or contrast
 *   preference, a fine pointer that can hover) to matchMedia, through the same media-query evaluator
 *   the cascade reader uses;
 * - layout is a function the test supplies (`LiveDocument.layout`); by default every box is 0 x 0.
 *   Element sizes, getBoundingClientRect and the ResizeObserver stand-in all read it;
 * - nodes clone (`cloneNode`) and serialise (`LiveXMLSerializer`, `innerHTML`), and `innerHTML` parses
 *   well-formed markup.
 *
 * Not modelled: text layout, scrolling, CSS on elements (getComputedStyle reports nothing; the cascade
 * reader answers for App.css), canvas drawing (getContext gives null), focus events, and navigation.
 */

export const XHTML_NS = 'http://www.w3.org/1999/xhtml';
export const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

// ─── Events ───

/** An event as the live tree delivers it: the fields of the browser event a listener reads. */
export interface LiveEvent {
  type: string;
  target: LiveEventTarget;
  currentTarget: LiveEventTarget | null;
  bubbles: boolean;
  cancelable: boolean;
  defaultPrevented: boolean;
  eventPhase: number;
  timeStamp: number;
  isTrusted: boolean;
  preventDefault(): void;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
  composedPath(): LiveEventTarget[];
  getModifierState(key: string): boolean;
  [field: string]: unknown;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ListenerFn = (ev: any) => void;
interface Registration { type: string; fn: ListenerFn; capture: boolean; passive: boolean; once: boolean }
const optionFlag = (options: unknown, key: 'capture' | 'passive' | 'once') =>
  typeof options === 'object' && options !== null && Boolean((options as Record<string, unknown>)[key]);
const isCapture = (options: unknown) => options === true || optionFlag(options, 'capture');

/** Events a browser creates that do not bubble, and those that cannot be cancelled. */
const NON_BUBBLING = new Set(['focus', 'blur', 'mouseenter', 'mouseleave', 'pointerenter', 'pointerleave', 'load', 'unload', 'scroll', 'scrollend', 'resize', 'close', 'cancel', 'toggle', 'invalid']);
const NON_CANCELABLE = new Set(['input', 'change', 'focus', 'blur', 'focusin', 'focusout', 'scroll', 'scrollend', 'load', 'resize', 'mouseenter', 'mouseleave', 'pointerenter', 'pointerleave', 'close', 'toggle', 'select']);

/** Per-dispatch flags the event's own methods set. */
interface DispatchState { stopped: boolean; immediate: boolean; passive: boolean }
const DISPATCH = new WeakMap<LiveEvent, DispatchState>();

export class LiveEventTarget {
  private readonly registrations: Registration[] = [];
  addEventListener(type: string, fn: ListenerFn | null | undefined, options?: boolean | AddEventListenerOptions) {
    if (typeof fn !== 'function') return;
    const capture = isCapture(options);
    if (this.registrations.some((r) => r.type === type && r.fn === fn && r.capture === capture)) return;
    this.registrations.push({ type, fn, capture, passive: optionFlag(options, 'passive'), once: optionFlag(options, 'once') });
  }
  removeEventListener(type: string, fn: ListenerFn | null | undefined, options?: boolean | EventListenerOptions) {
    const capture = isCapture(options);
    const at = this.registrations.findIndex((r) => r.type === type && r.fn === fn && r.capture === capture);
    if (at >= 0) this.registrations.splice(at, 1);
  }
  /** Runs this target's listeners for `ev` in one pass: the capture listeners, or the others. */
  fire(ev: LiveEvent, capture: boolean) {
    const state = DISPATCH.get(ev);
    for (const r of [...this.registrations]) {
      if (r.type !== ev.type || r.capture !== capture || !this.registrations.includes(r)) continue;
      if (r.once) this.removeEventListener(r.type, r.fn, r.capture);
      ev.currentTarget = this;
      if (state) state.passive = r.passive;
      try {
        r.fn.call(this, ev);
      } finally {
        if (state) state.passive = false;
      }
      if (state?.immediate) return;
    }
  }
  /**
   * Delivers an event made with the platform's constructors (`new CustomEvent(...)`, as App code
   * makes them) along this target's path, with its type, detail and flags.
   */
  dispatchEvent(event: Event): boolean {
    const init: Record<string, unknown> = { bubbles: event.bubbles, cancelable: event.cancelable };
    if ('detail' in event) init.detail = (event as CustomEvent).detail;
    const ev = dispatchLiveEvent(this, event.type, init);
    if (ev.defaultPrevented && event.cancelable) event.preventDefault();
    return !ev.defaultPrevented;
  }
}

/** The event path: the target, its ancestors and, for a node in a document with a window, the window. */
function eventPath(target: LiveEventTarget): LiveEventTarget[] {
  const path: LiveEventTarget[] = [];
  let top: LiveEventTarget = target;
  for (let n: LiveNode | null = target instanceof LiveNode ? target : null; n; n = n.parentNode) { path.push(n); top = n; }
  if (!(target instanceof LiveNode)) path.push(target);
  else if (top instanceof LiveDocument && top.defaultView) path.push(top.defaultView);
  return path;
}

/**
 * Delivers an event of `type` to `target` along its path, capture then bubble, and returns it. `init`
 * gives the event's own fields (key, modifiers, pointer, detail) and may set `bubbles` or `cancelable`.
 */
export function dispatchLiveEvent(target: LiveEventTarget, type: string, init: Record<string, unknown> = {}): LiveEvent {
  const path = eventPath(target);
  const state: DispatchState = { stopped: false, immediate: false, passive: false };
  const ev: LiveEvent = {
    button: 0, buttons: 0, detail: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    clientX: 0, clientY: 0, screenX: 0, screenY: 0, pageX: 0, pageY: 0, relatedTarget: null,
    ...init,
    type,
    target,
    currentTarget: null,
    bubbles: typeof init.bubbles === 'boolean' ? init.bubbles : !NON_BUBBLING.has(type),
    cancelable: typeof init.cancelable === 'boolean' ? init.cancelable : !NON_CANCELABLE.has(type),
    defaultPrevented: false,
    eventPhase: 0,
    timeStamp: performance.now(),
    isTrusted: true,
    preventDefault() { if (ev.cancelable && !state.passive) ev.defaultPrevented = true; },
    stopPropagation() { state.stopped = true; },
    stopImmediatePropagation() { state.stopped = true; state.immediate = true; },
    composedPath: () => [...path],
    getModifierState: (key: string) => (
      key === 'Shift' ? Boolean(ev.shiftKey) : key === 'Control' ? Boolean(ev.ctrlKey) : key === 'Alt' ? Boolean(ev.altKey) : key === 'Meta' ? Boolean(ev.metaKey) : false
    ),
  };
  DISPATCH.set(ev, state);
  for (const t of [...path].reverse()) {
    ev.eventPhase = t === target ? 2 : 1;
    t.fire(ev, true);
    if (state.stopped) break;
  }
  if (!state.stopped) {
    for (const t of path) {
      if (t !== target && !ev.bubbles) break;
      ev.eventPhase = t === target ? 2 : 3;
      t.fire(ev, false);
      if (state.stopped) break;
    }
  }
  ev.currentTarget = null;
  ev.eventPhase = 0;
  return ev;
}

// ─── Nodes ───

export class LiveNode extends LiveEventTarget {
  childNodes: LiveNode[] = [];
  parentNode: LiveNode | null = null;
  constructor(readonly nodeType: number, readonly nodeName: string, readonly ownerDocument: LiveDocument | null) { super(); }
  /** The document this node belongs to (a document is its own). */
  protected get doc(): LiveDocument { return this.ownerDocument ?? (this as unknown as LiveDocument); }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get nextSibling() { const s = this.parentNode?.childNodes ?? []; return s[s.indexOf(this) + 1] ?? null; }
  get previousSibling() { const s = this.parentNode?.childNodes ?? []; return s[s.indexOf(this) - 1] ?? null; }
  get parentElement(): LiveElement | null { return this.parentNode instanceof LiveElement ? this.parentNode : null; }
  get children(): LiveElement[] { return this.childNodes.filter((c): c is LiveElement => c instanceof LiveElement); }
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0] ?? null; }
  get lastElementChild() { const c = this.children; return c[c.length - 1] ?? null; }
  get isConnected() { let n: LiveNode = this; while (n.parentNode) n = n.parentNode; return n instanceof LiveDocument; }
  getRootNode(): LiveNode { let n: LiveNode = this; while (n.parentNode) n = n.parentNode; return n; }
  /** The text of the node's descendant text nodes, in tree order. */
  get textContent(): string { return this.childNodes.map((c) => (c instanceof LiveComment ? '' : c.textContent)).join(''); }
  set textContent(t: string) {
    for (const c of [...this.childNodes]) this.removeChild(c);
    if (t) this.appendChild(new LiveText(String(t), this.doc));
  }
  contains(other: LiveNode | null) { for (let n = other; n; n = n.parentNode) if (n === this) return true; return false; }
  hasChildNodes() { return this.childNodes.length > 0; }
  appendChild<T extends LiveNode>(child: T): T { return this.insertBefore(child, null); }
  append(...nodes: (LiveNode | string)[]) { for (const n of nodes) this.appendChild(typeof n === 'string' ? new LiveText(n, this.doc) : n); }
  insertBefore<T extends LiveNode>(child: T, before: LiveNode | null): T {
    if (child.contains(this)) throw new Error('the live tree cannot insert a node into itself');
    child.parentNode?.removeChild(child);
    const at = before ? this.childNodes.indexOf(before) : -1;
    if (before && at < 0) throw new Error('insertBefore: the reference node is not a child of this node');
    this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, child);
    child.parentNode = this;
    this.doc.mutated();
    return child;
  }
  removeChild<T extends LiveNode>(child: T): T {
    const at = this.childNodes.indexOf(child);
    if (at < 0) throw new Error('removeChild: the node is not a child of this node');
    const doc = this.doc;
    // The focus fixup rule: a focused element that leaves the tree, alone or with an ancestor, loses focus.
    if (doc.focused && child.contains(doc.focused)) doc.focused = null;
    this.childNodes.splice(at, 1);
    child.parentNode = null;
    doc.mutated();
    return child;
  }
  replaceChild<T extends LiveNode>(next: LiveNode, old: T): T { this.insertBefore(next, old); return this.removeChild(old); }
  remove() { this.parentNode?.removeChild(this); }
  /** The descendants a selector list matches, in tree order; a selector part the engine cannot evaluate throws, naming it. */
  querySelectorAll(selector: string): LiveElement[] {
    const list = parseSelectorList(selector);
    const scope = this instanceof LiveElement ? this : null;
    return [...liveElements(this)].filter((e) => definite(selector, matchSelectorList(e, list, { scope })));
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  cloneNode(_deep?: boolean): LiveNode { throw new Error(`the live tree does not clone a ${this.nodeName} node`); }
}

export class LiveText extends LiveNode {
  private text: string;
  constructor(text: string, doc: LiveDocument) { super(3, '#text', doc); this.text = text; }
  get nodeValue() { return this.text; }
  set nodeValue(t: string) { this.text = String(t); this.doc.mutated(); }
  get data() { return this.text; }
  set data(t: string) { this.nodeValue = t; }
  override get textContent() { return this.text; }
  override set textContent(t: string) { this.nodeValue = t; }
  override cloneNode() { return new LiveText(this.text, this.doc); }
}

export class LiveComment extends LiveNode {
  constructor(public nodeValue: string, doc: LiveDocument) { super(8, '#comment', doc); }
  get data() { return this.nodeValue; }
  override get textContent() { return this.nodeValue; }
  override set textContent(t: string) { this.nodeValue = String(t); }
  override cloneNode() { return new LiveComment(this.nodeValue, this.doc); }
}

/**
 * An inline style: the properties React writes by name (`style.width = '4px'`) and the custom
 * properties it writes with setProperty, read back by either spelling, and as `cssText`.
 */
export type LiveStyle = Record<string, unknown> & {
  cssText: string;
  setProperty(name: string, value: string | null, priority?: string): void;
  removeProperty(name: string): string;
  getPropertyValue(name: string): string;
  getPropertyPriority(name: string): string;
  /** The declarations set, by CSS name. */
  entries(): [string, string][];
};
/** `gridTemplateColumns` -> `grid-template-columns`, `WebkitTransform` -> `-webkit-transform`, `cssFloat` -> `float`. */
export const cssName = (key: string) => {
  if (key.startsWith('--')) return key;
  if (key === 'cssFloat') return 'float';
  const kebab = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  return /^(webkit|moz|ms)-/.test(kebab) ? `-${kebab}` : kebab;
};
export function createLiveStyle(onChange: () => void = () => {}): LiveStyle {
  const decls = new Map<string, string>();
  const write = (name: string, value: unknown) => {
    const v = value === null || value === undefined ? '' : String(value);
    if (v === '') decls.delete(name); else decls.set(name, v);
    onChange();
  };
  const methods: Record<string, unknown> = {
    setProperty: (name: string, value: string | null) => write(name.startsWith('--') ? name : name.toLowerCase(), value),
    removeProperty: (name: string) => { const was = decls.get(name) ?? ''; write(name, ''); return was; },
    getPropertyValue: (name: string) => decls.get(name.startsWith('--') ? name : name.toLowerCase()) ?? '',
    getPropertyPriority: () => '',
    entries: () => [...decls.entries()],
  };
  return new Proxy(methods, {
    get(target, key) {
      if (typeof key !== 'string') return undefined;
      if (key in target) return target[key];
      if (key === 'cssText') return [...decls].map(([k, v]) => `${k}: ${v};`).join(' ');
      if (key === 'length') return decls.size;
      return decls.get(cssName(key)) ?? '';
    },
    set(_target, key, value) {
      if (typeof key !== 'string') return false;
      if (key === 'cssText') {
        decls.clear();
        for (const d of String(value).split(';')) {
          const at = d.indexOf(':');
          if (at > 0) decls.set(d.slice(0, at).trim(), d.slice(at + 1).trim());
        }
        onChange();
        return true;
      }
      write(cssName(key), value);
      return true;
    },
    has(target, key) { return typeof key === 'string' && (key in target || key === 'cssText' || decls.has(cssName(key))); },
  }) as unknown as LiveStyle;
}

/** A box the test's layout gives an element. */
export interface Box { width: number; height: number }
export type Layout = (el: LiveElement) => Box;
export const NO_LAYOUT: Layout = () => ({ width: 0, height: 0 });
const rect = (box: Box) => ({ x: 0, y: 0, top: 0, left: 0, right: box.width, bottom: box.height, width: box.width, height: box.height, toJSON() { return this; } });

/** A download a link hands to the browser: the file name it asks for and the URL of its contents. */
export interface LiveDownload { filename: string; href: string }

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const TEXT_FIELD_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number', 'date', 'datetime-local', 'month', 'time', 'week', 'color', 'range']);
const FORM_CONTROLS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'OPTGROUP', 'OPTION', 'FIELDSET']);

export class LiveElement extends LiveNode {
  readonly tagName: string;
  readonly localName: string;
  readonly attributes = new Map<string, string>();
  readonly style: LiveStyle;
  scrollLeft = 0;
  scrollTop = 0;
  /** A field's value once set (null: read from its attribute or text), its checkedness and an option's selectedness. */
  private fieldValue: string | null = null;
  private checkedness: boolean | null = null;
  private selectedness: boolean | null = null;
  /** Whether a select's selection was set (otherwise its first option is selected), and a dialog opened modal. */
  private selectionSet = false;
  private modal = false;
  private readonly pointerCaptures = new Set<number>();
  constructor(tag: string, readonly namespaceURI: string, doc: LiveDocument) {
    const local = namespaceURI === XHTML_NS ? tag.toLowerCase() : tag;
    const name = namespaceURI === XHTML_NS ? local.toUpperCase() : local;
    super(1, name, doc);
    this.tagName = name;
    this.localName = local;
    this.style = createLiveStyle(() => doc.mutated());
  }
  private get html() { return this.namespaceURI === XHTML_NS; }

  // Attributes
  setAttribute(name: string, value: string) { this.attributes.set(name, String(value)); this.doc.mutated(); }
  setAttributeNS(_ns: string | null, name: string, value: string) { this.setAttribute(name, value); }
  removeAttribute(name: string) { if (this.attributes.delete(name)) this.doc.mutated(); }
  removeAttributeNS(_ns: string | null, name: string) { this.removeAttribute(name); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  getAttributeNS(_ns: string | null, name: string) { return this.getAttribute(name); }
  hasAttribute(name: string) { return this.attributes.has(name); }
  getAttributeNames() { return [...this.attributes.keys()]; }
  toggleAttribute(name: string, force?: boolean) {
    const on = force ?? !this.hasAttribute(name);
    if (on) this.setAttribute(name, this.getAttribute(name) ?? ''); else this.removeAttribute(name);
    return on;
  }
  get id() { return this.getAttribute('id') ?? ''; }
  set id(v: string) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') ?? ''; }
  set className(v: string) { this.setAttribute('class', v); }
  get href() { return this.getAttribute('href') ?? ''; }
  set href(v: string) { this.setAttribute('href', v); }
  get download() { return this.getAttribute('download') ?? ''; }
  set download(v: string) { this.setAttribute('download', v); }
  get hidden() { return this.hasAttribute('hidden'); }
  get disabled() { return this.hasAttribute('disabled'); }
  get isContentEditable() { const v = this.getAttribute('contenteditable'); return v === '' || v === 'true'; }
  get tabIndex() {
    const v = this.getAttribute('tabindex');
    if (v !== null && /^-?\d+$/.test(v.trim())) return Number(v);
    return isFocusableByDefault(this) ? 0 : -1;
  }
  get dataset(): Record<string, string | undefined> {
    const attr = (k: string) => `data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    return new Proxy({}, {
      get: (_t, k) => (typeof k === 'string' ? this.getAttribute(attr(k)) ?? undefined : undefined),
      set: (_t, k, v) => { if (typeof k === 'string') this.setAttribute(attr(k), String(v)); return true; },
      has: (_t, k) => typeof k === 'string' && this.hasAttribute(attr(k)),
    });
  }
  get classList() {
    const classes = () => (this.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
    const write = (list: string[]) => this.setAttribute('class', [...new Set(list)].join(' '));
    return {
      contains: (c: string) => classes().includes(c),
      add: (...cs: string[]) => write([...classes(), ...cs]),
      remove: (...cs: string[]) => write(classes().filter((c) => !cs.includes(c))),
      toggle: (c: string, force?: boolean) => {
        const on = force ?? !classes().includes(c);
        write(on ? [...classes(), c] : classes().filter((x) => x !== c));
        return on;
      },
      get length() { return classes().length; },
      [Symbol.iterator]: () => classes()[Symbol.iterator](),
    };
  }

  // Fields: value, checkedness and selection live on the prototype, as in a browser.
  /** An input's type (React DOM reads it to choose the event a field reports its changes on). */
  get type(): string {
    const t = this.getAttribute('type');
    if (this.tagName === 'INPUT') return (t ?? 'text').toLowerCase();
    if (this.tagName === 'BUTTON') return (t ?? 'submit').toLowerCase();
    if (this.tagName === 'SELECT') return this.hasAttribute('multiple') ? 'select-multiple' : 'select-one';
    if (this.tagName === 'TEXTAREA') return 'textarea';
    return t ?? '';
  }
  get value(): string {
    if (this.tagName === 'SELECT') {
      const options = this.options;
      const chosen = options.find((o) => o.selected) ?? (this.selectionSet ? undefined : options.find((o) => !o.hasAttribute('disabled')));
      return chosen ? chosen.value : '';
    }
    if (this.tagName === 'OPTION') return this.getAttribute('value') ?? this.textContent.replace(/\s+/g, ' ').trim();
    if (this.tagName === 'TEXTAREA') return this.fieldValue ?? this.textContent;
    if (this.tagName === 'INPUT' && this.fieldValue === null && this.getAttribute('value') === null && (this.type === 'checkbox' || this.type === 'radio')) return 'on';
    return this.fieldValue ?? this.getAttribute('value') ?? '';
  }
  set value(v: string) {
    const s = v === null || v === undefined ? '' : String(v);
    if (this.tagName === 'SELECT') {
      this.selectionSet = true;
      for (const o of this.options) o.selected = o.value === s;
      return;
    }
    if (this.tagName === 'OPTION') { this.setAttribute('value', s); return; }
    this.fieldValue = s;
    this.doc.mutated();
  }
  get checked(): boolean { return this.checkedness ?? this.hasAttribute('checked'); }
  set checked(v: boolean) { this.checkedness = Boolean(v); this.doc.mutated(); }
  get selected(): boolean { return this.selectedness ?? this.hasAttribute('selected'); }
  set selected(v: boolean) {
    this.selectedness = Boolean(v);
    const select = this.closestSelect();
    if (select) {
      select.selectionSet = true;
      if (v && !select.hasAttribute('multiple')) for (const o of select.options) if (o !== this) o.selectedness = false;
    }
    this.doc.mutated();
  }
  private closestSelect(): LiveElement | null {
    for (let n = this.parentElement; n; n = n.parentElement) if (n.tagName === 'SELECT') return n;
    return null;
  }
  /** A select's options, which React DOM reads to mark the selected one. */
  get options(): LiveElement[] { return [...liveElements(this)].filter((e) => e.tagName === 'OPTION'); }
  get selectedIndex() {
    const options = this.options;
    const at = options.findIndex((o) => o.selected);
    return at >= 0 ? at : this.selectionSet || !options.length ? -1 : 0;
  }
  get form(): LiveElement | null {
    const id = this.getAttribute('form');
    if (id) return this.doc.getElementById(id);
    for (let n = this.parentElement; n; n = n.parentElement) if (n.tagName === 'FORM') return n;
    return null;
  }
  get labels(): LiveElement[] {
    const id = this.getAttribute('id');
    return [...liveElements(this.getRootNode())].filter((l) => l.tagName === 'LABEL' && ((id !== null && l.getAttribute('for') === id) || (!l.hasAttribute('for') && labelControl(l) === this)));
  }

  // Focus
  focus() { if (this.isConnected && isFocusable(this)) this.doc.focused = this; }
  blur() { if (this.doc.focused === this) this.doc.focused = null; }

  // Dialogs
  get open() { return this.hasAttribute('open'); }
  set open(v: boolean) { if (v) this.setAttribute('open', ''); else this.removeAttribute('open'); }
  show() { this.open = true; }
  showModal() { this.modal = true; this.open = true; }
  close() { if (!this.open) return; this.modal = false; this.open = false; dispatchLiveEvent(this, 'close'); }
  /** Whether a dialog was opened with showModal and is still open (the :modal pseudo-class). */
  get isModal() { return this.modal && this.open; }

  // Activation
  /** A click as App code calls it (`anchor.click()`): the click event and its activation behaviour, no pointer events. */
  click() { clickElement(this); }
  requestSubmit() { if (this.tagName === 'FORM') dispatchLiveEvent(this, 'submit'); }

  // Layout, read from the document's layout function
  private get box() { return this.doc.layout(this); }
  get clientWidth() { return this.box.width; }
  get clientHeight() { return this.box.height; }
  get offsetWidth() { return this.box.width; }
  get offsetHeight() { return this.box.height; }
  get scrollWidth() { return this.box.width; }
  get scrollHeight() { return this.box.height; }
  get offsetTop() { return 0; }
  get offsetLeft() { return 0; }
  get offsetParent() { return this.parentElement; }
  getBoundingClientRect() { return rect(this.box); }
  getClientRects() { return [rect(this.box)]; }
  getBBox() { const b = this.box; return { x: 0, y: 0, width: b.width, height: b.height }; }
  scrollTo(x?: number | { left?: number; top?: number }, y?: number) {
    if (typeof x === 'object' && x) { if (x.left !== undefined) this.scrollLeft = x.left; if (x.top !== undefined) this.scrollTop = x.top; }
    else { if (x !== undefined) this.scrollLeft = x; if (y !== undefined) this.scrollTop = y; }
  }
  scrollBy(x?: number | { left?: number; top?: number }, y?: number) {
    if (typeof x === 'object' && x) { this.scrollLeft += x.left ?? 0; this.scrollTop += x.top ?? 0; }
    else { this.scrollLeft += x ?? 0; this.scrollTop += y ?? 0; }
  }
  scrollIntoView() {}
  /** A canvas has no 2D context here, so it draws nothing. */
  getContext() { return null; }
  setPointerCapture(id: number) { this.pointerCaptures.add(id); }
  releasePointerCapture(id: number) { this.pointerCaptures.delete(id); }
  hasPointerCapture(id: number) { return this.pointerCaptures.has(id); }

  // Selectors
  matches(selector: string) { return definite(selector, matchSelectorList(this, parseSelectorList(selector), { scope: this })); }
  closest(selector: string): LiveElement | null {
    const list = parseSelectorList(selector);
    for (let n: LiveElement | null = this; n; n = n.parentElement) if (definite(selector, matchSelectorList(n, list, { scope: this }))) return n;
    return null;
  }

  // Markup
  get innerHTML() { return this.childNodes.map((c) => serialize(c, 'html', this.namespaceURI, new Set())).join(''); }
  set innerHTML(markup: string) {
    for (const c of [...this.childNodes]) this.removeChild(c);
    for (const n of parseMarkup(String(markup), this.doc, this.namespaceURI === SVG_NS && this.localName !== 'foreignObject' ? SVG_NS : XHTML_NS)) this.appendChild(n);
  }
  get outerHTML() { return serialize(this, 'html', null, new Set()); }
  override cloneNode(deep = false): LiveElement {
    const copy = new LiveElement(this.localName, this.namespaceURI, this.doc);
    for (const [k, v] of this.attributes) copy.attributes.set(k, v);
    for (const [k, v] of this.style.entries()) copy.style.setProperty(k, v);
    copy.fieldValue = this.fieldValue;
    copy.checkedness = this.checkedness;
    copy.selectedness = this.selectedness;
    if (deep) for (const c of this.childNodes) copy.appendChild(c.cloneNode(true));
    return copy;
  }
}

const isLabelable = (e: LiveElement) => ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'METER', 'OUTPUT', 'PROGRESS'].includes(e.tagName) && !(e.tagName === 'INPUT' && e.type === 'hidden');
function labelControl(label: LiveElement): LiveElement | null {
  const id = label.getAttribute('for');
  if (id !== null) { const c = label.ownerDocument?.getElementById(id); return c && isLabelable(c) ? c : null; }
  return [...liveElements(label)].find(isLabelable) ?? null;
}
const isDisabledControl = (e: LiveElement) => FORM_CONTROLS.has(e.tagName) && e.hasAttribute('disabled');
function isFocusableByDefault(e: LiveElement): boolean {
  if (e.tagName === 'A' || e.tagName === 'AREA') return e.hasAttribute('href');
  if (e.tagName === 'INPUT') return e.type !== 'hidden' && !e.hasAttribute('disabled');
  if (['BUTTON', 'SELECT', 'TEXTAREA'].includes(e.tagName)) return !e.hasAttribute('disabled');
  return e.tagName === 'IFRAME' || e.tagName === 'SUMMARY' || e.isContentEditable;
}
/** Whether `focus()` gives `el` focus: a control, a link, editable content, or anything with a tabindex. */
export const isFocusable = (el: LiveElement) => el.hasAttribute('tabindex') || isFocusableByDefault(el);
/**
 * Whether a pointer press focuses `el`, as WebKit does on macOS: fields, editable content and
 * elements with a tabindex take focus from a click; buttons, links and checkboxes do not.
 */
export const isClickFocusable = (el: LiveElement) => {
  if (el.hasAttribute('tabindex')) return true;
  if (el.tagName === 'INPUT') return TEXT_FIELD_TYPES.has(el.type) && !el.hasAttribute('disabled');
  if (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return !el.hasAttribute('disabled');
  return el.isContentEditable;
};

export class LiveDocument extends LiveNode {
  focused: LiveElement | null = null;
  readonly documentElement: LiveElement;
  readonly head: LiveElement;
  readonly body: LiveElement;
  defaultView: LiveWindow | null = null;
  /** The box each element is laid out at; every box is 0 x 0 unless the test gives a layout. */
  layout: Layout = NO_LAYOUT;
  /** Every change to the tree, an attribute, a text or an inline style counts here (the harness waits for it to stop). */
  mutations = 0;
  /** The files links with `download` handed to the browser, in order. */
  readonly downloads: LiveDownload[] = [];
  /** React DOM tests `'oninput' in document` to choose the input event over its legacy polyfill. */
  oninput: null = null;
  readonly visibilityState = 'visible';
  readonly hidden = false;
  readonly readyState = 'complete';
  title = '';
  constructor() {
    super(9, '#document', null);
    this.documentElement = this.createElement('html');
    this.head = this.createElement('head');
    this.body = this.createElement('body');
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }
  mutated() { this.mutations++; }
  get activeElement() { return this.focused ?? this.body; }
  hasFocus() { return true; }
  createElement(tag: string) { return new LiveElement(tag, XHTML_NS, this); }
  createElementNS(ns: string | null, tag: string) { return new LiveElement(tag, ns ?? XHTML_NS, this); }
  createTextNode(t: string) { return new LiveText(String(t), this); }
  createComment(t: string) { return new LiveComment(String(t), this); }
  getElementById(id: string) { return [...liveElements(this)].find((e) => e.getAttribute('id') === id) ?? null; }
  getElementsByTagName(tag: string) { const t = tag.toLowerCase(); return [...liveElements(this)].filter((e) => t === '*' || e.localName.toLowerCase() === t); }
  elementFromPoint() { return null; }
  execCommand() { return false; }
}

/** Every element below `n`, in tree order. */
export function* liveElements(n: LiveNode): Generator<LiveElement> {
  for (const c of n.childNodes) if (c instanceof LiveElement) { yield c; yield* liveElements(c); }
}

// ─── Clicks, keys and field edits, as a user makes them ───

/** Runs one step of a gesture (each event its own task, as in a browser); the harness passes React's act. */
export type Step = (fn: () => void) => void;
const direct: Step = (fn) => fn();

const isCheckable = (e: LiveElement) => e.tagName === 'INPUT' && (e.type === 'checkbox' || e.type === 'radio');
const isSubmitter = (e: LiveElement) => (e.tagName === 'BUTTON' && e.type === 'submit') || (e.tagName === 'INPUT' && (e.type === 'submit' || e.type === 'image'));
const hasActivation = (e: LiveElement) => isCheckable(e) || isSubmitter(e) || e.tagName === 'LABEL' || ((e.tagName === 'A' || e.localName === 'a') && e.hasAttribute('href'));
const nativeSetter = (prop: 'value' | 'checked') => Object.getOwnPropertyDescriptor(LiveElement.prototype, prop)!.set!;
/** Sets a field's value or checkedness as the browser does when a user edits it, past React DOM's value tracker. */
export const setFieldValue = (el: LiveElement, value: string) => nativeSetter('value').call(el, value);
export const setFieldChecked = (el: LiveElement, checked: boolean) => nativeSetter('checked').call(el, checked);

/**
 * The click event on `el` and its activation behaviour: a checkbox or radio flips before the click
 * (and back if the click is cancelled) and then reports input and change; a submit button submits its
 * form; a label clicks its control; a link with `download` hands its file to the document's
 * downloads. A disabled control gets no click. Returns the click, or null for a disabled control.
 */
export function clickElement(el: LiveElement, init: Record<string, unknown> = {}): LiveEvent | null {
  if (isDisabledControl(el)) return null;
  let activator: LiveElement | null = null;
  for (let n: LiveElement | null = el; n; n = n.parentElement) if (hasActivation(n)) { activator = n; break; }
  let undo: (() => void) | null = null;
  if (activator && isCheckable(activator)) {
    const box = activator;
    if (box.type === 'checkbox') {
      const was = box.checked;
      setFieldChecked(box, !was);
      undo = () => setFieldChecked(box, was);
    } else {
      const group = box.getAttribute('name');
      const peers = group ? [...liveElements(box.getRootNode())].filter((r) => isCheckable(r) && r.type === 'radio' && r.getAttribute('name') === group) : [box];
      const was = peers.map((r) => [r, r.checked] as const);
      for (const r of peers) setFieldChecked(r, r === box);
      undo = () => { for (const [r, c] of was) setFieldChecked(r, c); };
    }
  }
  const ev = dispatchLiveEvent(el, 'click', { detail: 1, ...init });
  if (ev.defaultPrevented) { undo?.(); return ev; }
  if (!activator) return ev;
  if (isCheckable(activator)) {
    if (undo) { dispatchLiveEvent(activator, 'input'); dispatchLiveEvent(activator, 'change'); }
  } else if (isSubmitter(activator)) {
    const form = activator.form;
    if (form) dispatchLiveEvent(form, 'submit', { submitter: activator });
  } else if (activator.tagName === 'LABEL') {
    const control = labelControl(activator);
    if (control && control !== el && !control.contains(el)) clickElement(control);
  } else if (activator.hasAttribute('download')) {
    activator.ownerDocument?.downloads.push({ filename: activator.getAttribute('download') ?? '', href: activator.getAttribute('href') ?? '' });
  }
  return ev;
}

/**
 * A pointer click on `el`: pointer and mouse down (which moves focus, as WebKit does: to a field or an
 * element with a tabindex, else to the body), pointer and mouse up, then the click. A cancelled
 * pointer down suppresses the mouse events but not the click. A disabled control gets nothing.
 */
export function userClick(el: LiveElement, init: Record<string, unknown> = {}, step: Step = direct) {
  if (isDisabledControl(el)) return;
  const doc = el.ownerDocument!;
  const at = { button: 0, clientX: 0, clientY: 0, ...init };
  const pointer = { pointerId: 1, pointerType: 'mouse', isPrimary: true, ...at };
  let pointerCancelled = false;
  step(() => { pointerCancelled = dispatchLiveEvent(el, 'pointerdown', { ...pointer, buttons: 1 }).defaultPrevented; });
  if (!pointerCancelled) {
    step(() => {
      const down = dispatchLiveEvent(el, 'mousedown', { ...at, buttons: 1, detail: 1 });
      if (down.defaultPrevented) return;
      let target: LiveElement | null = null;
      for (let n: LiveElement | null = el; n; n = n.parentElement) if (isClickFocusable(n)) { target = n; break; }
      if (target) target.focus(); else doc.focused = null;
    });
  }
  step(() => { dispatchLiveEvent(el, 'pointerup', { ...pointer, buttons: 0 }); });
  if (!pointerCancelled) step(() => { dispatchLiveEvent(el, 'mouseup', { ...at, buttons: 0, detail: 1 }); });
  step(() => { clickElement(el, at); });
}

/** Modifier keys held for a key press. */
export interface KeyModifiers { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean }
/** The `code` a key press reports for a key: KeyI for i, Digit0 for 0, Minus for -, and so on. */
export function keyCode(key: string): string {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^\d$/.test(key)) return `Digit${key}`;
  const named: Record<string, string> = { ' ': 'Space', '-': 'Minus', '=': 'Equal', ',': 'Comma', '.': 'Period', '/': 'Slash', ';': 'Semicolon', "'": 'Quote', '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', '`': 'Backquote' };
  return named[key] ?? key;
}

/**
 * A key press on the focused element (the body when nothing has focus), with modifiers: key down,
 * its default action (Enter clicks a focused button or link, or submits the form of a focused text
 * field; Space clicks a focused button or checkbox on key up), then key up on whatever has focus.
 */
export function userPress(doc: LiveDocument, key: string, mods: KeyModifiers = {}, step: Step = direct) {
  const target = doc.activeElement;
  const fields = {
    key: mods.shift && /^[a-z]$/.test(key) ? key.toUpperCase() : key,
    code: keyCode(key),
    metaKey: Boolean(mods.meta), ctrlKey: Boolean(mods.ctrl), altKey: Boolean(mods.alt), shiftKey: Boolean(mods.shift),
    repeat: false, isComposing: false, location: 0,
  };
  let downCancelled = false;
  step(() => {
    downCancelled = dispatchLiveEvent(target, 'keydown', fields).defaultPrevented;
    if (downCancelled || key !== 'Enter') return;
    if (target.tagName === 'BUTTON' || (target.tagName === 'A' && target.hasAttribute('href'))) clickElement(target);
    else if (target.tagName === 'INPUT' && TEXT_FIELD_TYPES.has(target.type) && target.form) {
      const submitter = [...liveElements(target.form)].find(isSubmitter);
      if (submitter) clickElement(submitter); else dispatchLiveEvent(target.form, 'submit');
    }
  });
  step(() => {
    const now = doc.activeElement;
    const up = dispatchLiveEvent(now, 'keyup', fields);
    if (key === ' ' && !downCancelled && !up.defaultPrevented && now === target && (target.tagName === 'BUTTON' || (target.tagName === 'INPUT' && (target.type === 'checkbox' || target.type === 'radio')))) clickElement(target);
  });
}

const describe = (el: LiveElement) => `<${el.localName}${el.getAttribute('class') ? ` class="${el.getAttribute('class')}"` : ''}${el.getAttribute('aria-label') ? ` aria-label="${el.getAttribute('aria-label')}"` : ''}>`;

/**
 * A user's edit of a field, committed: a text-like input or textarea takes `value` and reports input
 * then change; a select takes the option whose value is `value` and reports input then change; a
 * checkbox or radio is clicked to `value` (true or false). Refuses, naming the field, a disabled or
 * read-only field, an option the select does not offer, and a box already in that state.
 */
export function userChange(el: LiveElement, value: string | boolean, step: Step = direct) {
  editable(el);
  if (isCheckable(el)) {
    if (typeof value !== 'boolean') throw new Error(`${describe(el)} is a ${el.type}: change it to true or false, not ${JSON.stringify(value)}`);
    if (el.checked === value) throw new Error(`${describe(el)} is already ${value ? 'ticked' : 'clear'}`);
    step(() => { clickElement(el); });
    return;
  }
  if (typeof value !== 'string') throw new Error(`${describe(el)} takes text, not ${value}`);
  if (el.tagName === 'SELECT') {
    const offered = el.options.map((o) => o.value);
    if (!offered.includes(value)) throw new Error(`${describe(el)} offers no option "${value}"; it offers ${offered.map((o) => `"${o}"`).join(', ') || 'none'}`);
  } else if (!isTextField(el)) {
    throw new Error(`${describe(el)} is not a field a user types or chooses in`);
  }
  step(() => { setFieldValue(el, value); dispatchLiveEvent(el, 'input'); });
  step(() => { dispatchLiveEvent(el, 'change'); });
}

/** A user's edit of a text-like field, not yet committed: the value changes and input is reported, as typing does. */
export function userInput(el: LiveElement, value: string, step: Step = direct) {
  editable(el);
  if (!isTextField(el)) throw new Error(`${describe(el)} is not a text field: use change for a select, checkbox or radio`);
  step(() => { setFieldValue(el, value); dispatchLiveEvent(el, 'input'); });
}

const isTextField = (el: LiveElement) => el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && TEXT_FIELD_TYPES.has(el.type));
function editable(el: LiveElement) {
  if (!el.isConnected) throw new Error(`${describe(el)} is not in the page`);
  if (el.hasAttribute('disabled')) throw new Error(`${describe(el)} is disabled and takes no input`);
  if (el.hasAttribute('readonly')) throw new Error(`${describe(el)} is read-only and takes no input`);
}

// ─── Selectors ───

/** A match the engine could not settle: a part of the selector it does not evaluate. */
export type Tri = boolean | 'unknown';
const and3 = (a: Tri, b: Tri): Tri => (a === false || b === false ? false : a === 'unknown' || b === 'unknown' ? 'unknown' : true);
const or3 = (a: Tri, b: Tri): Tri => (a === true || b === true ? true : a === 'unknown' || b === 'unknown' ? 'unknown' : false);
const not3 = (a: Tri): Tri => (a === 'unknown' ? 'unknown' : !a);

type Combinator = ' ' | '>' | '+' | '~';
interface AttrTest { name: string; op: '' | '=' | '~=' | '|=' | '^=' | '$=' | '*='; value: string; insensitive: boolean }
interface Pseudo { name: string; arg?: string; list?: ComplexSelector[]; nth?: { a: number; b: number; of?: ComplexSelector[] } }
interface Compound { tag?: string; ids: string[]; classes: string[]; attrs: AttrTest[]; pseudos: Pseudo[]; pseudoElement?: string }
/** One selector of a list: compounds left to right, with the combinator before each but the first. */
export interface ComplexSelector { text: string; compounds: Compound[]; combinators: Combinator[]; leading?: Combinator }

const LEGACY_PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter']);
const LIST_PSEUDOS = new Set(['not', 'is', 'where', 'matches', '-webkit-any', 'has']);
const NTH_PSEUDOS = new Set(['nth-child', 'nth-last-child', 'nth-of-type', 'nth-last-of-type']);

/** Splits at `sep` outside brackets, parentheses and quotes. */
export function splitTopLevel(text: string, sep = ','): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { cur += c; if (c === '\\') { cur += text[++i] ?? ''; } else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

const SELECTOR_CACHE = new Map<string, ComplexSelector[]>();
/** Parses a selector list; throws, naming it, on syntax the engine does not read (namespaces, nesting). */
export function parseSelectorList(text: string): ComplexSelector[] {
  const cached = SELECTOR_CACHE.get(text);
  if (cached) return cached;
  const list = splitTopLevel(text).map((one) => parseComplex(one.trim(), false));
  SELECTOR_CACHE.set(text, list);
  return list;
}
function parseRelativeList(text: string): ComplexSelector[] { return splitTopLevel(text).map((one) => parseComplex(one.trim(), true)); }

function parseComplex(text: string, relative: boolean): ComplexSelector {
  const fail = (why: string): never => { throw new Error(`the live tree reads no selector like "${text}" (${why})`); };
  if (!text) fail('it is empty');
  const sel: ComplexSelector = { text, compounds: [], combinators: [] };
  let i = 0;
  const ws = () => { const s = i; while (i < text.length && /\s/.test(text[i])) i++; return i > s; };
  ws();
  if (relative && '>+~'.includes(text[i])) { sel.leading = text[i] as Combinator; i++; ws(); } else if (relative) sel.leading = ' ';
  for (;;) {
    const [compound, next] = parseCompound(text, i, fail);
    sel.compounds.push(compound);
    i = next;
    const spaced = ws();
    if (i >= text.length) break;
    if ('>+~'.includes(text[i])) { sel.combinators.push(text[i] as Combinator); i++; ws(); } else if (spaced) sel.combinators.push(' ');
    else fail(`unexpected "${text[i]}"`);
  }
  return sel;
}

function readIdent(text: string, i: number): [string, number] {
  let out = '';
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') { out += text[i + 1] ?? ''; i += 2; continue; }
    if (!/[\w-]/.test(c) && c.charCodeAt(0) < 128) break;
    out += c;
    i++;
  }
  return [out, i];
}
function readBalanced(text: string, i: number, fail: (why: string) => never): [string, number] {
  // text[i] === '('
  let depth = 0;
  let quote = '';
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (quote) { if (c === '\\') j++; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return [text.slice(i + 1, j), j + 1];
  }
  return fail('a parenthesis is left open');
}

function parseCompound(text: string, start: number, fail: (why: string) => never): [Compound, number] {
  const c: Compound = { ids: [], classes: [], attrs: [], pseudos: [] };
  let i = start;
  if (text[i] === '*') { c.tag = '*'; i++; } else if (/[a-zA-Z_-]/.test(text[i] ?? '') || text[i] === '\\') {
    const [tag, next] = readIdent(text, i);
    c.tag = tag.toLowerCase();
    i = next;
  }
  for (;;) {
    const ch = text[i];
    if (ch === '#') { const [id, n] = readIdent(text, i + 1); if (!id) fail('an empty id'); c.ids.push(id); i = n; continue; }
    if (ch === '.') { const [cls, n] = readIdent(text, i + 1); if (!cls) fail('an empty class'); c.classes.push(cls); i = n; continue; }
    if (ch === '[') {
      const end = text.indexOf(']', i);
      if (end < 0) fail('an attribute selector is left open');
      const m = /^\s*([\w:-]+)\s*(?:([~|^$*]?=)\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^\s\]]+))\s*([iIsS])?)?\s*$/.exec(text.slice(i + 1, end));
      if (!m) fail(`the attribute selector [${text.slice(i + 1, end)}]`);
      c.attrs.push({ name: m![1], op: (m![2] ?? '') as AttrTest['op'], value: m![3] ?? m![4] ?? m![5] ?? '', insensitive: /i/i.test(m![6] ?? '') });
      i = end + 1;
      continue;
    }
    if (ch === ':') {
      const element = text[i + 1] === ':';
      const [name, n] = readIdent(text, i + (element ? 2 : 1));
      if (!name) fail('an empty pseudo-class');
      i = n;
      let arg: string | undefined;
      if (text[i] === '(') [arg, i] = readBalanced(text, i, fail);
      const lower = name.toLowerCase();
      if (element || LEGACY_PSEUDO_ELEMENTS.has(lower)) { c.pseudoElement = lower; continue; }
      const p: Pseudo = { name: lower, arg };
      if (LIST_PSEUDOS.has(lower)) {
        if (arg === undefined) fail(`:${lower} takes a selector list`);
        p.list = lower === 'has' ? parseRelativeList(arg!) : parseSelectorList(arg!);
      } else if (NTH_PSEUDOS.has(lower)) {
        if (arg === undefined) fail(`:${lower} takes an argument`);
        p.nth = parseNth(arg!, fail);
      }
      c.pseudos.push(p);
      continue;
    }
    break;
  }
  if (i === start) fail(`unexpected "${text[i] ?? 'end'}"`);
  return [c, i];
}

function parseNth(arg: string, fail: (why: string) => never): { a: number; b: number; of?: ComplexSelector[] } {
  const [, expr, of] = /^\s*(.*?)(?:\s+of\s+(.+))?\s*$/i.exec(arg) ?? [];
  const e = (expr ?? '').replace(/\s+/g, '').toLowerCase();
  const out = (a: number, b: number) => ({ a, b, of: of ? parseSelectorList(of) : undefined });
  if (e === 'odd') return out(2, 1);
  if (e === 'even') return out(2, 0);
  if (/^[+-]?\d+$/.test(e)) return out(0, Number(e));
  const m = /^([+-]?\d*)n([+-]\d+)?$/.exec(e);
  if (!m) return fail(`the An+B expression "${arg}"`);
  const a = m[1] === '' || m[1] === '+' ? 1 : m[1] === '-' ? -1 : Number(m[1]);
  return out(a, m[2] ? Number(m[2]) : 0);
}

/** Where a match is evaluated: the :scope element, and for :has the element it is anchored on. */
export interface MatchContext { scope?: LiveElement | null; anchor?: LiveElement }

/** Whether `el` matches any selector of `list`. */
export function matchSelectorList(el: LiveElement, list: readonly ComplexSelector[], ctx: MatchContext = {}): Tri {
  let r: Tri = false;
  for (const sel of list) { r = or3(r, matchSelector(el, sel, ctx)); if (r === true) return true; }
  return r;
}
/** Whether `el` matches one selector: true, false, or unknown when a part it depends on is not evaluated. */
export function matchSelector(el: LiveElement, sel: ComplexSelector, ctx: MatchContext = {}): Tri {
  return matchFrom(el, sel, sel.compounds.length - 1, ctx);
}
function matchFrom(el: LiveElement, sel: ComplexSelector, idx: number, ctx: MatchContext): Tri {
  const own = matchCompound(el, sel.compounds[idx], ctx);
  if (own === false) return false;
  let comb: Combinator | undefined;
  let left: (c: LiveElement) => Tri;
  if (idx > 0) {
    comb = sel.combinators[idx - 1];
    left = (c) => matchFrom(c, sel, idx - 1, ctx);
  } else if (sel.leading && ctx.anchor) {
    comb = sel.leading;
    const anchor = ctx.anchor;
    left = (c) => c === anchor;
  } else {
    return own;
  }
  let rest: Tri = false;
  const tryOne = (c: LiveElement | null) => { if (c) rest = or3(rest, left(c)); return rest === true; };
  if (comb === '>') tryOne(el.parentElement);
  else if (comb === ' ') { for (let a = el.parentElement; a; a = a.parentElement) if (tryOne(a)) break; }
  else if (comb === '+') tryOne(prevElement(el));
  else for (let s = prevElement(el); s; s = prevElement(s)) if (tryOne(s)) break;
  return and3(own, rest);
}
const prevElement = (el: LiveElement): LiveElement | null => {
  const sibs = el.parentNode?.children ?? [];
  return sibs[sibs.indexOf(el) - 1] ?? null;
};

function matchCompound(el: LiveElement, c: Compound, ctx: MatchContext): Tri {
  // A selector of a pseudo-element styles that pseudo-element, never the element itself.
  if (c.pseudoElement) return false;
  if (c.tag && c.tag !== '*' && el.localName.toLowerCase() !== c.tag) return false;
  for (const id of c.ids) if (el.getAttribute('id') !== id) return false;
  for (const cls of c.classes) if (!el.classList.contains(cls)) return false;
  for (const a of c.attrs) if (!matchAttr(el, a)) return false;
  let r: Tri = true;
  for (const p of c.pseudos) { r = and3(r, matchPseudo(el, p, ctx)); if (r === false) return false; }
  return r;
}
function matchAttr(el: LiveElement, a: AttrTest): boolean {
  const raw = el.getAttribute(a.name);
  if (raw === null) return false;
  if (!a.op) return true;
  const v = a.insensitive ? raw.toLowerCase() : raw;
  const w = a.insensitive ? a.value.toLowerCase() : a.value;
  switch (a.op) {
    case '=': return v === w;
    case '~=': return v.split(/\s+/).includes(w);
    case '|=': return v === w || v.startsWith(`${w}-`);
    case '^=': return w !== '' && v.startsWith(w);
    case '$=': return w !== '' && v.endsWith(w);
    default: return w !== '' && v.includes(w);
  }
}
function nthMatches(index: number, nth: { a: number; b: number }) {
  // index is 1-based: is there n >= 0 with a*n + b = index?
  if (nth.a === 0) return index === nth.b;
  const n = (index - nth.b) / nth.a;
  return Number.isInteger(n) && n >= 0;
}
const isTextLikeInput = (el: LiveElement) => el.tagName === 'INPUT' && TEXT_FIELD_TYPES.has(el.type) && !['range', 'color'].includes(el.type);

function matchPseudo(el: LiveElement, p: Pseudo, ctx: MatchContext): Tri {
  const doc = el.ownerDocument!;
  const siblings = () => el.parentNode?.children ?? [el];
  switch (p.name) {
    // The page at rest: no pointer is over or pressing anything.
    case 'hover': case 'active': return false;
    case 'focus': case 'focus-visible': return doc.focused === el;
    case 'focus-within': return Boolean(doc.focused && el.contains(doc.focused));
    case 'root': return el === doc.documentElement;
    case 'scope': return el === (ctx.scope ?? doc.documentElement);
    case 'empty': return el.childNodes.every((n) => n instanceof LiveComment || (n instanceof LiveText && n.nodeValue === ''));
    case 'first-child': return siblings()[0] === el;
    case 'last-child': { const s = siblings(); return s[s.length - 1] === el; }
    case 'only-child': return siblings().length === 1;
    case 'first-of-type': return siblings().filter((s) => s.localName === el.localName)[0] === el;
    case 'last-of-type': { const s = siblings().filter((x) => x.localName === el.localName); return s[s.length - 1] === el; }
    case 'only-of-type': return siblings().filter((s) => s.localName === el.localName).length === 1;
    case 'nth-child': case 'nth-last-child': case 'nth-of-type': case 'nth-last-of-type': {
      const nth = p.nth!;
      let pool = siblings();
      if (p.name.endsWith('of-type')) pool = pool.filter((s) => s.localName === el.localName);
      let own: Tri = true;
      if (nth.of) {
        // Only the siblings the `of` list matches count; one it cannot settle leaves the position unknown.
        own = matchSelectorList(el, nth.of, ctx);
        if (own === false) return false;
        const settled = pool.map((s) => matchSelectorList(s, nth.of!, ctx));
        if (settled.some((r) => r === 'unknown')) return 'unknown';
        pool = pool.filter((_s, i) => settled[i] === true);
      }
      if (p.name.includes('last')) pool = [...pool].reverse();
      return and3(own, nthMatches(pool.indexOf(el) + 1, nth));
    }
    case 'not': return not3(matchSelectorList(el, p.list!, ctx));
    case 'is': case 'where': case 'matches': case '-webkit-any': return matchSelectorList(el, p.list!, ctx);
    case 'has': {
      let r: Tri = false;
      for (const rel of p.list!) {
        const pool = rel.leading === '+' || rel.leading === '~'
          ? (el.parentNode?.children ?? []).slice((el.parentNode?.children ?? []).indexOf(el) + 1).flatMap((s) => [s, ...liveElements(s)])
          : [...liveElements(el)];
        for (const d of pool) { r = or3(r, matchSelector(d, rel, { ...ctx, anchor: el })); if (r === true) return true; }
      }
      return r;
    }
    case 'disabled': return FORM_CONTROLS.has(el.tagName) && el.hasAttribute('disabled');
    case 'enabled': return ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'OPTGROUP', 'OPTION', 'FIELDSET'].includes(el.tagName) && !el.hasAttribute('disabled');
    case 'checked': return (isCheckable(el) && el.checked) || (el.tagName === 'OPTION' && el.selected);
    case 'indeterminate': return el.tagName === 'PROGRESS' ? !el.hasAttribute('value') : isCheckable(el) && (el as unknown as { indeterminate?: boolean }).indeterminate === true;
    case 'read-write': return ((isTextLikeInput(el) || el.tagName === 'TEXTAREA') && !el.hasAttribute('readonly') && !el.hasAttribute('disabled')) || el.isContentEditable;
    case 'read-only': return !(((isTextLikeInput(el) || el.tagName === 'TEXTAREA') && !el.hasAttribute('readonly') && !el.hasAttribute('disabled')) || el.isContentEditable);
    case 'required': return ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && el.hasAttribute('required');
    case 'optional': return ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && !el.hasAttribute('required');
    case 'placeholder-shown': return (isTextLikeInput(el) || el.tagName === 'TEXTAREA') && el.hasAttribute('placeholder') && el.value === '';
    case 'link': case 'any-link': return (el.localName === 'a' || el.localName === 'area') && el.hasAttribute('href');
    case 'visited': case 'target': case 'fullscreen': return false;
    case 'modal': return el.isModal;
    case 'open': return el.open;
    case 'defined': return true;
    case 'dir': {
      let dir = 'ltr';
      for (let n: LiveElement | null = el; n; n = n.parentElement) { const d = n.getAttribute('dir'); if (d === 'ltr' || d === 'rtl') { dir = d; break; } }
      return dir === (p.arg ?? '').trim().toLowerCase();
    }
    // Validity, user interaction history and anything else are not modelled.
    default: return 'unknown';
  }
}

/** A match that must be settled (querySelectorAll, matches, closest): an unknown one throws, naming the selector. */
function definite(selector: string, r: Tri): boolean {
  if (r === 'unknown') throw new Error(`the live tree cannot evaluate the selector "${selector}" (a pseudo-class it does not model)`);
  return r;
}

/** A selector's specificity: ids, then classes, attributes and pseudo-classes, then types and pseudo-elements. */
export function specificity(sel: ComplexSelector): [number, number, number] {
  const total: [number, number, number] = [0, 0, 0];
  const add = (s: [number, number, number]) => { total[0] += s[0]; total[1] += s[1]; total[2] += s[2]; };
  const maxOf = (list: readonly ComplexSelector[]) => list.map(specificity).reduce((m, s) => (compareSpecificity(s, m) > 0 ? s : m), [0, 0, 0] as [number, number, number]);
  for (const c of sel.compounds) {
    total[0] += c.ids.length;
    total[1] += c.classes.length + c.attrs.length;
    if (c.tag && c.tag !== '*') total[2]++;
    if (c.pseudoElement) total[2]++;
    for (const p of c.pseudos) {
      if (p.name === 'where') continue;
      if (p.list) add(maxOf(p.list));
      else { total[1]++; if (p.nth?.of) add(maxOf(p.nth.of)); }
    }
  }
  return total;
}
export const compareSpecificity = (a: readonly number[], b: readonly number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

// ─── Media queries and size conditions ───

/** The browser environment the live window reports: its size, light theme, no motion or contrast preference, a fine pointer that hovers. */
export interface MediaEnvironment { width: number; height: number }

/** Evaluates a media-query or container condition ("(a) and (b)", "not (a)", "(a) or (b)"); `feature` evaluates one parenthesised test. */
export function evaluateCondition(text: string, feature: (test: string) => Tri): Tri {
  const s = text.trim();
  const notMatch = /^not\s+(.+)$/is.exec(s);
  if (notMatch) return not3(inParens(notMatch[1], feature));
  const parts = splitWords(s);
  if (parts.length === 1) return inParens(parts[0], feature);
  const ops = parts.filter((_p, i) => i % 2 === 1).map((o) => o.toLowerCase());
  if (ops.some((o) => o !== ops[0]) || !['and', 'or'].includes(ops[0])) return 'unknown';
  let r: Tri = ops[0] === 'and';
  for (let i = 0; i < parts.length; i += 2) {
    const v = inParens(parts[i], feature);
    r = ops[0] === 'and' ? and3(r, v) : or3(r, v);
  }
  return r;
}
/** Splits a condition into its parenthesised (or functional) parts and the keywords between them. */
function splitWords(s: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    const fn = /^[a-zA-Z-]*\(/.exec(s.slice(i));
    if (fn) {
      let depth = 0;
      let j = i;
      for (; j < s.length; j++) { if (s[j] === '(') depth++; else if (s[j] === ')' && --depth === 0) break; }
      out.push(s.slice(i, j + 1));
      i = j + 1;
    } else {
      const m = /^\S+/.exec(s.slice(i))!;
      out.push(m[0]);
      i += m[0].length;
    }
  }
  return out;
}
function inParens(part: string, feature: (test: string) => Tri): Tri {
  const p = part.trim();
  if (!p.startsWith('(')) return feature(p);
  const inner = p.slice(1, -1).trim();
  if (inner.startsWith('(') || /^not\s/i.test(inner)) return evaluateCondition(inner, feature);
  return feature(`(${inner})`);
}

const toPx = (v: string): number | null => {
  const m = /^(-?[\d.]+)(px|rem|em)?$/.exec(v.trim());
  if (!m) return null;
  return Number(m[1]) * (m[2] === 'rem' || m[2] === 'em' ? 16 : 1);
};
/** Whether a size test ("(min-width: 760px)", "(width < 600px)", "(400px <= width <= 900px)") holds for a box. */
export function sizeFeature(test: string, size: { width: number; height: number }, names: { width: string[]; height: string[] }): Tri | null {
  const inner = test.replace(/^\(|\)$/g, '').trim();
  const dim = (name: string): number | null => (names.width.includes(name) ? size.width : names.height.includes(name) ? size.height : null);
  const plain = /^(min-|max-)?([a-z-]+)\s*:\s*(.+)$/.exec(inner);
  if (plain) {
    const v = dim(plain[2]);
    if (v === null) return null;
    const px = toPx(plain[3]);
    if (px === null) return 'unknown';
    return plain[1] === 'min-' ? v >= px : plain[1] === 'max-' ? v <= px : v === px;
  }
  const cmp = (a: number, op: string, b: number) => (op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : op === '>=' ? a >= b : a === b);
  const range = /^(?:([^<>=\s]+)\s*(<=|<|>=|>|=)\s*)?([a-z-]+)\s*(?:(<=|<|>=|>|=)\s*([^<>=\s]+))?$/.exec(inner);
  if (range && (range[1] !== undefined || range[4] !== undefined)) {
    const v = dim(range[3]);
    if (v === null) return null;
    const lo = range[1] !== undefined ? toPx(range[1]) : null;
    const hi = range[5] !== undefined ? toPx(range[5]) : null;
    if ((range[1] !== undefined && lo === null) || (range[5] !== undefined && hi === null)) return 'unknown';
    let ok = true;
    if (lo !== null) ok = ok && cmp(lo, range[2], v);
    if (hi !== null) ok = ok && cmp(v, range[4], hi);
    return ok;
  }
  if (inner === 'orientation: landscape') return size.width >= size.height;
  if (inner === 'orientation: portrait') return size.height > size.width;
  return null;
}

const MEDIA_PREFERENCES: Record<string, string> = {
  'prefers-color-scheme': 'light', 'prefers-reduced-motion': 'no-preference', 'prefers-contrast': 'no-preference',
  'prefers-reduced-transparency': 'no-preference', 'prefers-reduced-data': 'no-preference', 'forced-colors': 'none',
  'inverted-colors': 'none', hover: 'hover', 'any-hover': 'hover', pointer: 'fine', 'any-pointer': 'fine',
  scripting: 'enabled', update: 'fast', 'display-mode': 'browser', 'dynamic-range': 'standard', 'color-gamut': 'srgb',
};
/** Features that are present (true in a boolean test) in the reported environment. */
const MEDIA_PRESENT = new Set(['hover', 'any-hover', 'pointer', 'any-pointer', 'color', 'scripting', 'update', 'grid']);

/** One media feature test in the reported environment; unknown for a feature it does not model. */
export function mediaFeature(test: string, env: MediaEnvironment): Tri {
  const size = sizeFeature(test, env, { width: ['width', 'device-width'], height: ['height', 'device-height'] });
  if (size !== null) return size;
  const inner = test.replace(/^\(|\)$/g, '').trim().toLowerCase();
  const m = /^([a-z-]+)\s*(?::\s*(.+))?$/.exec(inner);
  if (!m) return 'unknown';
  const [, name, value] = m;
  if (name in MEDIA_PREFERENCES) {
    if (value === undefined) return MEDIA_PRESENT.has(name) || !['no-preference', 'none'].includes(MEDIA_PREFERENCES[name]);
    return value.trim() === MEDIA_PREFERENCES[name];
  }
  if (name === 'color' && value === undefined) return true;
  if (name === 'monochrome') return value === undefined ? false : value.trim() === '0';
  return 'unknown';
}

/** Whether a media query list ("screen and (max-width: 900px), print") holds in the environment. */
export function evaluateMediaQuery(query: string, env: MediaEnvironment): Tri {
  let r: Tri = false;
  for (const raw of splitTopLevel(query)) {
    const q = raw.trim();
    if (!q) continue;
    const typed = /^(?:(only|not)\s+)?([a-z-]+)(?:\s+and\s+(.+))?$/is.exec(q);
    let v: Tri;
    if (typed && typed[2].toLowerCase() !== 'not' && !q.startsWith('(')) {
      const type = typed[2].toLowerCase();
      const typeHolds: Tri = type === 'all' || type === 'screen' ? true : type === 'print' || type === 'speech' ? false : 'unknown';
      v = typed[3] ? and3(typeHolds, evaluateCondition(typed[3], (t) => mediaFeature(t, env))) : typeHolds;
      if (typed[1]?.toLowerCase() === 'not') v = not3(v);
    } else {
      v = evaluateCondition(q, (t) => mediaFeature(t, env));
    }
    r = or3(r, v);
  }
  return r;
}

// ─── The window ───

/** Animation frames, run when the test lets the page lay out. */
export class Frames {
  private next = 1;
  readonly queue = new Map<number, (time: number) => void>();
  request = (fn: (time: number) => void) => { const id = this.next++; this.queue.set(id, fn); return id; };
  cancel = (id: number) => { this.queue.delete(id); };
  /** The frames due now, taken off the queue (one a frame requests runs at the next frame). */
  take() { const due = [...this.queue.values()]; this.queue.clear(); return due; }
}

interface ObserverRecord { cb: (entries: unknown[], o: unknown) => void; seen: Map<LiveElement, string>; self: unknown }
/** Resize observers, which hear of every observed box whose size changed since they last heard (at first, its size). */
export class LiveResizeObservers {
  readonly live = new Set<ObserverRecord>();
  readonly Ctor: new (cb: (entries: unknown[], o: unknown) => void) => { observe(el: LiveElement): void; unobserve(el: LiveElement): void; disconnect(): void };
  constructor() {
    const all = this.live;
    this.Ctor = class {
      private readonly me: ObserverRecord;
      constructor(cb: (entries: unknown[], o: unknown) => void) { this.me = { cb, seen: new Map(), self: this }; all.add(this.me); }
      observe(el: LiveElement) { this.me.seen.set(el, ''); }
      unobserve(el: LiveElement) { this.me.seen.delete(el); }
      disconnect() { this.me.seen.clear(); all.delete(this.me); }
    };
  }
  /** Each observer whose boxes changed, with its callback's entries; the sizes are recorded as heard. */
  due(): (() => void)[] {
    const calls: (() => void)[] = [];
    for (const o of [...this.live]) {
      const changed = [...o.seen.entries()].filter(([el, was]) => sizeKey(el) !== was).map(([el]) => el);
      if (!changed.length) continue;
      for (const el of changed) o.seen.set(el, sizeKey(el));
      const entries = changed.map((target) => {
        const box = target.ownerDocument!.layout(target);
        const size = [{ inlineSize: box.width, blockSize: box.height }];
        return { target, contentRect: rect(box), borderBoxSize: size, contentBoxSize: size, devicePixelContentBoxSize: size };
      });
      calls.push(() => o.cb(entries, o.self));
    }
    return calls;
  }
}
const sizeKey = (el: LiveElement) => { const b = el.ownerDocument!.layout(el); return `${b.width}x${b.height}`; };

/** Storage kept in memory, as a browser keeps it for the page. */
export const memoryStorage = (seed: Record<string, string> = {}) => {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
  };
};
export type LiveStorage = ReturnType<typeof memoryStorage>;
/** Storage a sandboxed webview refuses: every call throws. */
export const blockedStorage = (): LiveStorage => {
  const refuse = () => { throw new Error('SecurityError: storage is blocked'); };
  return { getItem: refuse, setItem: refuse, removeItem: refuse, clear: refuse, length: 0, key: refuse } as unknown as LiveStorage;
};

/** A style declaration that reports no value for any property: the live DOM does not compute styles. */
const NO_COMPUTED_STYLE: Record<string, unknown> = new Proxy({ getPropertyValue: () => '', getPropertyPriority: () => '' }, {
  get: (t, k) => (typeof k === 'string' && k in t ? (t as Record<string, unknown>)[k] : typeof k === 'string' ? '' : undefined),
});

export interface LiveWindowOptions {
  width?: number;
  height?: number;
  navigator?: object;
  localStorage?: LiveStorage;
  sessionStorage?: LiveStorage;
}

/** The window the App and React DOM read while the App is mounted. */
export class LiveWindow extends LiveEventTarget {
  readonly HTMLIFrameElement = class {};
  innerWidth: number;
  innerHeight: number;
  readonly devicePixelRatio = 1;
  readonly navigator: object;
  readonly localStorage: LiveStorage;
  readonly sessionStorage: LiveStorage;
  readonly animationFrames = new Frames();
  readonly location = { href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:', host: 'localhost', hostname: 'localhost', port: '', pathname: '/', search: '', hash: '', reload() {}, assign() {}, replace() {} };
  constructor(readonly document: LiveDocument, opts: LiveWindowOptions = {}) {
    super();
    document.defaultView = this;
    this.innerWidth = opts.width ?? 1280;
    this.innerHeight = opts.height ?? 800;
    this.navigator = opts.navigator ?? globalThis.navigator;
    this.localStorage = opts.localStorage ?? memoryStorage();
    this.sessionStorage = opts.sessionStorage ?? memoryStorage();
  }
  get window() { return this; }
  get self() { return this; }
  get top() { return this; }
  get parent() { return this; }
  get outerWidth() { return this.innerWidth; }
  get outerHeight() { return this.innerHeight; }
  get screen() { return { width: this.innerWidth, height: this.innerHeight, availWidth: this.innerWidth, availHeight: this.innerHeight }; }
  // Timers go to the test's clock at call time, so fake timers hold them.
  setTimeout(fn: () => void, ms?: number, ...args: unknown[]) { return globalThis.setTimeout(fn, ms, ...args); }
  clearTimeout(id: ReturnType<typeof setTimeout>) { globalThis.clearTimeout(id); }
  setInterval(fn: () => void, ms?: number, ...args: unknown[]) { return globalThis.setInterval(fn, ms, ...args); }
  clearInterval(id: ReturnType<typeof setInterval>) { globalThis.clearInterval(id); }
  requestAnimationFrame = (fn: (time: number) => void) => this.animationFrames.request(fn);
  cancelAnimationFrame = (id: number) => this.animationFrames.cancel(id);
  /** A media query list for `query`, evaluated in the reported environment; a feature it does not model throws, naming it. */
  matchMedia(query: string) {
    const r = evaluateMediaQuery(query, { width: this.innerWidth, height: this.innerHeight });
    if (r === 'unknown') throw new Error(`the live window cannot evaluate the media query "${query}"`);
    return { matches: r, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true };
  }
  getComputedStyle(_el?: unknown) { return NO_COMPUTED_STYLE; }
  getSelection() { return null; }
  scrollTo() {}
  scrollBy() {}
  focus() {}
  blur() {}
  print() {}
  open() { return null; }
}

// ─── Markup: serialising and parsing ───

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, '&quot;');

/**
 * Serialises a node: as XML (XMLSerializer: an element whose namespace differs from its parent's
 * declares it, an empty element closes itself, an xlink attribute declares its prefix) or as HTML
 * (innerHTML). An element's inline style is written as its style attribute.
 */
function serialize(n: LiveNode, mode: 'xml' | 'html', parentNs: string | null, prefixes: Set<string>): string {
  if (n instanceof LiveText) return escapeText(n.nodeValue);
  if (n instanceof LiveComment) return `<!--${n.nodeValue}-->`;
  if (n instanceof LiveDocument) return serialize(n.documentElement, mode, null, prefixes);
  if (!(n instanceof LiveElement)) return '';
  // A namespace the element must declare comes first, as a browser's serializer writes it.
  const attrs = new Map<string, string>();
  const scope = new Set(prefixes);
  if (mode === 'xml') {
    if (n.namespaceURI !== parentNs && !n.attributes.has('xmlns')) attrs.set('xmlns', n.namespaceURI);
    if ([...n.attributes.keys()].some((k) => k.startsWith('xlink:')) && !scope.has('xlink') && !n.attributes.has('xmlns:xlink')) attrs.set('xmlns:xlink', XLINK_NS);
  }
  for (const [k, v] of n.attributes) attrs.set(k, v);
  const css = n.style.cssText;
  if (css && !attrs.has('style')) attrs.set('style', css);
  if (attrs.has('xmlns:xlink')) scope.add('xlink');
  const open = `<${n.localName}${[...attrs].map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('')}`;
  const inner = n.childNodes.map((c) => serialize(c, mode, n.namespaceURI, scope)).join('');
  if (n.namespaceURI === XHTML_NS && VOID_ELEMENTS.has(n.localName)) return mode === 'xml' ? `${open} />` : `${open}>`;
  if (mode === 'xml' && n.namespaceURI !== XHTML_NS && !inner) return `${open}/>`;
  return `${open}>${inner}</${n.localName}>`;
}

/** Serialises nodes as XML, as the browser's XMLSerializer does for the figures the App exports. */
export class LiveXMLSerializer {
  serializeToString(node: LiveNode): string { return serialize(node, 'xml', null, new Set()); }
}

const decodeEntities = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_m, e: string) => {
  const k = e.toLowerCase();
  if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
  if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10));
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[k];
});
/**
 * Parses well-formed markup (quoted, unquoted or bare attributes; void and self-closing elements;
 * comments) into live nodes. Inside <svg> elements are in the SVG namespace, back in HTML inside
 * <foreignObject>. A tag closed out of order throws, naming it.
 */
export function parseMarkup(markup: string, doc: LiveDocument, contextNs: string = XHTML_NS): LiveNode[] {
  const root = { childNodes: [] as LiveNode[] };
  const stack: { node: LiveElement | null; ns: string }[] = [{ node: null, ns: contextNs }];
  const add = (n: LiveNode) => { const top = stack[stack.length - 1].node; if (top) top.appendChild(n); else root.childNodes.push(n); };
  const re = /<!--([\s\S]*?)-->|<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markup))) {
    if (m[1] !== undefined) { add(doc.createComment(m[1])); continue; }
    if (m[6] !== undefined) { add(doc.createTextNode(decodeEntities(m[6]))); continue; }
    const [, , closing, rawTag, rawAttrs, selfClosing] = m;
    const top = stack[stack.length - 1];
    if (closing) {
      if (!top.node || top.node.localName.toLowerCase() !== rawTag.toLowerCase()) throw new Error(`markup closes <${rawTag}> inside <${top.node?.localName ?? 'the fragment'}>`);
      stack.pop();
      continue;
    }
    const ns = rawTag.toLowerCase() === 'svg' ? SVG_NS : top.ns;
    const el = ns === SVG_NS ? doc.createElementNS(SVG_NS, rawTag) : doc.createElement(rawTag);
    for (const a of rawAttrs.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) el.setAttribute(a[1], decodeEntities(a[2] ?? a[3] ?? a[4] ?? ''));
    add(el);
    const isVoid = ns === XHTML_NS && VOID_ELEMENTS.has(el.localName);
    if (!selfClosing && !isVoid) stack.push({ node: el, ns: ns === SVG_NS && el.localName === 'foreignObject' ? XHTML_NS : ns });
  }
  if (stack.length > 1) throw new Error(`markup leaves <${stack[stack.length - 1].node!.localName}> open`);
  return root.childNodes;
}

/** `instanceof` checks App code makes (`target instanceof Element`), answered for live nodes. */
export const liveDomConstructors = {
  Node: LiveNode,
  Element: LiveElement,
  Text: LiveText,
  Comment: LiveComment,
  Document: LiveDocument,
  HTMLElement: class { static [Symbol.hasInstance](x: unknown) { return x instanceof LiveElement && x.namespaceURI === XHTML_NS; } },
  SVGElement: class { static [Symbol.hasInstance](x: unknown) { return x instanceof LiveElement && x.namespaceURI === SVG_NS; } },
};
