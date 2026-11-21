// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

use crate::commands::{AppBackendState, DropGrant, FileIdentity};
use molbiocraft_core::{
    atomic_write_with_lock_retry, sanitize_workspace_path, BioEngineError,
};
use serde::Serialize;
use std::fs;
use std::io::Read;
use tauri::State;

/// Maximum text or binary workspace file size read/written via IPC (64 MiB).
const MAX_WORKSPACE_FILE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct DroppedFileBytesPayload {
    pub file_name: String,
    pub base64: String,
    pub byte_len: usize,
}

/// What one native open dialog read: the files, and `filesLeftOut`, the supported files of a picked
/// folder that Import Folder did not read past [`MAX_FOLDER_IMPORT_FILES`] (BG-01M6S17Y); 0 for
/// every other pick.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedFilesReply {
    pub files: Vec<DroppedFileBytesPayload>,
    pub files_left_out: usize,
}

impl OpenedFilesReply {
    fn picked(files: Vec<DroppedFileBytesPayload>) -> Self {
        Self { files, files_left_out: 0 }
    }
}

fn encode_base64_bytes(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    let mut i = 0;
    while i + 3 <= bytes.len() {
        let n = ((bytes[i] as u32) << 16) | ((bytes[i + 1] as u32) << 8) | (bytes[i + 2] as u32);
        out.push(TABLE[((n >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((n >> 12) & 0x3F) as usize] as char);
        out.push(TABLE[((n >> 6) & 0x3F) as usize] as char);
        out.push(TABLE[(n & 0x3F) as usize] as char);
        i += 3;
    }
    let rem = bytes.len() - i;
    if rem == 1 {
        let n = (bytes[i] as u32) << 16;
        out.push(TABLE[((n >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((n >> 12) & 0x3F) as usize] as char);
        out.push('=');
        out.push('=');
    } else if rem == 2 {
        let n = ((bytes[i] as u32) << 16) | ((bytes[i + 1] as u32) << 8);
        out.push(TABLE[((n >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((n >> 12) & 0x3F) as usize] as char);
        out.push(TABLE[((n >> 6) & 0x3F) as usize] as char);
        out.push('=');
    }
    out
}

/// Decode standard (RFC 4648) base64, ignoring ASCII whitespace. Returns an error
/// for any other non-alphabet character or malformed padding.
fn decode_base64_bytes(input: &str) -> Result<Vec<u8>, String> {
    fn value(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a') as u32 + 26),
            b'0'..=b'9' => Some((c - b'0') as u32 + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let cleaned: Vec<u8> = input.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    if !cleaned.len().is_multiple_of(4) {
        return Err("[ERR_INVALID_BASE64] payload length is not a multiple of 4".into());
    }
    let mut out = Vec::with_capacity(cleaned.len() / 4 * 3);
    for (chunk_idx, chunk) in cleaned.chunks(4).enumerate() {
        let is_last = chunk_idx == cleaned.len() / 4 - 1;
        let pad = chunk.iter().rev().take_while(|&&b| b == b'=').count();
        if pad > 2 || (pad > 0 && !is_last) {
            return Err("[ERR_INVALID_BASE64] misplaced padding".into());
        }
        let mut n: u32 = 0;
        for &b in &chunk[..4 - pad] {
            let v = value(b).ok_or_else(|| "[ERR_INVALID_BASE64] invalid character".to_string())?;
            n = (n << 6) | v;
        }
        n <<= 6 * pad as u32;
        out.push((n >> 16) as u8);
        if pad < 2 {
            out.push((n >> 8) as u8);
        }
        if pad < 1 {
            out.push(n as u8);
        }
    }
    Ok(out)
}

/// File extensions the workbench importer understands (kept in sync with the
/// browser folder-import filter in `App.tsx`).
const IMPORTABLE_EXTENSIONS: &[&str] = &[
    "mbc", "mcb", "json", "zip", "gb", "gbk", "genbank", "embl", "gff", "gff3", "gtf", "bed", "fasta",
    "fa", "fas", "fna", "faa", "ab1", "abi", "scf", "fastq", "fq", "pdb", "cif", "mmcif", "sam",
    "vcf", "nex", "nexus", "nwk", "newick", "txt", "csv", "tsv", "ena", "gbff", "gbf", "ape", "seq",
    "fsa", "ffn", "frn", "mfa", "fsta",
];

/// Proprietary plasmid (.dna/.prot/.rna), alignment (.meg) and sequence-database (.ma4/.pa4/.oa4)
/// file types MolBioCraft does not read (CR-01M6T9MT). No picker, folder import or OS open request
/// offers or reads them. A dropped one is read and handed to the frontend, whose importer refuses
/// it with the open format to export to (`unsupportedImportReason` in src/core/fileParsers.ts), so
/// that message is written in one place.
const REFUSED_DROP_EXTENSIONS: &[&str] = &["dna", "prot", "rna", "meg", "ma4", "pa4", "oa4"];

/// Maximum number of files read from one folder import.
const MAX_FOLDER_IMPORT_FILES: usize = 500;

/// The files a folder import reads: the first [`MAX_FOLDER_IMPORT_FILES`] supported files directly
/// inside the folder, by path, and how many more supported files it holds.
struct FolderImportListing {
    files: Vec<std::path::PathBuf>,
    left_out: usize,
}

/// Lists a picked folder for Import Folder: its regular, non-hidden files of a supported type, the
/// first [`MAX_FOLDER_IMPORT_FILES`] by path, counting the supported files past that limit. A symlink
/// is listed only when its target lies inside the folder ([`stays_inside`]), so a link in the
/// chosen folder cannot hand the import a file from elsewhere.
fn list_folder_import(dir: &std::path::Path) -> Result<FolderImportListing, String> {
    let real_dir = fs::canonicalize(dir).map_err(|e| BioEngineError::IoFailure(e.to_string()).to_string())?;
    let mut files: Vec<std::path::PathBuf> = fs::read_dir(dir)
        .map_err(|e| BioEngineError::IoFailure(e.to_string()).to_string())?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|p| {
            stays_inside(p, &real_dir)
                && p.is_file()
                && has_importable_extension(p)
                && !p
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.starts_with('.'))
                    .unwrap_or(true)
        })
        .collect();
    files.sort();
    let left_out = files.len().saturating_sub(MAX_FOLDER_IMPORT_FILES);
    files.truncate(MAX_FOLDER_IMPORT_FILES);
    Ok(FolderImportListing { files, left_out })
}

/// Whether the folder entry `entry` is not a symlink, or is one whose target, resolved, lies inside
/// `real_dir` (the folder's own resolved path), compared by path components.
fn stays_inside(entry: &std::path::Path, real_dir: &std::path::Path) -> bool {
    match fs::symlink_metadata(entry) {
        Ok(meta) if meta.file_type().is_symlink() => fs::canonicalize(entry)
            .map(|target| target.starts_with(real_dir))
            .unwrap_or(false),
        Ok(_) => true,
        Err(_) => false,
    }
}

/// Import Folder's reply for a picked folder: the files of [`list_folder_import`], read, and how many
/// supported files it left out.
async fn read_folder_import(dir: std::path::PathBuf) -> Result<OpenedFilesReply, String> {
    let listing = tauri::async_runtime::spawn_blocking(move || list_folder_import(&dir))
        .await
        .map_err(|e| format!("[ERR_ASYNC_JOIN] {}", e))??;
    let files = read_picked_files(listing.files).await?;
    Ok(OpenedFilesReply { files, files_left_out: listing.left_out })
}

/// The file-type refusal of the drop reader, after its drop grant ([`dropped_file_needs_sniff`]): a
/// type MolBioCraft does not handle is refused, so a dropped credential file such as `.env` is not
/// handed to the WebView.
fn require_workbench_file_type(path: &std::path::Path) -> Result<(), String> {
    if has_importable_extension(path) {
        Ok(())
    } else {
        Err(BioEngineError::PermissionDenied(format!(
            "'{}' is not a sequence, trace, structure or session file type handled by MolBioCraft",
            path.display()
        ))
        .to_string())
    }
}

/// An extensionless, non-hidden file name (e.g. an NCBI download "NC_000913").
fn is_extensionless_visible_file(path: &std::path::Path) -> bool {
    path.extension().is_none()
        && path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| !n.is_empty() && !n.starts_with('.'))
            .unwrap_or(false)
}

/// Content check for extensionless drops: the first bytes must be a GenBank
/// (`LOCUS`), EMBL (`ID   `) or FASTA (`>`) record — the formats the frontend
/// importer recognises by content. FASTQ, ABIF and ZIP are routed by file
/// extension only, so accepting them here just produced a misleading error.
/// Credential files such as /etc/passwd are refused.
fn looks_like_workbench_content(bytes: &[u8]) -> bool {
    let start = bytes
        .strip_prefix(&[0xEF, 0xBB, 0xBF][..])
        .unwrap_or(bytes);
    let first = start
        .iter()
        .position(|b| !b.is_ascii_whitespace())
        .map(|i| &start[i..])
        .unwrap_or(&[]);
    first.starts_with(b"LOCUS") || first.starts_with(b"ID   ") || first.starts_with(b">")
}

fn has_extension_in(path: &std::path::Path, list: &[&str]) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| list.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn has_importable_extension(path: &std::path::Path) -> bool {
    has_extension_in(path, IMPORTABLE_EXTENSIONS)
}

/// The gate a dropped file passes before it is read: `Ok(false)` reads it as it is (a workbench
/// type, or a refused type the frontend answers with its export hint), `Ok(true)` reads it and then
/// checks its content (an extensionless file), and any other type is refused here.
fn dropped_file_needs_sniff(path: &std::path::Path) -> Result<bool, String> {
    if has_importable_extension(path) || has_extension_in(path, REFUSED_DROP_EXTENSIONS) {
        Ok(false)
    } else if is_extensionless_visible_file(path) {
        Ok(true)
    } else {
        require_workbench_file_type(path).map(|()| false)
    }
}

/// The files of the OS open-file queue that are read: those of a workbench type.
fn importable_open_requests(paths: Vec<std::path::PathBuf>) -> Vec<std::path::PathBuf> {
    paths.into_iter().filter(|p| has_importable_extension(p)).collect()
}

/// Binary-safe file reader for native OS drag-and-drop (`tauri://drag-drop`), preserving
/// exact byte payloads for `.ab1` and `.scf` traces as well as UTF-8 flatfiles. It reads only a file
/// dropped onto the window in this launch ([`read_granted_drop`]). A dropped file of a refused
/// proprietary type is read too, so the frontend's importer can refuse it with its export hint
/// ([`REFUSED_DROP_EXTENSIONS`]).
#[tauri::command]
pub async fn cmd_read_dropped_file_bytes(
    path: String,
    state: State<'_, AppBackendState>,
) -> Result<DroppedFileBytesPayload, String> {
    state.record_call();
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || read_granted_drop(&state, &path))
        .await
        .map_err(|e| format!("[ERR_ASYNC_JOIN] {}", e))?
}

/// The WebView's request for the dropped file at `path`. A path that is not a file dropped onto the
/// window in this launch ([`AppBackendState::drop_grant`], compared after resolving symlinks) is
/// refused with ERR_SANDBOX_VIOLATION before the path guard, the type check or any read of the
/// file's metadata or bytes; resolving its symlinks is the only file-system call made first. So is
/// a dropped path that now resolves to a file nobody dropped, as changed since it was dropped. A
/// granted one then passes the path guard and [`dropped_file_needs_sniff`] and is read by
/// [`read_dropped_file`] at the path the grant resolved, and only if the file opened there is the
/// one dropped.
fn read_granted_drop(
    state: &AppBackendState,
    path: &str,
) -> Result<DroppedFileBytesPayload, String> {
    let (open_at, identity) = match state.drop_grant(std::path::Path::new(path)) {
        DropGrant::Granted { open_at, identity } => (open_at, identity),
        DropGrant::Changed => return Err(changed_since_drop(std::path::Path::new(path))),
        DropGrant::NotDropped => {
            return Err(BioEngineError::SandboxViolation(format!(
                "'{}' was not dropped onto the window in this launch, so MolBioCraft does not read it",
                path
            ))
            .to_string())
        }
    };
    let safe_path = sanitize_workspace_path(path).map_err(|e| e.to_string())?;
    // Extensionless drops are allowed when their content is a workbench record
    // (checked after reading); the browser build imports them the same way.
    let sniff_content = dropped_file_needs_sniff(&safe_path)?;
    read_dropped_file(safe_path, &open_at, identity, sniff_content)
}

/// The refusal of a dropped path whose file is no longer the one dropped (BG01M7P4Q3): replaced by
/// a hard link, deleted and recreated, or made a symlink to another file since the drop.
fn changed_since_drop(path: &std::path::Path) -> String {
    BioEngineError::SandboxViolation(format!(
        "'{}' changed since it was dropped onto the window, so MolBioCraft does not read it",
        path.display()
    ))
    .to_string()
}

/// A failed read of the dropped file at `path`, naming it: a missing file is ERR_IO_FAILURE saying it
/// was not found, one the OS will not let the app read is ERR_PERMISSION_DENIED, and any other
/// failure is ERR_IO_FAILURE with the OS's reason.
fn dropped_read_error(path: &std::path::Path, e: std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::NotFound => {
            BioEngineError::IoFailure(format!("Dropped file '{}' was not found", path.display()))
        }
        std::io::ErrorKind::PermissionDenied => BioEngineError::PermissionDenied(format!(
            "The system does not let MolBioCraft read '{}' ({})",
            path.display(),
            e
        )),
        _ => BioEngineError::IoFailure(format!("Could not read '{}' ({})", path.display(), e)),
    }
    .to_string()
}

/// Reads a dropped file that passed [`dropped_file_needs_sniff`], named by `safe_path` and opened at
/// `open_at`: a regular file of at most 64 MiB, the file opened being `identity`, the one dropped
/// (compared on the opened handle, so no file swapped in after the check is read), and, when
/// `sniff_content`, one whose content is a workbench record.
fn read_dropped_file(
    safe_path: std::path::PathBuf,
    open_at: &std::path::Path,
    identity: Option<FileIdentity>,
    sniff_content: bool,
) -> Result<DroppedFileBytesPayload, String> {
    let meta = fs::metadata(open_at).map_err(|e| dropped_read_error(&safe_path, e))?;
    if !meta.is_file() {
        return Err(BioEngineError::InvalidFilename(format!(
            "Dropped item '{}' is not a regular file",
            safe_path.display()
        ))
        .to_string());
    }
    let file = fs::File::open(open_at).map_err(|e| dropped_read_error(&safe_path, e))?;
    let opened = file.metadata().map_err(|e| dropped_read_error(&safe_path, e))?;
    if identity != Some(FileIdentity::of(&opened)) {
        return Err(changed_since_drop(&safe_path));
    }
    let too_large = |len: u64| {
        BioEngineError::PayloadTooLarge(format!(
            "Dropped file '{}' ({} bytes) exceeds 64 MiB limit",
            safe_path.display(),
            len
        ))
        .to_string()
    };
    if opened.len() > MAX_WORKSPACE_FILE_BYTES {
        return Err(too_large(opened.len()));
    }
    let mut bytes = Vec::with_capacity(opened.len() as usize);
    file.take(MAX_WORKSPACE_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| dropped_read_error(&safe_path, e))?;
    if bytes.len() as u64 > MAX_WORKSPACE_FILE_BYTES {
        return Err(too_large(bytes.len() as u64)); // grew past the limit after the size check
    }
    if sniff_content && !looks_like_workbench_content(&bytes) {
        return Err(BioEngineError::PermissionDenied(format!(
            "'{}' has no file extension and does not look like a sequence, trace or session file",
            safe_path.display()
        ))
        .to_string());
    }
    let file_name = safe_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("dropped_sequence.gb")
        .to_string();
    let byte_len = bytes.len();
    let base64 = encode_base64_bytes(&bytes);
    Ok(DroppedFileBytesPayload {
        file_name,
        base64,
        byte_len,
    })
}

/// Open a native OS file picker (`NSOpenPanel` on macOS, IFileOpenDialog on Windows, GTK's `GtkFileChooserNative`
/// (rfd's `gtk3` backend, D0212) on Linux)
/// tailored to `mode` (`"replace"`, `"merge"`, `"prefs"`, or `"import"`), returning lossless base64 byte buffers.
#[tauri::command]
pub async fn cmd_native_open_files_dialog(
    mode: String,
    state: State<'_, AppBackendState>,
) -> Result<OpenedFilesReply, String> {
    state.record_call();
    let normalized_mode = mode.trim().to_ascii_lowercase();

    let handles = match normalized_mode.as_str() {
        "replace" | "merge" => {
            let picked = rfd::AsyncFileDialog::new()
                .set_title("Open MolBioCraft Workbench Session (.mbc)")
                // Folder archives (.mcb / .zip) are sessions too; the browser
                // picker accepts them, the desktop dialog filtered them out.
                .add_filter("MolBioCraft Workbench Session", &["mbc", "mcb", "zip"])
                .pick_file()
                .await;
            picked.into_iter().collect::<Vec<_>>()
        }
        "prefs" => {
            let picked = rfd::AsyncFileDialog::new()
                .set_title("Import MolBioCraft Preferences (.json)")
                .add_filter("JSON Preferences Archive", &["json"])
                .pick_file()
                .await;
            picked.into_iter().collect::<Vec<_>>()
        }
        "folder" => {
            // Import every supported file directly inside the chosen folder.
            let Some(folder) = rfd::AsyncFileDialog::new()
                .set_title("Import Folder of Sequence Files")
                .pick_folder()
                .await
            else {
                return Ok(OpenedFilesReply::picked(Vec::new()));
            };
            return read_folder_import(folder.path().to_path_buf()).await;
        }
        _ => rfd::AsyncFileDialog::new()
            .set_title("Import Sequences, Traces, Structures & Sessions")
            .add_filter("Molecular Biology, Trace & Structure Files", IMPORTABLE_EXTENSIONS)
            .pick_files()
            .await
            .unwrap_or_default(),
    };

    if handles.is_empty() {
        return Ok(OpenedFilesReply::picked(Vec::new()));
    }

    let paths: Vec<std::path::PathBuf> = handles.into_iter().map(|h| h.path().to_path_buf()).collect();
    read_picked_files(paths).await.map(OpenedFilesReply::picked)
}

/// Hand over files the OS asked the app to open (file associations, Finder
/// `Open With…`, launch arguments). The queue is filled by `main` before the
/// webview may be listening, so the frontend pulls it on startup and whenever
/// it receives `mbc://open-files-pending`.
#[tauri::command]
pub async fn cmd_take_pending_open_files(
    state: State<'_, AppBackendState>,
) -> Result<Vec<DroppedFileBytesPayload>, String> {
    state.record_call();
    let paths = importable_open_requests(state.take_open_files());
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    read_picked_files(paths).await
}

/// Read the files chosen in a native dialog (off the async runtime) and return
/// their bytes as base64 payloads for the frontend importer.
async fn read_picked_files(
    paths: Vec<std::path::PathBuf>,
) -> Result<Vec<DroppedFileBytesPayload>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = Vec::with_capacity(paths.len());
        for path in paths {
            let meta = fs::metadata(&path).map_err(|e| {
                if e.kind() == std::io::ErrorKind::PermissionDenied {
                    BioEngineError::PermissionDenied(e.to_string()).to_string()
                } else {
                    BioEngineError::IoFailure(e.to_string()).to_string()
                }
            })?;
            if !meta.is_file() {
                continue;
            }
            if meta.len() > MAX_WORKSPACE_FILE_BYTES {
                return Err(BioEngineError::PayloadTooLarge(format!(
                    "Selected file '{}' ({} bytes) exceeds 64 MiB limit",
                    path.display(),
                    meta.len()
                ))
                .to_string());
            }
            let bytes = fs::read(&path).map_err(|e| BioEngineError::IoFailure(e.to_string()).to_string())?;
            let file_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("imported_sequence.gb")
                .to_string();
            let byte_len = bytes.len();
            let base64 = encode_base64_bytes(&bytes);
            out.push(DroppedFileBytesPayload {
                file_name,
                base64,
                byte_len,
            });
        }
        Ok(out)
    })
    .await
    .map_err(|e| format!("[ERR_ASYNC_JOIN] {}", e))?
}

