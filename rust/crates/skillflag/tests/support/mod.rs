//! Shared helpers for the integration tests. No external dependencies.
//!
//! Compiled once per test binary; not every binary uses every helper.
#![allow(dead_code)]

use std::cell::RefCell;
use std::fs;
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use skillflag::install::{run_install_cli, InstallCliOptions, InstallInput};
use skillflag::stdio::{InputStream, ReaderInput};
use skillflag::{handle_skillflag, Options};

/// Self-cleaning unique temp directory under the system temp dir.
pub struct TempDir {
    path: PathBuf,
}

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

impl TempDir {
    pub fn new() -> Self {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!(
            "skillflag-rs-test-{}-{}-{nanos:09}",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed),
        ));
        fs::create_dir_all(&path).expect("create temp dir");
        Self { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

/// A `Write` implementation whose buffer can be inspected after the run.
#[derive(Clone, Default)]
pub struct SharedBuf(Arc<Mutex<Vec<u8>>>);

impl SharedBuf {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn bytes(&self) -> Vec<u8> {
        self.0.lock().unwrap().clone()
    }

    pub fn text(&self) -> String {
        String::from_utf8(self.bytes()).expect("utf-8 output")
    }
}

impl Write for SharedBuf {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

pub fn stdin_from(bytes: &[u8], tty: bool) -> RefCell<Box<dyn InputStream>> {
    RefCell::new(Box::new(ReaderInput::new(Cursor::new(bytes.to_vec()), tty)))
}

/// Path to the shared cross-language fixtures (`fixtures/skills`).
pub fn fixtures_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../fixtures/skills")
        .canonicalize()
        .expect("fixtures root")
}

pub struct RunResult {
    pub code: i32,
    pub stdout: Vec<u8>,
    pub stderr: String,
}

impl RunResult {
    pub fn stdout_text(&self) -> String {
        String::from_utf8(self.stdout.clone()).expect("utf-8 stdout")
    }
}

/// Run the producer with injected streams. `stdin` may be `None` for actions
/// that never read stdin.
pub fn run_producer(
    argv: &[&str],
    skills_roots: &[&Path],
    include_bundled: bool,
    cwd: Option<&Path>,
    stdin: Option<RefCell<Box<dyn InputStream>>>,
) -> RunResult {
    let stdout = SharedBuf::new();
    let stderr = SharedBuf::new();
    let opts = Options {
        skills_roots: skills_roots.iter().map(PathBuf::from).collect(),
        include_bundled_skill: include_bundled,
        cwd: cwd.map(PathBuf::from),
        stdin: stdin.or_else(|| Some(stdin_from(b"", false))),
        stdout: Some(RefCell::new(Box::new(stdout.clone()))),
        stderr: Some(RefCell::new(Box::new(stderr.clone()))),
    };
    let argv: Vec<String> = argv.iter().map(|s| s.to_string()).collect();
    let code = handle_skillflag(&argv, &opts);
    RunResult {
        code,
        stdout: stdout.bytes(),
        stderr: stderr.text(),
    }
}

/// Run the installer CLI with injected streams.
pub fn run_installer(
    args: &[&str],
    cwd: &Path,
    stdin: Option<RefCell<Box<dyn InputStream>>>,
    provided_inputs: Vec<InstallInput>,
    provided_skill_ids: Vec<String>,
    env_pairs: &[(&str, &str)],
) -> RunResult {
    let stdout = SharedBuf::new();
    let stderr = SharedBuf::new();
    let env_map: std::collections::HashMap<String, String> = env_pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    let opts = InstallCliOptions {
        stdin: stdin.or_else(|| Some(stdin_from(b"", false))),
        stdout: Some(RefCell::new(Box::new(stdout.clone()))),
        stderr: Some(RefCell::new(Box::new(stderr.clone()))),
        cwd: Some(cwd.to_path_buf()),
        provided_inputs,
        provided_skill_ids,
        env: Some(Box::new(move |key: &str| env_map.get(key).cloned())),
    };
    let args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let code = run_install_cli(&args, &opts);
    RunResult {
        code,
        stdout: stdout.bytes(),
        stderr: stderr.text(),
    }
}

/// Export a skill's tar bytes through the public producer interface.
pub fn export_tar(skills_root: &Path, id: &str) -> Vec<u8> {
    let result = run_producer(
        &["prog", "--skill", "export", id],
        &[skills_root],
        false,
        None,
        None,
    );
    assert_eq!(result.code, 0, "export failed: {}", result.stderr);
    result.stdout
}

/// Write a minimal skill directory with the given frontmatter name.
pub fn write_skill_dir(root: &Path, dir_name: &str, skill_name: &str) -> PathBuf {
    let dir = root.join(dir_name);
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("SKILL.md"),
        format!("---\nname: {skill_name}\ndescription: {skill_name} skill\n---\n\nBody.\n"),
    )
    .unwrap();
    dir
}

/// Compare two directory trees (paths and file contents).
pub fn assert_tree_equal(a: &Path, b: &Path) {
    let mut names_a: Vec<String> = list_tree(a);
    let mut names_b: Vec<String> = list_tree(b);
    names_a.sort();
    names_b.sort();
    assert_eq!(names_a, names_b, "tree mismatch between {a:?} and {b:?}");
    for name in &names_a {
        let pa = a.join(name);
        let pb = b.join(name);
        if pa.is_file() {
            assert_eq!(
                fs::read(&pa).unwrap(),
                fs::read(&pb).unwrap(),
                "content mismatch for {name}"
            );
        }
    }
}

fn list_tree(root: &Path) -> Vec<String> {
    fn walk(root: &Path, rel: &str, out: &mut Vec<String>) {
        for entry in fs::read_dir(root.join(rel)).unwrap() {
            let entry = entry.unwrap();
            let name = entry.file_name().into_string().unwrap();
            let rel_child = if rel.is_empty() {
                name
            } else {
                format!("{rel}/{name}")
            };
            out.push(rel_child.clone());
            if entry.file_type().unwrap().is_dir() {
                walk(root, &rel_child, out);
            }
        }
    }
    let mut out = Vec::new();
    walk(root, "", &mut out);
    out
}
