// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! The native macOS menu bar, built from `src-tauri/native-menu.json` (US-01M6Q159).
//!
//! The file is generated from the command registry (`src/core/commandRegistry.ts`) by
//! `scripts/gen_native_menu.mjs` (`npm run menu:native`), and the frontend test
//! `src/__tests__/nativeMenuRegistry.test.ts` fails while the two differ. This module holds no menu
//! item of its own: it loads the file, checks it ([`model`]: labels escaped, every accelerator
//! parses, ids unique) and, on macOS, makes the AppKit menu from it ([`build`]). Every item's id is
//! sent to the frontend dispatcher through `mbc://native-menu` (App.tsx `onMenuAction`).
//!
//! Loading and checking are platform-independent, so the tests run on every CI runner; only
//! [`build`] needs AppKit.

use serde::Deserialize;

/// The spec the menu is built from, as generated.
pub const SPEC_JSON: &str = include_str!("../native-menu.json");

/// An AppKit item with no registry command behind it. Undo and Redo are not among them: they are
/// custom items (`edit:undo`, `edit:redo`) the frontend routes to the document undo stack.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Predefined {
    Services,
    Hide,
    HideOthers,
    ShowAll,
    Cut,
    Copy,
    Paste,
    SelectAll,
    Minimize,
    Maximize,
    Fullscreen,
}

/// One entry of a menu, as the spec writes it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum NativeMenuNode {
    Item {
        id: String,
        label: String,
        #[serde(default)]
        accel: Option<String>,
    },
    Submenu { label: String, items: Vec<NativeMenuNode> },
    Separator,
    Predefined { kind: Predefined },
}

/// A top-level menu of the bar.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativeTopMenu {
    pub label: String,
    pub items: Vec<NativeMenuNode>,
}

/// The whole spec: the bar's menus in order, and the ids the dispatcher runs that no menu item sends.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct NativeMenuSpec {
    pub generated: String,
    pub menus: Vec<NativeTopMenu>,
    pub dispatch_only: Vec<String>,
}

/// Reads a spec; a malformed one is an error naming what serde found, never a panic.
pub fn parse(json: &str) -> Result<NativeMenuSpec, String> {
    serde_json::from_str(json).map_err(|e| format!("native-menu.json is not a native menu spec: {e}"))
}

/// One entry of the menu as AppKit gets it: labels with `&` escaped as `&&` (AppKit would read a
/// lone `&` as a mnemonic marker), accelerators checked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MenuModelNode {
    Item { id: String, label: String, accel: Option<String> },
    Submenu { label: String, items: Vec<MenuModelNode> },
    Separator,
    Predefined(Predefined),
}

/// A label as AppKit should show it: a literal `&` is written `&&`.
pub fn escape_label(label: &str) -> String {
    label.replace('&', "&&")
}

/// The platform-independent menu: each top-level menu with its entries. Refuses a spec with an
/// empty label, an accelerator muda cannot parse, or an id on two items, naming it.
pub fn model(spec: &NativeMenuSpec) -> Result<Vec<(String, Vec<MenuModelNode>)>, String> {
    let mut seen = std::collections::HashSet::new();
    fn walk(
        items: &[NativeMenuNode],
        path: &str,
        seen: &mut std::collections::HashSet<String>,
    ) -> Result<Vec<MenuModelNode>, String> {
        items
            .iter()
            .map(|n| match n {
                NativeMenuNode::Item { id, label, accel } => {
                    if label.trim().is_empty() || id.trim().is_empty() {
                        return Err(format!("{path}: an item has an empty id or label ({id:?}, {label:?})"));
                    }
                    if !seen.insert(id.clone()) {
                        return Err(format!("{path}: the id {id} is on two items"));
                    }
                    if let Some(a) = accel {
                        validate_accelerator(a).map_err(|e| format!("{path} › {label}: {e}"))?;
                    }
                    Ok(MenuModelNode::Item { id: id.clone(), label: escape_label(label), accel: accel.clone() })
                }
                NativeMenuNode::Submenu { label, items } => {
                    if label.trim().is_empty() {
                        return Err(format!("{path}: a submenu has no label"));
                    }
                    let inner = walk(items, &format!("{path} › {label}"), seen)?;
                    Ok(MenuModelNode::Submenu { label: escape_label(label), items: inner })
                }
                NativeMenuNode::Separator => Ok(MenuModelNode::Separator),
                NativeMenuNode::Predefined { kind } => Ok(MenuModelNode::Predefined(*kind)),
            })
            .collect()
    }
    spec.menus
        .iter()
        .map(|m| Ok((escape_label(&m.label), walk(&m.items, &m.label, &mut seen)?)))
        .collect()
}