/// Open a native OS save sheet (`NSSavePanel` on macOS, IFileSaveDialog on Windows, GTK's `GtkFileChooserNative`
/// (rfd's `gtk3` backend, D0212) on Linux)
/// and atomically persist the exported sequence, SVG graphic, or `.mbc` workbench session.
#[tauri::command]
pub async fn cmd_native_save_file_dialog(
    filename: String,
    content: String,
    content_base64: Option<String>,
    state: State<'_, AppBackendState>,
) -> Result<Option<String>, String> {
    state.record_call();
    // Binary exports (folder .mbc ZIP archives) arrive base64-encoded; text
    // exports arrive as UTF-8 `content`. Decode before the dialog so an invalid
    // payload is reported without asking the user for a destination.
    let bytes: Vec<u8> = match content_base64 {
        Some(b64) => decode_base64_bytes(&b64)?,
        None => content.into_bytes(),
    };
    if bytes.len() as u64 > MAX_WORKSPACE_FILE_BYTES {
        return Err(BioEngineError::PayloadTooLarge(
            "Content payload exceeds 64 MiB safety limit".into(),
        )
        .to_string());
    }

    let safe_name = std::path::Path::new(filename.trim())
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty())
        .unwrap_or("MolBioCraft_Export.gb")
        .to_string();

    let mut dialog = rfd::AsyncFileDialog::new()
        .set_title("Save MolBioCraft File")
        .set_file_name(&safe_name);

    if let Some(ext) = std::path::Path::new(&safe_name)
        .extension()
        .and_then(|e| e.to_str())
        .filter(|e| !e.is_empty())
    {
        dialog = dialog.add_filter(format!(".{} File", ext), &[ext]);
    }

    let Some(handle) = dialog.save_file().await else {
        return Ok(None);
    };

    let dest_path = handle.path().to_path_buf();
    let saved_name = dest_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&safe_name)
        .to_string();

    tauri::async_runtime::spawn_blocking(move || {
        atomic_write_with_lock_retry(&dest_path, &bytes).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("[ERR_ASYNC_JOIN] {}", e))??;

    Ok(Some(saved_name))
}

