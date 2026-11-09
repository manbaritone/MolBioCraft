// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Runs locally installed phylogenetics programs (FastTree, PhyML, RAxML-NG / RAxML,
//! MrBayes) on an alignment and returns their tree with the caller's taxon names.
//!
//! Nothing is bundled: executables are looked up by fixed names on `PATH` plus the usual
//! Homebrew / conda / user `bin` folders (desktop apps on macOS do not inherit the login
//! shell's `PATH`). Arguments are fixed templates; user data only reaches the programs as
//! files in a private temporary folder, with taxa renamed `T1..Tn` so no name can be
//! misread as an option or break a PHYLIP/NEXUS parser.

use molbiocraft_align::sanitize_newick_label;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExternalTreeProgram {
    FastTree,
    PhyML,
    RAxML,
    MrBayes,
}

impl ExternalTreeProgram {
    pub const ALL: [ExternalTreeProgram; 4] = [Self::FastTree, Self::PhyML, Self::RAxML, Self::MrBayes];

    /// Maps the UI's tree-algorithm key (e.g. `"PhyML (ML + SH-aLRT)"`) to a program.
    pub fn from_algorithm(key: &str) -> Option<Self> {
        let k = key.to_ascii_lowercase();
        if k.starts_with("fasttree") {
            Some(Self::FastTree)
        } else if k.starts_with("phyml") {
            Some(Self::PhyML)
        } else if k.starts_with("raxml") {
            Some(Self::RAxML)
        } else if k.starts_with("mrbayes") {
            Some(Self::MrBayes)
        } else {
            None
        }
    }

    pub fn algorithm_key(self) -> &'static str {
        match self {
            Self::FastTree => "FastTree (Approx-ML)",
            Self::PhyML => "PhyML (ML + SH-aLRT)",
            Self::RAxML => "RAxML (GTR+G Rapid ML)",
            Self::MrBayes => "MrBayes (Bayesian MCMC)",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::FastTree => "FastTree",
            Self::PhyML => "PhyML",
            Self::RAxML => "RAxML",
            Self::MrBayes => "MrBayes",
        }
    }

    /// Executable names tried in order (first match wins).
    fn candidates(self) -> &'static [&'static str] {
        match self {
            Self::FastTree => &["FastTree", "fasttree", "FastTreeMP", "FastTreeDbl"],
            Self::PhyML => &["phyml", "PhyML"],
            Self::RAxML => &[
                "raxml-ng",
                "raxmlHPC-PTHREADS-AVX2",
                "raxmlHPC-PTHREADS-AVX",
                "raxmlHPC-PTHREADS-SSE3",
                "raxmlHPC-PTHREADS",
                "raxmlHPC-AVX2",
                "raxmlHPC-AVX",
                "raxmlHPC-SSE3",
                "raxmlHPC",
            ],
            Self::MrBayes => &["mb", "mrbayes"],
        }
    }

    fn install_hint(self) -> &'static str {
        match self {
            Self::FastTree => "conda install -c bioconda fasttree  (or: brew install fasttree)",
            Self::PhyML => "conda install -c bioconda phyml",
            Self::RAxML => "conda install -c bioconda raxml-ng  (or: brew install raxml-ng)",
            Self::MrBayes => "conda install -c bioconda mrbayes  (or: brew install mrbayes)",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalProgramStatus {
    /// Tree-algorithm key used by the UI.
    pub algorithm: String,
    pub name: String,
    pub available: bool,
    pub executable_path: Option<String>,
    pub install_hint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalTreeResult {
    pub algorithm: String,
    pub program: String,
    pub version: Option<String>,
    pub executable_path: String,
    /// The command as run (inside the private work folder).
    pub command_line: String,
    pub model: String,
    /// Newick with the caller's (sanitised) taxon names and integer % support labels.
    pub newick: String,
    pub support_kind: String,
    /// The program's own log-likelihood under `model`, when it reports one.
    pub program_log_likelihood: Option<f64>,
    pub total_branch_length: f64,
    pub runtime_ms: u64,
    pub warnings: Vec<String>,
}

// ───────────────────────────── discovery ─────────────────────────────

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Folders searched for executables: `MOLBIOCRAFT_TOOLS_PATH`, `PATH`, then common
/// package-manager locations (including every conda environment's `bin`).
pub fn tool_search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    for var in ["MOLBIOCRAFT_TOOLS_PATH", "PATH"] {
        if let Some(v) = std::env::var_os(var) {
            dirs.extend(std::env::split_paths(&v));
        }
    }
    if let Some(prefix) = std::env::var_os("CONDA_PREFIX") {
        dirs.push(PathBuf::from(prefix).join("bin"));
    }
    for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/opt/local/bin"] {
        dirs.push(PathBuf::from(d));
    }
    let mut conda_bases: Vec<PathBuf> = vec![
        PathBuf::from("/opt/homebrew/Caskroom/miniforge/base"),
        PathBuf::from("/opt/homebrew/Caskroom/miniconda/base"),
        PathBuf::from("/opt/conda"),
    ];
    if let Some(home) = home_dir() {
        dirs.push(home.join(".local/bin"));
        dirs.push(home.join("bin"));
        for b in ["miniforge3", "mambaforge", "miniconda3", "anaconda3", "micromamba", ".conda"] {
            conda_bases.push(home.join(b));
        }
    }
    for base in conda_bases {
        dirs.push(base.join("bin"));
        if let Ok(entries) = std::fs::read_dir(base.join("envs")) {
            let mut envs: Vec<PathBuf> = entries.flatten().map(|e| e.path().join("bin")).collect();
            envs.sort();
            dirs.extend(envs);
        }
    }
    let mut seen = std::collections::HashSet::new();
    dirs.retain(|d| !d.as_os_str().is_empty() && seen.insert(d.clone()));
    dirs
}

