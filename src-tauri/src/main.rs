// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
#[cfg(any(target_os = "macos", test))]
mod native_menu;

use commands::bio_commands::{
    cmd_batch_sequence_stats, cmd_genome_tracks, cmd_genome_viewport, cmd_pairwise_align,
    cmd_platform_diagnostics, cmd_reverse_complement, cmd_rust_bio_invoke, cmd_sequence_stats,
};
use commands::fs_commands::{
    cmd_native_open_files_dialog, cmd_native_save_file_dialog, cmd_read_dropped_file_bytes,
    cmd_take_pending_open_files,
};
use commands::window_commands::{
    cmd_ack_quit_request, cmd_app_exit, cmd_print_webview, cmd_set_confirm_before_quit, cmd_sync_native_menu_state,
    cmd_window_start_dragging, cmd_window_toggle_maximize,
};
use commands::tree_tool_commands::{
    cmd_cancel_external_tree, cmd_detect_tree_programs, cmd_run_external_tree,
};
use commands::AppBackendState;
use tauri::{Emitter, Manager};

/// Records the files of a native drop onto the window as the files the WebView may read
/// ([`AppBackendState::grant_dropped_files`], D0186). Called from `on_window_event`, on the main
/// thread, for the same event Tauri has just emitted to the frontend as `tauri://drag-drop`. Only a
/// drop grants: a drag that enters the window and leaves grants nothing.
fn grant_native_drop(state: &AppBackendState, event: &tauri::WindowEvent) {
    if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
        state.grant_dropped_files(paths);
    }
}

/// Takes a second launch that tauri-plugin-single-instance handed to this app on Windows or Linux
/// (D0213): queues the files its `argv` names, resolved against its `cwd`
/// ([`commands::forward_second_instance`]), tells the frontend to take them when any are queued, and
/// unminimizes and focuses the main window. Compiled on every OS so macOS `cargo test` type-checks
/// it, though only the Windows and Linux builds register it.
#[cfg_attr(target_os = "macos", allow(dead_code))]
fn on_second_instance<R: tauri::Runtime>(app: &tauri::AppHandle<R>, argv: Vec<String>, cwd: String) {
    let state = app.state::<AppBackendState>();
    if commands::forward_second_instance(&state, argv, &cwd) > 0 {
        let _ = app.emit("mbc://open-files-pending", ());
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn main() {
    let backend_state = AppBackendState::default();
    // Windows / Linux file associations launch the app with the document path.
    backend_state.queue_open_files(commands::open_file_args(std::env::args().skip(1)));

    let builder = tauri::Builder::default();
    // A second launch on Windows or Linux (a double-clicked file, or `molbiocraft-desktop rel/x.gb`)
    // hands its arguments and working directory to this app and exits, so the file opens here
    // instead of in a second window (D0213). On Linux this needs a D-Bus session bus; without one
    // the plugin lets the launch go ahead as a second app. Registered first: the plugin must detect
    // the second instance before the rest of the setup runs. macOS sends RunEvent::Opened instead.
    #[cfg(any(windows, target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(on_second_instance));
    let builder = builder
        .manage(backend_state)
        .setup(|_app| {
            // The macOS menu bar, built from the spec generated from the command registry
            // (src-tauri/native-menu.json, US-01M6Q159). A spec that does not load keeps the
            // default menu rather than stopping the app.
            #[cfg(target_os = "macos")]
            match native_menu::build(_app.handle()) {
                Ok(menu) => {
                    _app.set_menu(menu)?;
                }
                Err(e) => eprintln!("MolBioCraft: the native menu was not built ({e}); the default menu stays"),
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            let _ = app.emit("mbc://native-menu", event.id().0.as_str());
        })
        .on_window_event(|window, event| {
            grant_native_drop(&window.state::<AppBackendState>(), event);
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppBackendState>();
                if state.should_veto_close(std::time::Instant::now()) {
                    api.prevent_close();
                    let _ = window
                        .app_handle()
                        .emit("mbc://native-menu", "app:request-quit");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            cmd_platform_diagnostics,
            cmd_sequence_stats,
            cmd_batch_sequence_stats,
            cmd_reverse_complement,
            cmd_pairwise_align,
            cmd_rust_bio_invoke,
            cmd_detect_tree_programs,
            cmd_run_external_tree,
            cmd_cancel_external_tree,
            cmd_genome_viewport,
            cmd_genome_tracks,
            cmd_read_dropped_file_bytes,
            cmd_native_open_files_dialog,
            cmd_native_save_file_dialog,
            cmd_take_pending_open_files,
            cmd_window_start_dragging,
            cmd_window_toggle_maximize,
            cmd_print_webview,
            cmd_ack_quit_request,
            cmd_sync_native_menu_state,
            cmd_set_confirm_before_quit,
            cmd_app_exit
        ]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building MolBioCraft Tauri application");

    app.run(|app_handle, event| {
        // macOS delivers file-association / Finder "Open With" requests as an
        // Apple Event, both at launch and while running.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = &event {
            let paths: Vec<std::path::PathBuf> =
                urls.iter().filter_map(|u| u.to_file_path().ok()).collect();
            if !paths.is_empty() {
                app_handle.state::<AppBackendState>().queue_open_files(paths);
                let _ = app_handle.emit("mbc://open-files-pending", ());
            }
        }
        if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
            let state = app_handle.state::<AppBackendState>();
            if code.is_none() && state.should_veto_close(std::time::Instant::now()) {
                api.prevent_exit();
                let _ = app_handle.emit("mbc://native-menu", "app:request-quit");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{commands, AppBackendState};

    /// `forward_second_instance` returns the number of files now queued, counting those an earlier
    /// launch queued, not whether this launch queued any (BG-01M7V0FN).
    #[test]
    fn second_instance_returns_the_number_of_files_now_queued() {
        let tmp = std::env::temp_dir().join(format!("mbc_second_instance_count_{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        for f in ["a.gb", "b.fasta", "c.mbc"] {
            std::fs::write(tmp.join(f), ">x\nACGT\n").unwrap();
        }
        let argv = |items: &[&str]| items.iter().map(|s| s.to_string()).collect::<Vec<String>>();
        let cwd = tmp.to_string_lossy().into_owned();
        let state = AppBackendState::default();

        assert_eq!(commands::forward_second_instance(&state, argv(&["molbiocraft-desktop", "a.gb", "b.fasta"]), &cwd), 2);
        assert_eq!(commands::forward_second_instance(&state, argv(&["molbiocraft-desktop", "c.mbc", "a.gb"]), &cwd), 3, "the files already queued are counted");
        assert_eq!(commands::forward_second_instance(&state, argv(&["molbiocraft-desktop", "--flag"]), &cwd), 3, "a launch naming no file leaves the count");
        assert_eq!(state.take_open_files(), vec![tmp.join("a.gb"), tmp.join("b.fasta"), tmp.join("c.mbc")]);
        assert_eq!(commands::forward_second_instance(&state, argv(&["molbiocraft-desktop", "missing.gb"]), &cwd), 0, "an empty queue counts 0");
        let _ = std::fs::remove_dir_all(tmp);
    }
}