#[cfg(test)]
mod tests {
    use super::{decode_base64_bytes, encode_base64_bytes, has_importable_extension};

    #[test]
    fn base64_decode_round_trips_encoder_output() {
        for payload in [&b""[..], b"A", b"AB", b"ABC", b"PK\x03\x04\x00\xff\x10binary"] {
            let encoded = encode_base64_bytes(payload);
            assert_eq!(decode_base64_bytes(&encoded).unwrap(), payload);
        }
        assert!(decode_base64_bytes("QQ=").is_err());
        assert!(decode_base64_bytes("Q===").is_err());
        assert!(decode_base64_bytes("QQ==QQ==").is_err());
        assert!(decode_base64_bytes("Q!==").is_err());
    }

    #[test]
    fn path_commands_refuse_non_workbench_file_types() {
        use super::require_workbench_file_type;
        for ok in ["/home/u/pUC19.gb", "C:\\Data\\trace.AB1", "/tmp/session.mbc"] {
            assert!(require_workbench_file_type(std::path::Path::new(ok)).is_ok(), "{ok}");
        }
        for bad in ["/home/u/.ssh/id_rsa", "/home/u/.bashrc", "/etc/passwd", "/home/u/app/.env", "/tmp/x.exe"] {
            assert!(require_workbench_file_type(std::path::Path::new(bad)).is_err(), "{bad}");
        }
    }