fn is_executable_file(p: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(p) else { return false };
    if !meta.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

pub fn locate_program(program: ExternalTreeProgram, dirs: &[PathBuf]) -> Option<PathBuf> {
    let suffixes: &[&str] = if cfg!(windows) { &[".exe", ""] } else { &[""] };
    for name in program.candidates() {
        for dir in dirs {
            for sfx in suffixes {
                let p = dir.join(format!("{name}{sfx}"));
                if is_executable_file(&p) {
                    return Some(p);
                }
            }
        }
    }
    None
}

pub fn detect_external_tree_programs() -> Vec<ExternalProgramStatus> {
    let dirs = tool_search_dirs();
    ExternalTreeProgram::ALL
        .iter()
        .map(|&p| {
            let path = locate_program(p, &dirs);
            ExternalProgramStatus {
                algorithm: p.algorithm_key().into(),
                name: p.display_name().into(),
                available: path.is_some(),
                executable_path: path.map(|x| x.display().to_string()),
                install_hint: p.install_hint().into(),
            }
        })
        .collect()
}

// ───────────────────────────── input files ─────────────────────────────

fn temp_id(i: usize) -> String {
    format!("T{}", i + 1)
}

fn clean_rows(aligned: &[String], protein: bool) -> Vec<String> {
    aligned
        .iter()
        .map(|s| {
            s.chars()
                .filter(|c| !c.is_whitespace())
                .map(|c| match c.to_ascii_uppercase() {
                    '.' | '~' => '-',
                    'U' if !protein => 'T',
                    '*' if protein => 'X',
                    o => o,
                })
                .collect()
        })
        .collect()
}

fn fasta(rows: &[String]) -> String {
    rows.iter().enumerate().map(|(i, s)| format!(">{}\n{}\n", temp_id(i), s)).collect()
}

fn phylip(rows: &[String]) -> String {
    let len = rows.first().map(|r| r.len()).unwrap_or(0);
    let mut out = format!("{} {}\n", rows.len(), len);
    for (i, s) in rows.iter().enumerate() {
        out.push_str(&format!("{}  {}\n", temp_id(i), s));
    }
    out
}

/// Short, interactive-length chain; enough for a usable consensus on small/medium data.
pub const MRBAYES_GENERATIONS: u32 = 100_000;

fn mrbayes_nexus(rows: &[String], protein: bool) -> String {
    let len = rows.first().map(|r| r.len()).unwrap_or(0);
    let mut out = format!(
        "#NEXUS\nbegin data;\n dimensions ntax={} nchar={};\n format datatype={} missing=? gap=-;\n matrix\n",
        rows.len(),
        len,
        if protein { "protein" } else { "dna" }
    );
    for (i, s) in rows.iter().enumerate() {
        out.push_str(&format!(" {} {}\n", temp_id(i), s));
    }
    out.push_str(" ;\nend;\nbegin mrbayes;\n set autoclose=yes nowarn=yes seed=12345 swapseed=12345;\n");
    if protein {
        out.push_str(" lset rates=gamma;\n prset aamodelpr=fixed(wag);\n");
    } else {
        out.push_str(" lset nst=6 rates=gamma;\n");
    }
    out.push_str(&format!(
        " mcmc ngen={MRBAYES_GENERATIONS} samplefreq=100 printfreq=5000 nruns=2 nchains=2 diagnfreq=5000;\n sumt relburnin=yes burninfrac=0.25 conformat=simple;\n quit;\nend;\n"
    ));
    out
}

// ───────────────────────────── newick post-processing ─────────────────────────────

/// Removes `[...]` comments (MrBayes notes, FigTree annotations).
fn strip_comments(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut depth = 0usize;
    for c in s.chars() {
        match c {
            '[' => depth += 1,
            ']' if depth > 0 => depth -= 1,
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out
}

/// Renames tips through `rename` and rescales numeric internal labels to integer percent
/// (0–1 supports are multiplied by 100). Non-numeric internal labels are dropped.
pub fn relabel_newick(newick: &str, rename: &dyn Fn(&str) -> Option<String>) -> Result<String, String> {
    let s = strip_comments(newick);
    let s = s.trim();
    let body = s.strip_suffix(';').unwrap_or(s).trim();
    if !body.starts_with('(') {
        return Err("the program did not write a Newick tree".into());
    }
    // Tokenise: structural chars, ':' + length, or a label.
    #[derive(Debug)]
    enum Tok {
        Sym(char),
        Len(String),
        Label(String),
    }
    let chars: Vec<char> = body.chars().collect();
    let mut toks = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            '(' | ')' | ',' => {
                toks.push(Tok::Sym(c));
                i += 1;
            }
            ':' => {
                let start = i + 1;
                i += 1;
                while i < chars.len() && !matches!(chars[i], '(' | ')' | ',' | ':') {
                    i += 1;
                }
                toks.push(Tok::Len(chars[start..i].iter().collect::<String>().trim().to_string()));
            }
            c if c.is_whitespace() => i += 1,
            '\'' | '"' => {
                let q = c;
                let start = i + 1;
                i += 1;
                while i < chars.len() && chars[i] != q {
                    i += 1;
                }
                toks.push(Tok::Label(chars[start..i.min(chars.len())].iter().collect()));
                i += 1;
            }
            _ => {
                let start = i;
                while i < chars.len() && !matches!(chars[i], '(' | ')' | ',' | ':') {
                    i += 1;
                }
                toks.push(Tok::Label(chars[start..i].iter().collect::<String>().trim().to_string()));
            }
        }
    }
    // Internal labels: a label directly after ')'.
    let mut supports: Vec<f64> = Vec::new();
    for w in toks.windows(2) {
        if let (Tok::Sym(')'), Tok::Label(l)) = (&w[0], &w[1]) {
            if let Ok(v) = l.parse::<f64>() {
                supports.push(v);
            }
        }
    }
    let scale = if !supports.is_empty() && supports.iter().all(|v| (0.0..=1.0).contains(v)) { 100.0 } else { 1.0 };
    let mut out = String::with_capacity(body.len());
    let mut prev_close = false;
    for t in &toks {
        match t {
            Tok::Sym(c) => {
                out.push(*c);
                prev_close = *c == ')';
            }
            Tok::Len(l) => {
                let v: f64 = l.parse().map_err(|_| format!("unreadable branch length '{l}'"))?;
                out.push_str(&format!(":{}", fmt_len(v.max(0.0))));
                prev_close = false;
            }
            Tok::Label(l) => {
                if prev_close {
                    if let Ok(v) = l.parse::<f64>() {
                        out.push_str(&format!("{}", (v * scale).round().clamp(0.0, 100.0) as i64));
                    }
                } else {
                    let name = rename(l).ok_or_else(|| format!("the tree has an unknown tip '{l}'"))?;
                    out.push_str(&name);
                }
                prev_close = false;
            }
        }
    }
    out.push(';');
    Ok(out)
}

fn fmt_len(v: f64) -> String {
    let s = format!("{v:.8}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s.is_empty() { "0".into() } else { s.to_string() }
}

fn total_branch_length(newick: &str) -> f64 {
    let mut total = 0.0;
    let mut rest = newick;
    while let Some(p) = rest.find(':') {
        rest = &rest[p + 1..];
        let end = rest.find(|c: char| matches!(c, ',' | ')' | ';')).unwrap_or(rest.len());
        total += rest[..end].parse::<f64>().unwrap_or(0.0);
    }
    (total * 1e4).round() / 1e4
}

/// Parses a MrBayes `.con.tre`: translate table + the first `tree ... = (...)`.
fn mrbayes_consensus(text: &str) -> Result<(String, std::collections::HashMap<String, String>), String> {
    let clean = strip_comments(text);
    let lower = clean.to_ascii_lowercase();
    let mut map = std::collections::HashMap::new();
    if let Some(t) = lower.find("translate") {
        let start = t + "translate".len();
        let end = clean[start..].find(';').map(|e| start + e).ok_or("unterminated translate block")?;
        for entry in clean[start..end].split(',') {
            let mut it = entry.split_whitespace();
            if let (Some(k), Some(v)) = (it.next(), it.next()) {
                map.insert(k.to_string(), v.trim_matches('\'').to_string());
            }
        }
    }
    let tpos = lower.find("tree con").or_else(|| lower.find("\ttree ")).or_else(|| lower.find(" tree "))
        .ok_or("no consensus tree in MrBayes output")?;
    let eq = clean[tpos..].find('=').map(|e| tpos + e + 1).ok_or("malformed MrBayes tree")?;
    let semi = clean[eq..].find(';').map(|e| eq + e + 1).ok_or("malformed MrBayes tree")?;
    Ok((clean[eq..semi].trim().to_string(), map))
}

fn last_number_after(text: &str, key: &str) -> Option<f64> {
    text.lines().rev().find_map(|line| {
        let pos = line.find(key)?;
        line[pos + key.len()..]
            .split(|c: char| !(c.is_ascii_digit() || matches!(c, '-' | '+' | '.' | 'e' | 'E')))
            .find(|t| t.parse::<f64>().is_ok())
            .and_then(|t| t.parse().ok())
    })
}

fn version_line(text: &str, keys: &[&str]) -> Option<String> {
    text.lines().find_map(|l| {
        let t = l.trim().trim_start_matches(|c: char| !c.is_alphanumeric());
        keys.iter().any(|k| t.starts_with(k)).then(|| t.chars().take(80).collect::<String>().trim().trim_end_matches('-').trim().to_string())
    })
}

// ───────────────────────────── running ─────────────────────────────

struct WorkDir(PathBuf);
impl Drop for WorkDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn make_work_dir() -> Result<WorkDir, String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("molbiocraft-tree-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create a work folder: {e}"))?;
    Ok(WorkDir(dir))
}