/// Checks an accelerator against the grammar Tauri's menus parse it with. Tauri hands the string
/// to muda, which does not re-export its parser, so this copies muda 0.20.0's
/// `src/accelerator/mod.rs` (`split_key_and_modifiers`, `parse_modifier`, `parse_code`,
/// `parse_named_code`): modifiers and key split at the last `+`, each modifier one of muda's names,
/// the key one of muda's named codes (case-insensitive). muda also falls back to
/// `keyboard_types::Code`'s own names; that fallback is not copied, so a key only it knows is
/// refused here (stricter, never looser).
pub fn validate_accelerator(accelerator: &str) -> Result<(), String> {
    let accel = accelerator.trim();
    if accel.is_empty() {
        return Err("an empty accelerator".to_string());
    }
    let (mods, key) = match accel.rfind('+') {
        Some(pos) => {
            let raw_key = &accel[pos + 1..];
            if raw_key.trim().is_empty() {
                (accel[..pos].trim_end_matches('+'), "+")
            } else {
                (&accel[..pos], raw_key.trim())
            }
        }
        None => ("", accel),
    };
    if !mods.is_empty() {
        for token in mods.split('+') {
            let token = token.trim();
            if token.is_empty() {
                return Err(format!("{accelerator}: an empty modifier"));
            }
            let known = matches!(
                token.to_uppercase().as_str(),
                "OPTION" | "ALT" | "CONTROL" | "CTRL" | "COMMAND" | "CMD" | "SUPER" | "META" | "SHIFT"
                    | "COMMANDORCONTROL" | "COMMANDORCTRL" | "CMDORCTRL" | "CMDORCONTROL"
            );
            if !known {
                return Err(format!("{accelerator}: {token} is not a modifier"));
            }
        }
    }
    if key.is_empty() {
        return Err(format!("{accelerator}: no key"));
    }
    if !NAMED_CODES.contains(&key.to_uppercase().as_str()) {
        return Err(format!("{accelerator}: {key} is not a key muda knows"));
    }
    Ok(())
}