    #[test]
    fn dropped_files_accept_importer_extensions_and_sniff_extensionless_records() {
        use super::{is_extensionless_visible_file, looks_like_workbench_content};
        for name in ["X56734.ena", "genome.gbff", "plasmid.ape", "read.seq", "a.FSA"] {
            assert!(has_importable_extension(std::path::Path::new(name)), "{name}");
        }
        assert!(is_extensionless_visible_file(std::path::Path::new("/dl/NC_000913")));
        assert!(!is_extensionless_visible_file(std::path::Path::new("/home/u/.bashrc")));
        assert!(looks_like_workbench_content(b"LOCUS       NC_000913  4641652 bp"));
        assert!(looks_like_workbench_content(b"\n>seq1\nACGT"));
        assert!(looks_like_workbench_content(b"ID   X56734; SV 1;"));
        assert!(!looks_like_workbench_content(b"root:x:0:0:root:/root:/bin/bash"));
        assert!(!looks_like_workbench_content(b"-----BEGIN OPENSSH PRIVATE KEY-----"));
        assert!(!looks_like_workbench_content(b"[default]\naws_access_key_id=X"));
        // Routed by extension only in the importer, so not accepted without one.
        assert!(!looks_like_workbench_content(b"@read1\nACGT\n+\nIIII"));
        assert!(!looks_like_workbench_content(b"ABIF\x00\x65"));
        assert!(!looks_like_workbench_content(b"PK\x03\x04"));
    }

