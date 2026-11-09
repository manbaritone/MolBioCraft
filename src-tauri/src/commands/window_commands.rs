// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

use crate::commands::AppBackendState;
#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{State, WebviewWindow, Window};

#[cfg(target_os = "macos")]
static MACOS_WINDOW_DRAG_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Initiate native OS-level window dragging for custom titleless/overlay window headers
/// across macOS, Windows, and Linux.
///
/// On macOS (`WKWebView`), IPC arrives asynchronously after WebKit has consumed the original
/// `LeftMouseDown` `NSEvent`, causing `NSWindow::performWindowDragWithEvent:` to be a no-op
/// when `NSApp.currentEvent()` is nil. We therefore track global WindowServer cursor coordinates
/// (`NSEvent::mouseLocation()`) while `(NSEvent::pressedMouseButtons() & 1) != 0` at 125 Hz and
/// translate the `NSWindow` smoothly across any monitor.
#[tauri::command]
pub fn cmd_window_start_dragging(
    window: Window,
    state: State<'_, AppBackendState>,
) -> Result<(), String> {
    state.record_call();

    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::NSEvent;
        use std::time::Duration;
        use tauri::{LogicalPosition, Position};

        if (NSEvent::pressedMouseButtons() & 1) == 0 {
            return Ok(());
        }
        if MACOS_WINDOW_DRAG_ACTIVE
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Ok(());
        }

        let scale = window.scale_factor().unwrap_or(1.0);
        let start_outer = match window.outer_position() {
            Ok(pos) => pos.to_logical::<f64>(scale),
            Err(e) => {
                MACOS_WINDOW_DRAG_ACTIVE.store(false, Ordering::Release);
                return Err(format!("[ERR_WINDOW_DRAG] {}", e));
            }
        };
        let p0 = NSEvent::mouseLocation();

        std::thread::Builder::new()
            .name("mbc-macos-win-drag".into())
            .spawn(move || {
                let mut last_x = p0.x;
                let mut last_y = p0.y;
                while (NSEvent::pressedMouseButtons() & 1) != 0 {
                    let cur = NSEvent::mouseLocation();
                    if (cur.x - last_x).abs() >= 0.5 || (cur.y - last_y).abs() >= 0.5 {
                        last_x = cur.x;
                        last_y = cur.y;
                        let dx = cur.x - p0.x;
                        // AppKit screen Y increases upward; Tauri LogicalPosition Y increases downward.
                        let dy = -(cur.y - p0.y);
                        let _ = window.set_position(Position::Logical(LogicalPosition::new(
                            start_outer.x + dx,
                            start_outer.y + dy,
                        )));
                    }
                    std::thread::sleep(Duration::from_millis(8));
                }
                MACOS_WINDOW_DRAG_ACTIVE.store(false, Ordering::Release);
            })
            .map_err(|e| {
                MACOS_WINDOW_DRAG_ACTIVE.store(false, Ordering::Release);
                format!("[ERR_WINDOW_DRAG] {}", e)
            })?;

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        window
            .start_dragging()
            .map_err(|e| format!("[ERR_WINDOW_DRAG] {}", e))
    }
}

/// Toggle maximize / zoom state when double-clicking empty window header chrome.
#[tauri::command]
pub fn cmd_window_toggle_maximize(
    window: Window,
    state: State<'_, AppBackendState>,
) -> Result<bool, String> {
    state.record_call();
    let currently_maximized = window
        .is_maximized()
        .map_err(|e| format!("[ERR_WINDOW_STATE] {}", e))?;
    if currently_maximized {
        window
            .unmaximize()
            .map_err(|e| format!("[ERR_WINDOW_STATE] {}", e))?;
        Ok(false)
    } else {
        window
            .maximize()
            .map_err(|e| format!("[ERR_WINDOW_STATE] {}", e))?;
        Ok(true)
    }
}

/// Synchronize the user's "Confirm before quitting" / "Don't ask again" preference with
/// the native Tauri window-close and app-exit interceptors.
#[tauri::command]
pub fn cmd_set_confirm_before_quit(
    confirm: bool,
    state: State<'_, AppBackendState>,
) -> Result<bool, String> {
    state.record_call();
    state.set_confirm_before_quit(confirm);
    Ok(confirm)
}