/// Runs `exe args` in `dir`, waiting at most `timeout` and polling `cancelled`.
/// Returns (exit success, stdout, stderr).
fn run_process(
    exe: &Path,
    args: &[String],
    dir: &Path,
    timeout: Duration,
    cancelled: &dyn Fn() -> bool,
) -> Result<(bool, String, String), String> {
    let out_path = dir.join("_stdout.txt");
    let err_path = dir.join("_stderr.txt");
    let stdout = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
    let stderr = std::fs::File::create(&err_path).map_err(|e| e.to_string())?;
    let mut cmd = Command::new(exe);
    cmd.args(args)
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(stdout)
        .stderr(stderr)
        .env("OMP_NUM_THREADS", "2");
    // GUI apps may lack the env's library path; put the program's own folder on PATH.
    if let Some(parent) = exe.parent() {
        let mut paths = vec![parent.to_path_buf()];
        if let Some(p) = std::env::var_os("PATH") {
            paths.extend(std::env::split_paths(&p));
        }
        if let Ok(joined) = std::env::join_paths(paths) {
            cmd.env("PATH", joined);
        }
    }
    let mut child = cmd.spawn().map_err(|e| format!("could not start {}: {e}", exe.display()))?;
    let started = Instant::now();
    let status = loop {
        if let Some(st) = child.try_wait().map_err(|e| e.to_string())? {
            break st;
        }
        if cancelled() {
            let _ = child.kill();
            let _ = child.wait();
            return Err("cancelled".into());
        }
        if started.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("stopped after {} s without finishing", timeout.as_secs()));
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    let read = |p: &Path| std::fs::read_to_string(p).unwrap_or_default();
    Ok((status.success(), read(&out_path), read(&err_path)))
}