    #[test]
    fn folder_import_filter_accepts_session_files_and_skips_refused_types() {
        for name in ["d.mbc", "e.fasta", "f.nexus", "g.MBC"] {
            assert!(has_importable_extension(std::path::Path::new(name)), "{name}");
        }
        for name in ["a.dna", "b.meg", "c.MA4", "d.archive", "notes.docx", "image.png", "noext"] {
            assert!(!has_importable_extension(std::path::Path::new(name)), "{name}");
        }
    }

    /// US-01M6TDCD AC3: the proprietary plasmid, alignment and sequence-database types, and the
    /// generic `.archive` that served only their removed picker, are neither offered by the import
    /// picker's filter (IMPORTABLE_EXTENSIONS) nor read by folder import or the OS open-file queue.
    /// A dropped file of a refused type is read and handed to the frontend, whose importer refuses it
    /// with its export hint; the generic file-type refusal never answers it. `.archive` is not passed
    /// through: it gets that generic refusal. Wrong implementations, and the case that catches each:
    /// a type left in IMPORTABLE_EXTENSIONS (the picker and filter checks); a refused drop answered by
    /// require_workbench_file_type (the gate is Ok and the bytes come back); `.archive` passed through
    /// with the refused types (its drop is refused by name); a queue that reads every queued file (the
    /// queue keeps only the .gb).
    #[test]
    fn refused_types_are_not_offered_but_a_dropped_one_gets_the_export_hint() {
        use super::{
            dropped_file_needs_sniff, importable_open_requests, list_folder_import,
            require_workbench_file_type, IMPORTABLE_EXTENSIONS,
        };
        let refused = ["dna", "prot", "rna", "meg", "ma4", "pa4", "oa4"];
        for ext in refused.iter().chain(["archive"].iter()) {
            assert!(!IMPORTABLE_EXTENSIONS.contains(ext), ".{ext} is offered by the import picker");
            for name in [format!("x.{ext}"), format!("x.{}", ext.to_ascii_uppercase())] {
                assert!(!has_importable_extension(std::path::Path::new(&name)), "{name}");
            }
        }

        let root = std::env::temp_dir().join(format!("mbc-refused-types-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let mut queued = Vec::new();
        for ext in refused.iter().chain(["archive", "gb"].iter()) {
            let path = root.join(format!("construct.{ext}"));
            std::fs::write(&path, format!("LOCUS       construct_{ext} 8 bp\nORIGIN\n        1 acgtacgt\n//\n")).unwrap();
            queued.push(path);
        }
        // Folder import and the OS open-file queue read only the .gb.
        let listing = list_folder_import(&root).unwrap();
        assert_eq!(listing.files, vec![root.join("construct.gb")], "folder import");
        assert_eq!(listing.left_out, 0);
        assert_eq!(importable_open_requests(queued.clone()), vec![root.join("construct.gb")], "OS open-file queue");

        // A dropped refused file reaches the frontend whole, past the generic file-type refusal.
        for ext in refused {
            let path = root.join(format!("construct.{ext}"));
            assert!(require_workbench_file_type(&path).is_err(), ".{ext} is not a workbench type");
            assert_eq!(dropped_file_needs_sniff(&path), Ok(false), ".{ext} is read as it is");
            let payload = read_dropped_now(&path, false).unwrap();
            assert_eq!(payload.file_name, format!("construct.{ext}"));
            assert_eq!(decode_base64_bytes(&payload.base64).unwrap(), std::fs::read(&path).unwrap(), ".{ext} bytes");
            assert_eq!(payload.byte_len, std::fs::metadata(&path).unwrap().len() as usize);
        }
        // .archive gets the generic refusal, by name; so does any other unknown type.
        for name in ["construct.archive", "tool.exe"] {
            let err = dropped_file_needs_sniff(&root.join(name)).unwrap_err();
            assert!(
                err.contains(name) && err.contains("is not a sequence, trace, structure or session file type handled by MolBioCraft"),
                "{name}: {err}"
            );
        }
        std::fs::remove_dir_all(&root).unwrap();
    }

    /// BG-01M6S17Y AC3: Import Folder reads at most the first 500 importable files of a folder, by
    /// name, and used to leave the rest out without a word. Its reply now carries the files read and
    /// `filesLeftOut`, the importable files it did not read. The folder here holds 700 importable
    /// files among files the import never reads (another type, hidden, a folder with an importable
    /// name), so a count of every entry, or of every file, is not the answer; the expected count is
    /// the importable files this test made, less the 500 read. Wrong implementations, and the case
    /// that catches each: the count taken after the list is cut (0, not 200); the whole count, not
    /// the files left out (700); entries the import skips counted in (726); a left-out count at
    /// exactly 500 files (500 files, 0); the read list not the first 500 by name (its names).
    #[test]
    fn import_folder_reports_files_left_out() {
        use super::{list_folder_import, read_folder_import};
        let root = std::env::temp_dir().join(format!("mbc-folder-import-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let folder = |name: &str, importable: usize| -> (std::path::PathBuf, Vec<String>) {
            let dir = root.join(name);
            std::fs::create_dir_all(&dir).unwrap();
            // written last name first, so the order the folder lists them in is not the answer
            let mut names: Vec<String> = (0..importable).map(|i| format!("clone_{i:04}.fasta")).collect();
            for n in names.iter().rev() {
                std::fs::write(dir.join(n), format!(">{n}\nACGT\n")).unwrap();
            }
            for i in 0..20 {
                std::fs::write(dir.join(format!("gel_{i:02}.png")), b"\x89PNG").unwrap();
            }
            for i in 0..4 {
                std::fs::write(dir.join(format!(".hidden_{i}.gb")), b"LOCUS x").unwrap();
            }
            std::fs::create_dir_all(dir.join("nested.gb")).unwrap();
            std::fs::write(dir.join("README"), b"notes").unwrap();
            names.sort();
            (dir, names)
        };

        for (name, importable) in [("seven-hundred", 700usize), ("five-hundred", 500), ("five-hundred-one", 501)] {
            let (dir, names) = folder(name, importable);
            let left_out = importable.saturating_sub(500);
            let listing = list_folder_import(&dir).unwrap();
            assert_eq!(listing.left_out, left_out, "{name}: importable files left out");
            let listed: Vec<String> = listing.files.iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect();
            assert_eq!(listed, names[..importable.min(500)], "{name}: the first 500 importable files by name");

            // the reply the frontend reads: the files read, and how many were left out
            let reply = tauri::async_runtime::block_on(read_folder_import(dir.clone())).unwrap();
            assert_eq!(reply.files.len() + reply.files_left_out, importable, "{name}: every importable file read or counted");
            assert_eq!(reply.files_left_out, left_out, "{name}");
            assert_eq!(reply.files.iter().map(|f| f.file_name.as_str()).collect::<Vec<_>>(), listed, "{name}");
            let json = serde_json::to_value(&reply).unwrap();
            let mut keys: Vec<&str> = json.as_object().unwrap().keys().map(String::as_str).collect();
            keys.sort_unstable();
            assert_eq!(keys, ["files", "filesLeftOut"], "{name}");
            assert_eq!(json["filesLeftOut"], serde_json::json!(left_out), "{name}");
        }
        std::fs::remove_dir_all(&root).unwrap();
    }

    /// A dropped file over the 64 MiB limit is refused as too large a payload, not as a long path
    /// (US-01M6P2C1). The file is sparse, so only the size check before the read can refuse it: a
    /// reader that skipped the check would read it whole and succeed. A missing drop reports
    /// ERR_IO_FAILURE, never the size or a permission code.
    #[test]
    fn oversize_dropped_file_reports_payload_too_large() {
        use super::MAX_WORKSPACE_FILE_BYTES;
        let dir = std::env::temp_dir().join(format!("mbc-oversize-drop-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let big = dir.join("big.fasta");
        let file = std::fs::File::create(&big).unwrap();
        file.set_len(MAX_WORKSPACE_FILE_BYTES + 1).unwrap();
        drop(file);
        let err = read_dropped_now(&big, false).unwrap_err();
        assert!(err.starts_with("[ERR_PAYLOAD_TOO_LARGE] "), "{err}");
        assert!(err.contains("exceeds 64 MiB"), "{err}");

        let missing = read_dropped_now(&dir.join("gone.fasta"), false).unwrap_err();
        assert!(missing.starts_with("[ERR_IO_FAILURE] "), "{missing}");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// [`read_dropped_file`] of `path` as the file it names now, as a drop of it would record it.
    fn read_dropped_now(
        path: &std::path::Path,
        sniff_content: bool,
    ) -> Result<super::DroppedFileBytesPayload, String> {
        let identity = std::fs::metadata(path).ok().map(|meta| super::FileIdentity::of(&meta));
        super::read_dropped_file(path.to_path_buf(), path, identity, sniff_content)
    }

    /// A scratch folder of its own for one drop test.
    fn drop_scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("mbc-drop-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The window event a native drop of `paths` delivers, handed to main.rs's own handler for it.
    fn drop_onto_window(state: &crate::commands::AppBackendState, paths: &[&std::path::Path]) {
        crate::grant_native_drop(
            state,
            &tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop {
                paths: paths.iter().map(|p| p.to_path_buf()).collect(),
                position: tauri::PhysicalPosition::new(0.0, 0.0),
            }),
        );
    }

    /// What cmd_read_dropped_file_bytes answers when the WebView asks for `path`.
    fn webview_reads(
        state: &crate::commands::AppBackendState,
        path: &std::path::Path,
    ) -> Result<super::DroppedFileBytesPayload, String> {
        super::read_granted_drop(state, &path.to_string_lossy())
    }

    const GENBANK: &str = "LOCUS       pUC19 8 bp\nORIGIN\n        1 acgtacgt\n//\n";

    /// US-01M6P2X0 AC2: the drop reader reads only files dropped onto the window in this launch, and
    /// refuses any other path as ungranted before it looks at the path's type or the file. Wrong
    /// implementations, and the case that catches each: no grant check (the ungranted .gb reads); a
    /// check after the type gate (the ungranted extensionless key and .docx get the type refusal); a
    /// check after the metadata read (the missing path reports ERR_IO_FAILURE); a check after the
    /// protected-directory guard (/etc/hosts reports ERR_PERMISSION_DENIED); a drag that only
    /// entered the window granting (the .gb that entered and left reads); a grant covering the dropped
    /// file's folder (its sibling, and the folder itself, read); a path compared as dropped although
    /// it resolves (a dropped name later made a symlink to an undropped file reads that file).
    #[test]
    fn ungranted_path_is_refused() {
        let state = crate::commands::AppBackendState::default();
        let dir = drop_scratch("ungranted");
        let dropped = dir.join("dropped.gb");
        let sibling = dir.join("pUC19.gb");
        let notes = dir.join("notes.txt");
        let key = dir.join("id_rsa");
        let doc = dir.join("notes.docx");
        for f in [&dropped, &sibling] {
            std::fs::write(f, GENBANK).unwrap();
        }
        std::fs::write(&notes, "lab notes").unwrap();
        std::fs::write(&key, ">-----BEGIN OPENSSH PRIVATE KEY-----").unwrap();
        std::fs::write(&doc, "PK").unwrap();
        crate::grant_native_drop(
            &state,
            &tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Enter {
                paths: vec![sibling.clone()],
                position: tauri::PhysicalPosition::new(0.0, 0.0),
            }),
        );
        drop_onto_window(&state, &[&dropped]);
        assert!(webview_reads(&state, &dropped).is_ok(), "the dropped file reads");

        let missing = dir.join("never-there.gb");
        let hosts = std::path::PathBuf::from("/etc/hosts");
        for path in [&sibling, &notes, &missing, &key, &doc, &dir, &hosts] {
            let err = webview_reads(&state, path).unwrap_err();
            let named = format!("'{}'", path.display());
            assert!(
                err.starts_with("[ERR_SANDBOX_VIOLATION] ") && err.contains(&named),
                "{}: {err}",
                path.display()
            );
        }
        #[cfg(unix)]
        {
            // a dropped name later made a symlink to a file that was never dropped
            let swapped = dir.join("swapped.gb");
            std::fs::write(&swapped, GENBANK).unwrap();
            drop_onto_window(&state, &[&swapped]);
            std::fs::remove_file(&swapped).unwrap();
            std::os::unix::fs::symlink(&notes, &swapped).unwrap();
            let err = webview_reads(&state, &swapped).unwrap_err();
            assert!(err.starts_with("[ERR_SANDBOX_VIOLATION] "), "{err}");
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// US-01M6P2X0 AC3: a dropped file reads as it did before the drop grant: a .gb, an extensionless
    /// GenBank and FASTA record and a .dna (handed on for the importer's export hint) return their
    /// bytes under their own names. A dropped file asked for through a symlink to it, and one dropped
    /// through a symlinked folder and asked for by its real path, read too, so the grant is compared
    /// after resolving symlinks. Wrong implementations, and the case that catches each: a raw string
    /// comparison (both symlink cases); grants stored only as dropped (the symlinked-folder case); a
    /// reader that refuses every path (each file); a reader that answers with the symlink target's
    /// name (link.gb's name).
    #[test]
    fn granted_drop_reads_as_before() {
        let state = crate::commands::AppBackendState::default();
        let dir = drop_scratch("granted");
        let gb = dir.join("pUC19.gb");
        let genbank = dir.join("NC_000913");
        let fasta = dir.join("MN908947");
        let dna = dir.join("construct.dna");
        std::fs::write(&gb, GENBANK).unwrap();
        std::fs::write(&genbank, "LOCUS       NC_000913 8 bp\nORIGIN\n        1 acgtacgt\n//\n").unwrap();
        std::fs::write(&fasta, ">MN908947.3\nACGTACGT\n").unwrap();
        std::fs::write(&dna, b"\x09\x00\x00\x00\x0eSnapGene").unwrap();
        drop_onto_window(&state, &[&gb, &genbank, &fasta, &dna]);
        for path in [&gb, &genbank, &fasta, &dna] {
            let payload = webview_reads(&state, path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
            assert_eq!(payload.file_name, path.file_name().unwrap().to_string_lossy());
            assert_eq!(decode_base64_bytes(&payload.base64).unwrap(), std::fs::read(path).unwrap());
            assert_eq!(payload.byte_len, std::fs::metadata(path).unwrap().len() as usize);
        }

        #[cfg(unix)]
        {
            // asked for through a symlink to a dropped file
            let link = dir.join("link.gb");
            std::os::unix::fs::symlink(&gb, &link).unwrap();
            let payload = webview_reads(&state, &link).unwrap();
            assert_eq!(payload.file_name, "link.gb");
            assert_eq!(decode_base64_bytes(&payload.base64).unwrap(), GENBANK.as_bytes());

            // dropped through a symlinked folder, asked for by its real path
            let real_dir = dir.join("data");
            std::fs::create_dir_all(&real_dir).unwrap();
            let real = real_dir.join("pBR322.gb");
            std::fs::write(&real, GENBANK).unwrap();
            let alias_dir = dir.join("alias");
            std::os::unix::fs::symlink(&real_dir, &alias_dir).unwrap();
            drop_onto_window(&state, &[&alias_dir.join("pBR322.gb")]);
            let payload = webview_reads(&state, &std::fs::canonicalize(&real).unwrap()).unwrap();
            assert_eq!(decode_base64_bytes(&payload.base64).unwrap(), GENBANK.as_bytes());
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// US-01M6P2X0 AC4: a dropped file that is gone, one the OS will not let the app read, and one
    /// never dropped are three answers, each naming the path: ERR_IO_FAILURE saying it was not found,
    /// ERR_PERMISSION_DENIED, and ERR_SANDBOX_VIOLATION. Wrong implementations, and the case that
    /// catches each: a deleted grant read as ungranted (the gone file's code); an OS refusal reported
    /// as a sandbox violation or an I/O failure (the locked file's code); the bare OS message, which
    /// names no path (each `named` check).
    #[cfg(unix)]
    #[test]
    fn drop_tells_missing_unreadable_and_ungranted_apart() {
        use std::os::unix::fs::PermissionsExt;
        let state = crate::commands::AppBackendState::default();
        let dir = drop_scratch("apart");
        let gone = dir.join("gone.gb");
        let locked = dir.join("locked.gb");
        let never = dir.join("never.gb");
        for f in [&gone, &locked, &never] {
            std::fs::write(f, GENBANK).unwrap();
        }
        drop_onto_window(&state, &[&gone, &locked]);
        std::fs::remove_file(&gone).unwrap();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();
        let os_refuses = std::fs::read(&locked).is_err(); // root reads a mode-000 file

        let named = |p: &std::path::Path| format!("'{}'", p.display());
        let err = webview_reads(&state, &gone).unwrap_err();
        assert!(err.starts_with("[ERR_IO_FAILURE] ") && err.contains("was not found") && err.contains(&named(&gone)), "{err}");
        if os_refuses {
            let err = webview_reads(&state, &locked).unwrap_err();
            assert!(err.starts_with("[ERR_PERMISSION_DENIED] ") && err.contains(&named(&locked)), "{err}");
        }
        let err = webview_reads(&state, &never).unwrap_err();
        assert!(err.starts_with("[ERR_SANDBOX_VIOLATION] ") && err.contains(&named(&never)), "{err}");

        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o644)).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(os_refuses, "the OS let this user read a mode-000 file, so the ERR_PERMISSION_DENIED case was not reached");
    }

    /// The bytes of a file nobody dropped, so a test can tell whether any of them came back.
    const UNDROPPED: &str = "LOCUS       UNDROPPED 8 bp\nORIGIN\n        1 ttttgggg\n//\n";

    /// The refusal a granted path swapped for another file after the drop gets: ERR_SANDBOX_VIOLATION
    /// naming the path and saying it changed since it was dropped, carrying none of `secret`'s bytes.
    fn assert_changed_since_drop(err: &str, path: &std::path::Path, secret: &str) {
        assert!(
            err.starts_with("[ERR_SANDBOX_VIOLATION] ")
                && err.contains("changed since it was dropped")
                && err.contains(&format!("'{}'", path.display())),
            "{}: {err}",
            path.display()
        );
        assert!(
            !err.contains(secret) && !err.contains(&encode_base64_bytes(secret.as_bytes())),
            "{}: the swapped-in file's bytes came back: {err}",
            path.display()
        );
    }

    /// BG01M7P4Q3 AC1: a granted path replaced after the drop by a hard link to a file nobody dropped
    /// is refused as changed since it was dropped, and none of that file's bytes come back; the
    /// dropped file rewritten in place, still the same file, reads its new bytes. Wrong
    /// implementations, and the case that catches each: the resolved path checked but the file read
    /// unchecked (the hard link reads UNDROPPED); a refusal that calls the path never dropped (the
    /// message check); an identity that includes the content or its time of change, or a reader that
    /// refuses every dropped file (the rewritten file is refused).
    #[cfg(unix)]
    #[test]
    fn hard_link_swapped_after_drop_is_refused() {
        let state = crate::commands::AppBackendState::default();
        let dir = drop_scratch("hard-link");
        let dropped = dir.join("dropped.gb");
        let undropped = dir.join("undropped.gb");
        let rewritten = dir.join("rewritten.gb");
        std::fs::write(&dropped, GENBANK).unwrap();
        std::fs::write(&undropped, UNDROPPED).unwrap();
        std::fs::write(&rewritten, GENBANK).unwrap();
        drop_onto_window(&state, &[&dropped, &rewritten]);
        assert!(webview_reads(&state, &dropped).is_ok(), "the dropped file reads before the swap");

        std::fs::remove_file(&dropped).unwrap();
        std::fs::hard_link(&undropped, &dropped).unwrap();
        let err = webview_reads(&state, &dropped).unwrap_err();
        assert_changed_since_drop(&err, &dropped, UNDROPPED);

        std::fs::write(&rewritten, UNDROPPED).unwrap(); // the same file, given new bytes in place
        let payload = webview_reads(&state, &rewritten).unwrap_or_else(|e| panic!("rewritten in place: {e}"));
        assert_eq!(decode_base64_bytes(&payload.base64).unwrap(), UNDROPPED.as_bytes());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// BG01M7P4Q3 AC2: a granted file deleted and recreated at the same path with other content, and
    /// one replaced by a symlink to a file nobody dropped, are refused as changed since they were
    /// dropped, with none of the new file's bytes. Wrong implementations, and the case that catches
    /// each: the grant checked by path alone (the recreated file reads its new bytes); a dropped path
    /// that now resolves elsewhere reported as never dropped (the relinked file's message); an
    /// identity of the inode number alone where a file system reuses a freed one (the recreated file
    /// reads on such a file system, so the birth time is compared too).
    #[cfg(unix)]
    #[test]
    fn recreated_or_relinked_after_drop_is_refused() {
        let state = crate::commands::AppBackendState::default();
        let dir = drop_scratch("recreated");
        let recreated = dir.join("recreated.gb");
        let relinked = dir.join("relinked.gb");
        let undropped = dir.join("undropped.gb");
        for f in [&recreated, &relinked] {
            std::fs::write(f, GENBANK).unwrap();
        }
        std::fs::write(&undropped, UNDROPPED).unwrap();
        drop_onto_window(&state, &[&recreated, &relinked]);
        for f in [&recreated, &relinked] {
            assert!(webview_reads(&state, f).is_ok(), "{} reads before the swap", f.display());
        }

        std::fs::remove_file(&recreated).unwrap();
        std::fs::write(&recreated, UNDROPPED).unwrap();
        let err = webview_reads(&state, &recreated).unwrap_err();
        assert_changed_since_drop(&err, &recreated, UNDROPPED);

        std::fs::remove_file(&relinked).unwrap();
        std::os::unix::fs::symlink(&undropped, &relinked).unwrap();
        let err = webview_reads(&state, &relinked).unwrap_err();
        assert_changed_since_drop(&err, &relinked, UNDROPPED);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// US-01M6P2X0 AC5: Import Folder reads a symlink in the chosen folder only when its target lies
    /// inside that folder. Wrong implementations, and the case that catches each: symlinks followed
    /// as before (escape.gb and up.gb are listed); every symlink dropped (alias.gb and deep.gb are
    /// not listed); the target compared with the folder as chosen, not as resolved (the folder is
    /// also chosen through a symlink to it, `chosen`, so alias.gb is not listed); a prefix compared
    /// as text (folder-two/ shares folder's name as a prefix, so sibling.gb is listed).
    #[cfg(unix)]
    #[test]
    fn symlink_escaping_a_granted_folder_is_refused() {
        use super::{list_folder_import, read_folder_import};
        use std::os::unix::fs::symlink;
        let root = drop_scratch("folder-links");
        let folder = root.join("folder");
        let nested = folder.join("nested");
        let outside = root.join("outside");
        let neighbour = root.join("folder-two");
        for d in [&nested, &outside, &neighbour] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(folder.join("inside.gb"), GENBANK).unwrap();
        std::fs::write(nested.join("deep.gb"), GENBANK).unwrap();
        std::fs::write(outside.join("secret.gb"), GENBANK).unwrap();
        std::fs::write(neighbour.join("other.gb"), GENBANK).unwrap();
        symlink(folder.join("inside.gb"), folder.join("alias.gb")).unwrap();
        symlink(nested.join("deep.gb"), folder.join("deep.gb")).unwrap();
        symlink(outside.join("secret.gb"), folder.join("escape.gb")).unwrap();
        symlink("../outside/secret.gb", folder.join("up.gb")).unwrap();
        symlink(neighbour.join("other.gb"), folder.join("sibling.gb")).unwrap();

        let chosen = root.join("chosen");
        symlink(&folder, &chosen).unwrap();
        for picked in [&folder, &chosen] {
            let listing = list_folder_import(picked).unwrap();
            let names: Vec<String> =
                listing.files.iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect();
            assert_eq!(names, ["alias.gb", "deep.gb", "inside.gb"], "{}", picked.display());
            let reply = tauri::async_runtime::block_on(read_folder_import(picked.clone())).unwrap();
            let read: Vec<&str> = reply.files.iter().map(|f| f.file_name.as_str()).collect();
            assert_eq!(read, ["alias.gb", "deep.gb", "inside.gb"], "{}", picked.display());
        }
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn encodes_rfc4648_base64_for_binary_and_text_payloads() {
        assert_eq!(encode_base64_bytes(b""), "");
        assert_eq!(encode_base64_bytes(b"A"), "QQ==");
        assert_eq!(encode_base64_bytes(b"AB"), "QUI=");
        assert_eq!(encode_base64_bytes(b"ABC"), "QUJD");
        assert_eq!(encode_base64_bytes(b"ABIF"), "QUJJRg==");
    }
}