/// Approve and perform immediate native application termination after the user confirms
/// Quit (or when "Don't ask again" has been enabled).
#[tauri::command]
pub fn cmd_app_exit(
    app: tauri::AppHandle,
    state: State<'_, AppBackendState>,
) -> Result<(), String> {
    state.record_call();
    state.set_quit_approved(true);
    app.exit(0);
    Ok(())
}

/// The frontend acknowledges a quit-confirmation request (proves it is alive,
/// see `AppBackendState::should_veto_close`).
#[tauri::command]
pub fn cmd_ack_quit_request(state: State<'_, AppBackendState>) {
    state.record_call();
    state.ack_quit_request();
}

/// Print the workbench webview (Print / Export PDF).
///
/// `window.print()` is a silent no-op inside WKWebView, so the macOS desktop
/// app must go through the native print operation. WebView2 (Windows) and
/// WebKitGTK (Linux) support it as well, giving one behaviour on all desktops.
#[tauri::command]
pub fn cmd_print_webview(
    webview_window: WebviewWindow,
    state: State<'_, AppBackendState>,
) -> Result<(), String> {
    state.record_call();
    webview_window
        .print()
        .map_err(|e| format!("[ERR_PRINT] {}", e))
}

/// Enabled/disabled state for the native menu bar, computed by the frontend
/// from the same availability rules as the in-window menus.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMenuStatePayload {
    pub session_active: bool,
    #[serde(default)]
    pub session_independent_ids: Vec<String>,
    #[serde(default)]
    pub session_independent_prefixes: Vec<String>,
    #[serde(default)]
    pub overrides: std::collections::HashMap<String, bool>,
}

impl NativeMenuStatePayload {
    /// Whether the native item `id` should be enabled.
    pub fn item_enabled(&self, id: &str) -> bool {
        if let Some(v) = self.overrides.get(id) {
            return *v;
        }
        self.session_active
            || self.session_independent_ids.iter().any(|x| x == id)
            || self.session_independent_prefixes.iter().any(|p| id.starts_with(p.as_str()))
    }
}

/// Apply menu-item enabled states to the native menu bar (macOS). Before this,
/// every native item was created enabled and never updated, so commands with
/// unmet prerequisites looked available. No-op on platforms without a native
/// application menu.
#[tauri::command]
pub fn cmd_sync_native_menu_state<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state_payload: NativeMenuStatePayload,
    state: State<'_, AppBackendState>,
) -> Result<usize, String> {
    state.record_call();
    let Some(menu) = app.menu() else {
        return Ok(0);
    };
    fn apply<R: tauri::Runtime>(
        items: Vec<tauri::menu::MenuItemKind<R>>,
        payload: &NativeMenuStatePayload,
        updated: &mut usize,
    ) -> tauri::Result<()> {
        for item in items {
            match item {
                tauri::menu::MenuItemKind::MenuItem(mi) => {
                    let id = mi.id().0.clone();
                    if id.contains(':') {
                        mi.set_enabled(payload.item_enabled(&id))?;
                        *updated += 1;
                    }
                }
                tauri::menu::MenuItemKind::Submenu(sub) => apply(sub.items()?, payload, updated)?,
                _ => {}
            }
        }
        Ok(())
    }
    let mut updated = 0usize;
    apply(
        menu.items().map_err(|e| format!("[ERR_MENU] {}", e))?,
        &state_payload,
        &mut updated,
    )
    .map_err(|e| format!("[ERR_MENU] {}", e))?;
    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::NativeMenuStatePayload;

    #[test]
    fn native_menu_state_resolution_matches_frontend_rules() {
        let payload: NativeMenuStatePayload = serde_json::from_value(serde_json::json!({
            "sessionActive": false,
            "sessionIndependentIds": ["file:open-session"],
            "sessionIndependentPrefixes": ["help:", "new-session:"],
            "overrides": { "edit:undo": true, "sequence:reverse-only": false }
        }))
        .unwrap();
        assert!(payload.item_enabled("file:open-session"));
        assert!(payload.item_enabled("help:about"));
        assert!(payload.item_enabled("new-session:blank"));
        assert!(payload.item_enabled("edit:undo"));
        assert!(!payload.item_enabled("file:save-session"));
        assert!(!payload.item_enabled("sequence:reverse-only"));

        let active = NativeMenuStatePayload { session_active: true, ..payload };
        assert!(active.item_enabled("file:save-session"));
        assert!(!active.item_enabled("sequence:reverse-only"), "explicit override wins");
    }
}