/// muda 0.20.0 `parse_named_code`'s accepted names (src/accelerator/mod.rs), in its order.
const NAMED_CODES: &[&str] = &[
    "BACKQUOTE", "`", "BACKSLASH", "\\", "BRACKETLEFT", "[", "BRACKETRIGHT", "]", "COMMA", ",",
    "DIGIT0", "0", "DIGIT1", "1", "DIGIT2", "2", "DIGIT3", "3", "DIGIT4", "4", "DIGIT5", "5",
    "DIGIT6", "6", "DIGIT7", "7", "DIGIT8", "8", "DIGIT9", "9", "EQUAL", "=", "INTLBACKSLASH",
    "INTLRO", "INTLYEN", "KEYA", "A", "KEYB", "B", "KEYC", "C", "KEYD", "D", "KEYE", "E", "KEYF",
    "F", "KEYG", "G", "KEYH", "H", "KEYI", "I", "KEYJ", "J", "KEYK", "K", "KEYL", "L", "KEYM", "M",
    "KEYN", "N", "KEYO", "O", "KEYP", "P", "KEYQ", "Q", "KEYR", "R", "KEYS", "S", "KEYT", "T",
    "KEYU", "U", "KEYV", "V", "KEYW", "W", "KEYX", "X", "KEYY", "Y", "KEYZ", "Z", "MINUS", "-",
    "PERIOD", ".", "QUOTE", "'", "SEMICOLON", ";", "SLASH", "/", "ALTLEFT", "ALTRIGHT", "BACKSPACE",
    "CAPSLOCK", "CONTROLLEFT", "CONTROLRIGHT", "ENTER", "METALEFT", "METARIGHT", "SHIFTLEFT",
    "SHIFTRIGHT", "SPACE", "TAB", "CONVERT", "KANAMODE", "LANG1", "LANG2", "LANG3", "LANG4",
    "LANG5", "NONCONVERT", "DELETE", "END", "HELP", "HOME", "INSERT", "PAGEDOWN", "PAGEUP",
    "PRINTSCREEN", "SCROLLLOCK", "ARROWDOWN", "DOWN", "ARROWLEFT", "LEFT", "ARROWRIGHT", "RIGHT",
    "ARROWUP", "UP", "CONTEXTMENU", "MENU", "APPS", "NUMLOCK", "NUMPAD0", "NUM0", "NUMPAD1", "NUM1",
    "NUMPAD2", "NUM2", "NUMPAD3", "NUM3", "NUMPAD4", "NUM4", "NUMPAD5", "NUM5", "NUMPAD6", "NUM6",
    "NUMPAD7", "NUM7", "NUMPAD8", "NUM8", "NUMPAD9", "NUM9", "NUMPADADD", "NUMADD", "NUMPADPLUS",
    "NUMPLUS", "NUMPADBACKSPACE", "NUMPADCLEAR", "NUMCLEAR", "NUMPADCLEARENTRY", "NUMPADCOMMA",
    "NUMPADDECIMAL", "NUMDECIMAL", "NUMPADDIVIDE", "NUMDIVIDE", "NUMPADENTER", "NUMENTER",
    "NUMPADEQUAL", "NUMEQUAL", "NUMPADHASH", "NUMPADMEMORYADD", "NUMPADMEMORYCLEAR",
    "NUMPADMEMORYRECALL", "NUMPADMEMORYSTORE", "NUMPADMEMORYSUBTRACT", "NUMPADMULTIPLY",
    "NUMMULTIPLY", "NUMPADPARENLEFT", "NUMPADPARENRIGHT", "NUMPADSTAR", "NUMPADSUBTRACT",
    "NUMSUBTRACT", "ESCAPE", "ESC", "FN", "FNLOCK", "PAUSE", "PAUSEBREAK", "BROWSERBACK",
    "BROWSERFAVORITES", "BROWSERFORWARD", "BROWSERHOME", "BROWSERREFRESH", "BROWSERSEARCH",
    "BROWSERSTOP", "EJECT", "LAUNCHAPP1", "LAUNCHAPPLICATION1", "MYCOMPUTER", "LAUNCHAPP2",
    "LAUNCHAPPLICATION2", "CALCULATOR", "LAUNCHMAIL", "LAUNCHMEDIAPLAYER", "MEDIAPLAYPAUSE",
    "MEDIASELECT", "MEDIASTOP", "MEDIATRACKNEXT", "MEDIATRACKPREVIOUS", "POWER", "SLEEP",
    "AUDIOVOLUMEDOWN", "VOLUMEDOWN", "AUDIOVOLUMEUP", "VOLUMEUP", "AUDIOVOLUMEMUTE", "VOLUMEMUTE",
    "WAKEUP", "HYPER", "SUPER", "TURBO", "ABORT", "RESUME", "SUSPEND", "AGAIN", "COPY", "CUT",
    "FIND", "OPEN", "PASTE", "PROPS", "SELECT", "UNDO", "HIRAGANA", "KATAKANA", "UNIDENTIFIED",
    "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12", "F13", "F14", "F15",
    "F16", "F17", "F18", "F19", "F20", "F21", "F22", "F23", "F24", "F25", "F26", "F27", "F28",
    "F29", "F30", "F31", "F32", "F33", "F34", "F35", "BRIGHTNESSDOWN", "BRIGHTNESSUP",
    "DISPLAYTOGGLEINTEXT", "KEYBOARDLAYOUTSELECT", "LAUNCHASSISTANT", "LAUNCHCONTROLPANEL",
    "LAUNCHSCREENSAVER", "MAILFORWARD", "MAILREPLY", "MAILSEND", "MEDIAFASTFORWARD", "MEDIAPAUSE",
    "MEDIAPLAY", "MEDIARECORD", "MEDIAREWIND", "MICROPHONEMUTETOGGLE", "PRIVACYSCREENTOGGLE",
    "SELECTTASK", "SHOWALLWINDOWS", "ZOOMTOGGLE",
];