fn tail(text: &str, n: usize) -> String {
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(n)..].join(" | ")
}

fn is_protein_alignment(rows: &[String]) -> bool {
    let (mut nuc, mut total) = (0usize, 0usize);
    for r in rows {
        for b in r.bytes() {
            if b == b'-' || b == b'?' {
                continue;
            }
            total += 1;
            if matches!(b, b'A' | b'C' | b'G' | b'T' | b'U' | b'N') {
                nuc += 1;
            }
        }
    }
    total > 0 && (nuc as f64) / (total as f64) < 0.9
}

pub fn run_external_tree_program(
    program: ExternalTreeProgram,
    names: &[String],
    aligned_seqs: &[String],
    timeout: Duration,
    cancelled: &dyn Fn() -> bool,
) -> Result<ExternalTreeResult, String> {
    let n = names.len();
    if n != aligned_seqs.len() {
        return Err("names and sequences differ in number".into());
    }
    if n < 4 {
        return Err(format!("{} needs at least 4 aligned sequences.", program.display_name()));
    }
    let protein = is_protein_alignment(&clean_rows(aligned_seqs, true));
    let rows = clean_rows(aligned_seqs, protein);
    let width = rows[0].len();
    if width == 0 || rows.iter().any(|r| r.len() != width) {
        return Err("the sequences must be aligned (equal lengths) first.".into());
    }
    let exe = locate_program(program, &tool_search_dirs()).ok_or_else(|| {
        format!("{} is not installed. Install it with: {}", program.display_name(), program.install_hint())
    })?;
    let exe_name = exe.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let work = make_work_dir()?;
    let dir = work.0.clone();
    let write = |name: &str, body: &str| std::fs::write(dir.join(name), body).map_err(|e| format!("cannot write {name}: {e}"));

    let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<String>>();
    let mut warnings = Vec::new();
    let (args, model, support_kind): (Vec<String>, String, String) = match program {
        ExternalTreeProgram::FastTree => {
            write("aln.fasta", &fasta(&rows))?;
            let mut a = if protein { s(&["-lg", "-gamma"]) } else { s(&["-nt", "-gtr", "-gamma"]) };
            a.extend(s(&["-nopr", "aln.fasta"]));
            (a, if protein { "LG+Γ20" } else { "GTR+Γ20" }.into(), "SH-like local support".into())
        }
        ExternalTreeProgram::PhyML => {
            write("aln.phy", &phylip(&rows))?;
            let a = s(&[
                "-i", "aln.phy", "-d", if protein { "aa" } else { "nt" }, "-m", if protein { "LG" } else { "GTR" },
                "-a", "e", "-c", "4", "-b", "-4", "-o", "tlr", "--no_memory_check", "--quiet",
            ]);
            (a, if protein { "LG+Γ4" } else { "GTR+Γ4" }.into(), "SH-like aLRT".into())
        }
        ExternalTreeProgram::RAxML if exe_name.starts_with("raxml-ng") => {
            write("aln.fasta", &fasta(&rows))?;
            let a = s(&[
                "--search", "--msa", "aln.fasta", "--data-type", if protein { "AA" } else { "DNA" },
                "--model", if protein { "LG+G" } else { "GTR+G" }, "--prefix", "run", "--seed", "12345",
                "--threads", "2", "--redo",
            ]);
            (a, if protein { "LG+Γ4" } else { "GTR+Γ4" }.into(), "none".into())
        }
        ExternalTreeProgram::RAxML => {
            write("aln.phy", &phylip(&rows))?;
            let mut a = s(&["-s", "aln.phy", "-n", "run", "-m", if protein { "PROTGAMMALG" } else { "GTRGAMMA" }, "-p", "12345"]);
            a.push("-w".into());
            a.push(dir.display().to_string());
            if exe_name.contains("PTHREADS") {
                a.extend(s(&["-T", "2"]));
            }
            (a, if protein { "LG+Γ4" } else { "GTR+Γ4" }.into(), "none".into())
        }
        ExternalTreeProgram::MrBayes => {
            write("aln.nex", &mrbayes_nexus(&rows, protein))?;
            (
                s(&["aln.nex"]),
                if protein { "WAG+Γ4".into() } else { "GTR+Γ4".into() },
                "posterior probability".into(),
            )
        }
    };

    let started = Instant::now();
    let (ok, stdout, stderr) = run_process(&exe, &args, &dir, timeout, cancelled)
        .map_err(|e| format!("{}: {e}", program.display_name()))?;
    let runtime_ms = started.elapsed().as_millis() as u64;
    let both = format!("{stdout}\n{stderr}");
    let fail = |what: &str| {
        format!("{} {what}. Last output: {}", program.display_name(), tail(&both, 4))
    };
    let read = |name: &str| std::fs::read_to_string(dir.join(name)).ok();

    let (raw_tree, translate, program_ll, version) = match program {
        ExternalTreeProgram::FastTree => {
            if !ok || stdout.trim().is_empty() {
                return Err(fail("failed"));
            }
            (stdout.trim().to_string(), None, last_number_after(&stderr, "Gamma(20) LogLk ="), version_line(&stderr, &["FastTree"]))
        }
        ExternalTreeProgram::PhyML => {
            let find = |prefix: &str| {
                std::fs::read_dir(&dir).ok()?.flatten().map(|e| e.file_name().to_string_lossy().to_string())
                    .find(|f| f.starts_with(prefix))
            };
            let tree = find("aln.phy_phyml_tree").and_then(|f| read(&f)).ok_or_else(|| fail("wrote no tree"))?;
            let stats = find("aln.phy_phyml_stats").and_then(|f| read(&f)).unwrap_or_default();
            (tree, None, last_number_after(&stats, "Log-likelihood:"), version_line(&format!("{stats}\n{both}"), &["PhyML", "This is PhyML"]))
        }
        ExternalTreeProgram::RAxML if exe_name.starts_with("raxml-ng") => {
            let tree = read("run.raxml.bestTree").ok_or_else(|| fail("wrote no tree"))?;
            (tree, None, last_number_after(&stdout, "Final LogLikelihood:"), version_line(&stdout, &["RAxML-NG"]))
        }
        ExternalTreeProgram::RAxML => {
            let tree = read("RAxML_bestTree.run").ok_or_else(|| fail("wrote no tree"))?;
            let info = read("RAxML_info.run").unwrap_or_default();
            (tree, None, last_number_after(&info, "Final GAMMA-based Score of best tree"), version_line(&format!("{info}\n{stdout}"), &["RAxML version", "This is RAxML version"]))
        }
        ExternalTreeProgram::MrBayes => {
            let con = read("aln.nex.con.tre").ok_or_else(|| fail("wrote no consensus tree"))?;
            let (tree, map) = mrbayes_consensus(&con)?;
            if let Some(sd) = last_number_after(&stdout, "Average standard deviation of split frequencies:") {
                if sd > 0.05 {
                    warnings.push(format!(
                        "MrBayes runs have not converged (average SD of split frequencies {sd:.3} > 0.05 after {MRBAYES_GENERATIONS} generations); treat posterior probabilities with caution."
                    ));
                }
            }
            (tree, Some(map), None, version_line(&stdout, &["MrBayes"]))
        }
    };

    let label_for = |tmp: &str| -> Option<String> {
        let id = match &translate {
            Some(map) => map.get(tmp).map(String::as_str).unwrap_or(tmp),
            None => tmp,
        };
        let idx: usize = id.strip_prefix('T')?.parse().ok()?;
        names.get(idx.checked_sub(1)?).map(|n| sanitize_newick_label(n))
    };
    let newick = relabel_newick(&raw_tree, &label_for).map_err(|e| fail(&format!("returned an unreadable tree ({e})")))?;

    let shown_args: Vec<String> = args
        .iter()
        .map(|a| if a == &dir.display().to_string() { "<work dir>".into() } else { a.clone() })
        .collect();
    Ok(ExternalTreeResult {
        algorithm: program.algorithm_key().into(),
        program: program.display_name().into(),
        version,
        executable_path: exe.display().to_string(),
        command_line: format!("{} {}", exe_name, shown_args.join(" ")),
        model,
        total_branch_length: total_branch_length(&newick),
        newick,
        support_kind,
        program_log_likelihood: program_ll,
        runtime_ms,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmap<'a>(names: &'a [&'a str]) -> impl Fn(&str) -> Option<String> + 'a {
        move |t: &str| {
            let i: usize = t.strip_prefix('T')?.parse().ok()?;
            names.get(i - 1).map(|n| sanitize_newick_label(n))
        }
    }

    #[test]
    fn relabels_fasttree_output_and_scales_supports() {
        let names = ["Cow A", "Pig", "Whale", "Dolphin", "Bat", "Rat"];
        let raw = "((T1:0.024397747,T2:0.031342547)0.972:0.023683087,(T3:0.013827816,T4:0.013548618)0.997:0.034921321,(T6:0.072544452,T5:0.086753083)0.478:0.000000005);\n";
        let out = relabel_newick(raw, &tmap(&names)).unwrap();
        assert_eq!(
            out,
            "((Cow_A:0.02439775,Pig:0.03134255)97:0.02368309,(Whale:0.01382782,Dolphin:0.01354862)100:0.03492132,(Rat:0.07254445,Bat:0.08675308)48:0.00000001);"
        );
        assert!((total_branch_length(&out) - 0.3009).abs() < 1e-3);
    }

    #[test]
    fn rejects_unknown_tips_and_non_trees() {
        let names = ["A", "B", "C", "D"];
        assert!(relabel_newick("(T1:1,T9:1,T2:1);", &tmap(&names)).is_err());
        assert!(relabel_newick("ERROR: bad", &tmap(&names)).is_err());
    }

    #[test]
    fn parses_mrbayes_consensus_with_translate_table() {
        let con = "#NEXUS\nbegin trees;\n\ttranslate\n\t\t1\tT1,\n\t\t2\tT2,\n\t\t3\tT3,\n\t\t4\tT4\n\t\t;\n   [Note: This tree contains information on the topology, \n branch lengths (if present), and the probability]\n   tree con_50_majrule = (1:2.28e-02,2:3.07e-02,(3:1.3e-02,4:1.4e-02)1.000:3.1e-02);\n\n   tree con_50_majrule = (1:2.28e-02,2:3.07e-02,(3:1.3e-02,4:1.4e-02):3.1e-02);\nend;\n";
        let (tree, map) = mrbayes_consensus(con).unwrap();
        let names = ["a", "b", "c", "d"];
        let f = |t: &str| tmap(&names)(map.get(t).map(String::as_str).unwrap_or(t));
        assert_eq!(relabel_newick(&tree, &f).unwrap(), "(a:0.0228,b:0.0307,(c:0.013,d:0.014)100:0.031);");
    }

    #[test]
    fn reads_program_log_likelihoods() {
        assert_eq!(last_number_after("Gamma(20) LogLk = -857.108 alpha = 9.986", "Gamma(20) LogLk ="), Some(-857.108));
        assert_eq!(last_number_after(". Log-likelihood: \t\t\t-856.85429\n", "Log-likelihood:"), Some(-856.85429));
        assert_eq!(last_number_after("Final LogLikelihood: -856.642827", "Final LogLikelihood:"), Some(-856.642827));
    }

    #[test]
    fn maps_algorithm_keys() {
        for p in ExternalTreeProgram::ALL {
            assert_eq!(ExternalTreeProgram::from_algorithm(p.algorithm_key()), Some(p));
        }
        assert_eq!(ExternalTreeProgram::from_algorithm("UPGMA"), None);
    }

    /// Runs every installed program on a small alignment; programs that are not
    /// installed are skipped, so this is a no-op on machines without them.
    #[test]
    fn runs_installed_programs_end_to_end() {
        let names: Vec<String> = ["Alpha one", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"].iter().map(|s| s.to_string()).collect();
        let base = "ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAGGGCGAGGGCGATGCCACCTACGGCAAGCTGACCCTGAAGTTCATCTGCACCACCGGCAAGCTGCCCGTGCCCTGGCCCACCCTCGTGACCACCCTGACCTACGGCGTGCAGTGCTTCAGCCGCTACCCCGACCACATGAAGCAG";
        let mutate = |pos: &[usize]| {
            let mut b: Vec<u8> = base.bytes().collect();
            for &p in pos {
                b[p] = match b[p] { b'A' => b'G', b'G' => b'A', b'C' => b'T', _ => b'C' };
            }
            String::from_utf8(b).unwrap()
        };
        let seqs = vec![
            mutate(&[3, 50, 90]),
            mutate(&[3, 50, 91, 120]),
            mutate(&[10, 60, 150, 200]),
            mutate(&[10, 60, 151, 201, 220]),
            mutate(&[30, 100, 170]),
            mutate(&[30, 100, 171, 230, 5]),
        ];
        let dirs = tool_search_dirs();
        for p in ExternalTreeProgram::ALL {
            if locate_program(p, &dirs).is_none() {
                continue;
            }
            let r = run_external_tree_program(p, &names, &seqs, Duration::from_secs(300), &|| false)
                .unwrap_or_else(|e| panic!("{}: {e}", p.display_name()));
            for n in &names {
                assert!(r.newick.contains(&sanitize_newick_label(n)), "{}: {}", p.display_name(), r.newick);
            }
            assert!(r.total_branch_length > 0.0);
        }
    }
}