/// The macOS menu bar from the generated spec. Returns an error rather than panicking on a spec
/// that does not load; the caller then keeps the default menu.
#[cfg(target_os = "macos")]
pub fn build<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<tauri::menu::Menu<R>, String> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
    let menus = model(&parse(SPEC_JSON)?)?;
    let err = |e: tauri::Error| e.to_string();
    fn fill<R: tauri::Runtime>(
        app: &tauri::AppHandle<R>,
        sub: &Submenu<R>,
        items: &[MenuModelNode],
    ) -> tauri::Result<()> {
        for n in items {
            match n {
                MenuModelNode::Item { id, label, accel } => {
                    sub.append(&MenuItem::with_id(app, id.as_str(), label, true, accel.as_deref())?)?
                }
                MenuModelNode::Submenu { label, items } => {
                    let inner = Submenu::new(app, label, true)?;
                    fill(app, &inner, items)?;
                    sub.append(&inner)?
                }
                MenuModelNode::Separator => sub.append(&PredefinedMenuItem::separator(app)?)?,
                MenuModelNode::Predefined(kind) => sub.append(&match kind {
                    Predefined::Services => PredefinedMenuItem::services(app, None)?,
                    Predefined::Hide => PredefinedMenuItem::hide(app, None)?,
                    Predefined::HideOthers => PredefinedMenuItem::hide_others(app, None)?,
                    Predefined::ShowAll => PredefinedMenuItem::show_all(app, None)?,
                    Predefined::Cut => PredefinedMenuItem::cut(app, None)?,
                    Predefined::Copy => PredefinedMenuItem::copy(app, None)?,
                    Predefined::Paste => PredefinedMenuItem::paste(app, None)?,
                    Predefined::SelectAll => PredefinedMenuItem::select_all(app, None)?,
                    Predefined::Minimize => PredefinedMenuItem::minimize(app, None)?,
                    Predefined::Maximize => PredefinedMenuItem::maximize(app, None)?,
                    Predefined::Fullscreen => PredefinedMenuItem::fullscreen(app, None)?,
                })?,
            }
        }
        Ok(())
    }
    let bar = Menu::new(app).map_err(err)?;
    for (label, items) in &menus {
        let sub = Submenu::new(app, label, true).map_err(err)?;
        fill(app, &sub, items).map_err(err)?;
        bar.append(&sub).map_err(err)?;
    }
    Ok(bar)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> NativeMenuSpec {
        parse(SPEC_JSON).expect("native-menu.json loads")
    }

    /// One command of the native menu: its id, label and accelerator, as the spec gives them.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    struct NativeMenuCommand<'a> {
        id: &'a str,
        label: &'a str,
        accel: Option<&'a str>,
    }

    /// The entries of the submenu at `path` (top-level menu first).
    fn submenu<'a>(spec: &'a NativeMenuSpec, path: &[&str]) -> &'a [NativeMenuNode] {
        let top = spec.menus.iter().find(|m| m.label == path[0]).unwrap_or_else(|| panic!("no menu {}", path[0]));
        let mut items: &[NativeMenuNode] = &top.items;
        for label in &path[1..] {
            items = items
                .iter()
                .find_map(|n| match n {
                    NativeMenuNode::Submenu { label: l, items } if l == label => Some(items.as_slice()),
                    _ => None,
                })
                .unwrap_or_else(|| panic!("no submenu {label} in {path:?}"));
        }
        items
    }

    /// The commands of a submenu, in order (submenus, separators and AppKit items left out).
    fn commands<'a>(items: &'a [NativeMenuNode]) -> Vec<NativeMenuCommand<'a>> {
        items
            .iter()
            .filter_map(|n| match n {
                NativeMenuNode::Item { id, label, accel } => Some(NativeMenuCommand { id, label, accel: accel.as_deref() }),
                _ => None,
            })
            .collect()
    }

    /// Every command of the spec with its path, in menu order.
    fn all_commands(spec: &NativeMenuSpec) -> Vec<(String, NativeMenuCommand<'_>)> {
        fn walk<'a>(items: &'a [NativeMenuNode], path: &str, out: &mut Vec<(String, NativeMenuCommand<'a>)>) {
            for n in items {
                match n {
                    NativeMenuNode::Item { id, label, accel } => {
                        out.push((path.to_string(), NativeMenuCommand { id, label, accel: accel.as_deref() }))
                    }
                    NativeMenuNode::Submenu { label, items } => walk(items, &format!("{path} › {label}"), out),
                    _ => {}
                }
            }
        }
        let mut out = Vec::new();
        for m in &spec.menus {
            walk(&m.items, &m.label, &mut out);
        }
        out
    }

    /// The operation windows at the top of Tools › Alignment, before its submenus.
    fn alignment_menu_window_items(spec: &NativeMenuSpec) -> Vec<NativeMenuCommand<'_>> {
        let items = submenu(spec, &["Tools", "Alignment"]);
        let first_sub = items.iter().position(|n| matches!(n, NativeMenuNode::Submenu { .. })).unwrap_or(items.len());
        commands(&items[..first_sub])
    }

    fn command<'a>(spec: &'a NativeMenuSpec, id: &str) -> NativeMenuCommand<'a> {
        all_commands(spec).into_iter().map(|(_, c)| c).find(|c| c.id == id).unwrap_or_else(|| panic!("no item {id}"))
    }

    /// US-01M6Q159 AC3: the model the builder makes the AppKit menu from holds every entry of the
    /// spec, counted from the raw JSON rather than from serde's reading of it, with escaped labels
    /// and parsed accelerators; ids are unique; predefined entries are AppKit's; Undo and Redo are
    /// custom items. A malformed spec is an error, not a panic.
    #[test]
    fn native_menu_builds_every_item_of_the_spec() {
        let spec = spec();
        let model = model(&spec).expect("the spec builds");
        assert_eq!(spec.generated.split_whitespace().take(5).collect::<Vec<_>>(), ["Generated", "from", "src/core/commandRegistry.ts", "by", "scripts/gen_native_menu.mjs"]);

        // The raw JSON's entries, in order: (kind, id or kind, label, accel).
        let raw: serde_json::Value = serde_json::from_str(SPEC_JSON).unwrap();
        fn raw_walk(v: &serde_json::Value, out: &mut Vec<(String, String, String, Option<String>)>) {
            for n in v.as_array().unwrap() {
                let s = |k: &str| n.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
                out.push((s("type"), if s("type") == "predefined" { s("kind") } else { s("id") }, s("label"), n.get("accel").and_then(|x| x.as_str()).map(str::to_string)));
                if let Some(items) = n.get("items") {
                    raw_walk(items, out);
                }
            }
        }
        fn model_walk(items: &[MenuModelNode], out: &mut Vec<(String, String, String, Option<String>)>) {
            for n in items {
                match n {
                    MenuModelNode::Item { id, label, accel } => out.push(("item".into(), id.clone(), label.clone(), accel.clone())),
                    MenuModelNode::Submenu { label, items } => {
                        out.push(("submenu".into(), String::new(), label.clone(), None));
                        model_walk(items, out);
                    }
                    MenuModelNode::Separator => out.push(("separator".into(), String::new(), String::new(), None)),
                    MenuModelNode::Predefined(k) => out.push(("predefined".into(), format!("{k:?}"), String::new(), None)),
                }
            }
        }
        let mut want = Vec::new();
        let mut got = Vec::new();
        for (i, m) in raw["menus"].as_array().unwrap().iter().enumerate() {
            assert_eq!(model[i].0, escape_label(m["label"].as_str().unwrap()));
            raw_walk(&m["items"], &mut want);
            model_walk(&model[i].1, &mut got);
        }
        assert_eq!(model.len(), raw["menus"].as_array().unwrap().len());
        assert_eq!(got.len(), want.len(), "the model holds every entry of the spec");
        let items = want.iter().filter(|w| w.0 == "item").count();
        assert!(items > 300, "read {items} items");
        let mut ampersands = 0;
        for (g, w) in got.iter().zip(&want) {
            assert_eq!(g.0, w.0);
            match w.0.as_str() {
                "item" | "submenu" => {
                    assert_eq!(g.2, w.2.replace('&', "&&"), "{w:?}");
                    ampersands += usize::from(w.2.contains('&'));
                }
                "predefined" => {
                    let kind: Predefined = serde_json::from_value(serde_json::json!(w.1)).unwrap();
                    assert_eq!(g.1, format!("{kind:?}"), "the AppKit item {} keeps its place", w.1);
                }
                "separator" => {}
                other => panic!("an entry of unknown type {other}"),
            }
            if w.0 == "item" {
                assert_eq!(g.1, w.1);
                assert_eq!(g.3, w.3, "{} keeps its accelerator", w.1);
                if let Some(a) = &w.3 {
                    assert_eq!(validate_accelerator(a), Ok(()), "{a} parses");
                }
            }
        }
        assert!(ampersands > 0, "the spec has labels with & to escape");

        // Ids are unique across the bar.
        let ids: Vec<&str> = all_commands(&spec).iter().map(|(_, c)| c.id).collect();
        let mut unique = ids.clone();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(unique.len(), ids.len(), "every native id is on one item");

        // The predefined entries are AppKit's, in the menus macOS puts them in.
        let predefined = |path: &[&str]| -> Vec<Predefined> {
            submenu(&spec, path).iter().filter_map(|n| match n { NativeMenuNode::Predefined { kind } => Some(*kind), _ => None }).collect()
        };
        use Predefined::*;
        assert_eq!(predefined(&["MolBioCraft"]), [Services, Hide, HideOthers, ShowAll]);
        assert_eq!(predefined(&["Edit"]), [Cut, Copy, Paste, SelectAll]);
        assert_eq!(predefined(&["Window"]), [Minimize, Maximize, Fullscreen]);
        assert_eq!(want.iter().filter(|w| w.0 == "predefined").count(), 11);
        // Undo and Redo are custom items, routed to the document undo stack, not AppKit's.
        let edit = commands(submenu(&spec, &["Edit"]));
        assert_eq!(&edit[..2], [
            NativeMenuCommand { id: "edit:undo", label: "Undo", accel: Some("CmdOrCtrl+Z") },
            NativeMenuCommand { id: "edit:redo", label: "Redo", accel: Some("CmdOrCtrl+Shift+Z") },
        ]);
        assert!(!SPEC_JSON.contains("\"kind\": \"undo\"") && !SPEC_JSON.contains("\"kind\": \"redo\""));
        assert!(parse(r#"{"generated":"x","menus":[{"label":"File","items":[{"type":"predefined","kind":"undo"}]}],"dispatchOnly":[]}"#).is_err());

        // A malformed spec, a bad key or a repeated id is an error naming it.
        assert!(parse("{").is_err());
        assert!(parse(r#"{"generated":"x","menus":[{"label":"File","items":[{"type":"itme","id":"a:b","label":"B"}]}],"dispatchOnly":[]}"#).is_err());
        let bad_key = parse(r#"{"generated":"x","menus":[{"label":"File","items":[{"type":"item","id":"a:b","label":"B","accel":"CmdOrCtrl+Hyper+B"}]}],"dispatchOnly":[]}"#).unwrap();
        assert!(super::model(&bad_key).unwrap_err().contains("Hyper is not a modifier"));
        let twice = parse(r#"{"generated":"x","menus":[{"label":"File","items":[{"type":"item","id":"a:b","label":"B"},{"type":"item","id":"a:b","label":"C"}]}],"dispatchOnly":[]}"#).unwrap();
        assert!(super::model(&twice).unwrap_err().contains("a:b is on two items"));
    }

    /// The accelerator check follows muda 0.20's grammar.
    #[test]
    fn native_menu_accelerators_follow_the_muda_grammar() {
        for ok in ["CmdOrCtrl+Shift+E", "CmdOrCtrl+Alt+1", "F1", "CmdOrCtrl+,", "CmdOrCtrl+=", "CmdOrCtrl+-", "CmdOrCtrl+[", "cmdorctrl+ctrl+s", "Alt+Shift+ArrowUp"] {
            assert_eq!(validate_accelerator(ok), Ok(()), "{ok}");
        }
        for bad in ["", "CmdOrCtrl+", "Hyper+S", "CmdOrCtrl+Shift", "CmdOrCtrl++S", "CmdOrCtrl+Enterr", "Mod+S"] {
            assert!(validate_accelerator(bad).is_err(), "{bad} is refused");
        }
    }

    /// US-01M6Q159 AC6: Tools › Alignment's window items, read from the spec the builder uses, keep
    /// Align Structures… right after Pairwise Alignment…, with no key, among unique `align:…-dialog` ids.
    #[test]
    fn native_menu_spec_keeps_align_structures() {
        let spec = spec();
        let windows = alignment_menu_window_items(&spec);
        let ids: Vec<&str> = windows.iter().map(|w| w.id).collect();
        let at = ids.iter().position(|id| *id == "align:structures-dialog").expect("Align Structures… is in Tools › Alignment");
        assert_eq!(windows[at], NativeMenuCommand { id: "align:structures-dialog", label: "Align Structures…", accel: None });
        assert_eq!(windows[at - 1], NativeMenuCommand { id: "align:pairwise-dialog", label: "Pairwise Alignment…", accel: None });
        let mut unique = ids.clone();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(unique.len(), ids.len(), "{ids:?}");
        assert!(ids.len() > 10 && ids.iter().all(|id| id.starts_with("align:") && id.ends_with("-dialog")), "{ids:?}");
        // The builder makes the menu from this spec and nothing else.
        assert_eq!(model(&spec).unwrap().len(), spec.menus.len());
    }

    /// BG-01M6PXRX AC5: the Alignment menu lists Align Structures… with the other operation windows,
    /// under the id the frontend dispatcher opens the structure alignment window for (checked by
    /// src/__tests__/structureToolsWiring.test.tsx and nativeMenuRegistry.test.ts). Re-pointed by
    /// US-01M6Q159 to the spec `build` makes the menu from.
    #[test]
    fn native_menu_lists_align_structures() {
        let spec = spec();
        let built = alignment_menu_window_items(&spec);
        let ids: Vec<&str> = built.iter().map(|w| w.id).collect();
        let at = ids
            .iter()
            .position(|id| *id == "align:structures-dialog")
            .expect("Align Structures… is in the native Alignment menu");
        assert_eq!(
            built[at],
            NativeMenuCommand { id: "align:structures-dialog", label: "Align Structures…", accel: None }
        );
        // Beside the other two-input alignment window.
        assert_eq!(ids[at - 1], "align:pairwise-dialog");
        // One item per id: a repeated id would send two items to one dispatcher command.
        let mut unique = ids.clone();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(unique.len(), ids.len(), "{ids:?}");
        // Every item is an Alignment-menu window command (`align:…-dialog`).
        assert!(ids.iter().all(|id| id.starts_with("align:") && id.ends_with("-dialog")), "{ids:?}");
    }

    /// The accelerators of the whole spec: only the studios take CmdOrCtrl+<digit 1-9>, and no two
    /// items share one.
    fn assert_digit_keys_and_no_duplicates(spec: &NativeMenuSpec) {
        let mut all: Vec<&str> = all_commands(spec).iter().filter_map(|(_, c)| c.accel).collect();
        let digit_keys: Vec<&str> = all
            .iter()
            .copied()
            .filter(|a| a.len() == "CmdOrCtrl+1".len() && a.starts_with("CmdOrCtrl+") && matches!(a.as_bytes()[10], b'1'..=b'9'))
            .collect();
        assert_eq!(digit_keys, (1..=9).map(|d| format!("CmdOrCtrl+{d}")).collect::<Vec<_>>(), "only the studios take CmdOrCtrl+<digit>");
        let n = all.len();
        assert!(n > 40, "read {n} accelerators");
        all.sort_unstable();
        let mut dups: Vec<&str> = all.windows(2).filter(|w| w[0] == w[1]).map(|w| w[0]).collect();
        dups.dedup();
        assert!(dups.is_empty(), "accelerators on two items: {dups:?}");
    }

    /// US-01M6Q159 AC7 (D0015): read from the spec, View › Studios gives ⌘1-⌘9 to the first nine
    /// studios, View › Map Layout ⌥⌘1-⌥⌘3 to the layouts, File ⌘S to Save Session and ⇧⌘E to
    /// Export GenBank; no stray ⌘-digit, no accelerator on two items.
    #[test]
    fn native_menu_spec_carries_the_d0015_keys() {
        let spec = spec();
        let studios = commands(submenu(&spec, &["View", "Studios"]));
        assert_eq!(studios.len(), 11);
        for (i, s) in studios.iter().enumerate() {
            assert!(s.id.starts_with("view:studio-"), "{s:?}");
            assert_eq!(s.accel.map(str::to_string), (i < 9).then(|| format!("CmdOrCtrl+{}", i + 1)), "{s:?}");
        }
        let layouts = commands(submenu(&spec, &["View", "Map Layout"]));
        assert_eq!(
            layouts[..3].iter().map(|c| (c.id, c.accel)).collect::<Vec<_>>(),
            [("view:layout-split", Some("CmdOrCtrl+Alt+1")), ("view:layout-circular", Some("CmdOrCtrl+Alt+2")), ("view:layout-linear", Some("CmdOrCtrl+Alt+3"))]
        );
        let file: Vec<(String, NativeMenuCommand)> = all_commands(&spec).into_iter().filter(|(p, _)| p.starts_with("File")).collect();
        let key = |id: &str| file.iter().find(|(_, c)| c.id == id).and_then(|(_, c)| c.accel);
        assert_eq!(key("file:save-session"), Some("CmdOrCtrl+S"));
        assert_eq!(key("file:save-gb"), Some("CmdOrCtrl+Shift+E"));
        assert_digit_keys_and_no_duplicates(&spec);
    }

    /// US-01M6Q1CF AC4 (D0015): View › Studios, Map Layout, Save Session and Export GenBank carry the
    /// remapped keys in the spec `build` makes the menu from, and across every accelerator of the
    /// spec no other item takes CmdOrCtrl+<digit 1-9> and no two share one. Re-pointed by
    /// US-01M6Q159 from main.rs's tables to native-menu.json.
    #[test]
    fn native_menu_binds_studio_and_session_shortcuts() {
        let spec = spec();
        const STUDIO_IDS: [&str; 11] = [
            "sequence-map", "annotations", "flatfile", "cloning-gel", "vectors", "primers-crispr",
            "alignment", "phylogenetics", "sanger-contig", "protein-3d", "pipelines-ngs",
        ];
        let view_studio_items = commands(submenu(&spec, &["View", "Studios"]));
        let ids: Vec<String> = view_studio_items.iter().map(|c| c.id.to_string()).collect();
        let want: Vec<String> = STUDIO_IDS.iter().map(|s| format!("view:studio-{s}")).collect();
        assert_eq!(ids, want);
        let accels: Vec<Option<String>> = view_studio_items.iter().map(|c| c.accel.map(str::to_string)).collect();
        let want_accels: Vec<Option<String>> =
            (1..=11).map(|d| if d <= 9 { Some(format!("CmdOrCtrl+{d}")) } else { None }).collect();
        assert_eq!(accels, want_accels);
        let map_layout_items = commands(submenu(&spec, &["View", "Map Layout"]));
        assert_eq!(
            &map_layout_items[..3],
            &[
                NativeMenuCommand { id: "view:layout-split", label: "Split Map & Sequence", accel: Some("CmdOrCtrl+Alt+1") },
                NativeMenuCommand { id: "view:layout-circular", label: "Circular Map", accel: Some("CmdOrCtrl+Alt+2") },
                NativeMenuCommand { id: "view:layout-linear", label: "Linear Sequence", accel: Some("CmdOrCtrl+Alt+3") },
            ]
        );
        assert_eq!(command(&spec, "file:save-session"), NativeMenuCommand { id: "file:save-session", label: "Save Session", accel: Some("CmdOrCtrl+S") });
        assert_eq!(command(&spec, "file:save-gb"), NativeMenuCommand { id: "file:save-gb", label: "Export GenBank", accel: Some("CmdOrCtrl+Shift+E") });

        // The builder makes its items from this spec, not from copies of it.
        let src = include_str!("native_menu.rs");
        let builder = &src[src.find("pub fn build<").unwrap()..src.find("#[cfg(test)]\nmod tests").unwrap()];
        assert!(builder.contains("model(&parse(SPEC_JSON)?)?"), "build reads the generated spec");

        assert_digit_keys_and_no_duplicates(&spec);
    }
}
