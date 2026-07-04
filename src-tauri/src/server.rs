use async_graphql::{EmptySubscription, Object, Schema, SimpleObject};
use async_graphql_axum::{GraphQLRequest, GraphQLResponse};
use axum::{
    body::Body,
    extract::Query as AxumQuery,
    http::{header, StatusCode, Uri},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{get, post},
    Extension, Router,
};
use futures::stream::Stream;
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use ignore::Match;
use notify::{event::CreateKind, Event as FsEvent, EventKind, RecursiveMode, Watcher};
use rust_embed::RustEmbed;
use serde::Deserialize;
use std::{
    collections::HashMap,
    convert::Infallible,
    net::{Ipv4Addr, SocketAddr},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};
use tokio::{net::TcpListener, sync::broadcast};
use tokio_stream::{wrappers::BroadcastStream, StreamExt};
use tower_http::{
    compression::CompressionLayer,
    cors::{Any, CorsLayer},
};

#[derive(SimpleObject)]
struct Commit {
    sha: String,
    short: String,
    message: String,
    author: String,
    when: String,
    refs: String,
    parents: Vec<String>,
}

#[derive(SimpleObject)]
struct FileEntry {
    path: String,
    status: String,
    additions: i32,
    deletions: i32,
    /// Row count the *unified* viewer will paint (hunk headers + body lines).
    /// Frontend uses this to lock min-height in unified mode so streaming
    /// hunks don't push later files down (CLS=0) without leaving gaps.
    visible_lines: i32,
    /// Row count the *split* viewer will paint. In split mode pierre/diffs
    /// pairs adjacent additions and deletions on the same row so each
    /// change group contributes `max(adds, dels)` rather than `adds + dels`.
    visible_lines_split: i32,
}

#[derive(SimpleObject)]
struct DirEntry {
    name: String,
    is_dir: bool,
    is_git_repo: bool,
    is_hidden: bool,
}

#[derive(SimpleObject)]
struct DirListing {
    path: String,
    parent: Option<String>,
    entries: Vec<DirEntry>,
}

#[derive(SimpleObject)]
struct GitRef {
    name: String,
    short_sha: String,
    is_current: bool,
}

#[derive(SimpleObject, serde::Serialize, serde::Deserialize, Default, Clone)]
#[serde(default)]
struct Preferences {
    theme: String,
}

fn config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("sa")
        .join("config.toml")
}

fn load_preferences() -> Preferences {
    let path = config_path();
    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => {
            return Preferences {
                theme: "light".into(),
            }
        }
    };
    let mut prefs: Preferences = toml::from_str(&raw).unwrap_or_default();
    if prefs.theme.is_empty() {
        prefs.theme = "light".into();
    }
    prefs
}

fn save_preferences(prefs: &Preferences) -> std::io::Result<()> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let body = toml::to_string_pretty(prefs).map_err(std::io::Error::other)?;
    std::fs::write(path, body)
}

pub struct Query;

#[Object]
impl Query {
    async fn health(&self) -> String {
        "ok".to_string()
    }

    async fn preferences(&self) -> Preferences {
        load_preferences()
    }

    async fn list_dir(&self, path: Option<String>) -> async_graphql::Result<DirListing> {
        let start = path
            .filter(|p| !p.is_empty())
            .map(PathBuf::from)
            .or_else(|| std::env::var("HOME").ok().map(PathBuf::from))
            .unwrap_or_else(|| PathBuf::from("/"));
        let start = start.canonicalize().map_err(|e| {
            async_graphql::Error::new(format!("canonicalize {}: {e}", start.display()))
        })?;
        if !start.is_dir() {
            return Err(async_graphql::Error::new(format!(
                "not a directory: {}",
                start.display()
            )));
        }
        let mut entries: Vec<DirEntry> = std::fs::read_dir(&start)
            .map_err(|e| async_graphql::Error::new(format!("read_dir {}: {e}", start.display())))?
            .filter_map(|res| res.ok())
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().into_owned();
                let ft = e.file_type().ok()?;
                let is_dir = ft.is_dir()
                    || (ft.is_symlink()
                        && std::fs::metadata(e.path())
                            .map(|m| m.is_dir())
                            .unwrap_or(false));
                let is_git_repo = is_dir && e.path().join(".git").exists();
                let is_hidden = name.starts_with('.');
                Some(DirEntry {
                    name,
                    is_dir,
                    is_git_repo,
                    is_hidden,
                })
            })
            .collect();
        entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });
        let parent = start.parent().map(|p| p.to_string_lossy().into_owned());
        Ok(DirListing {
            path: start.to_string_lossy().into_owned(),
            parent,
            entries,
        })
    }

    async fn files(
        &self,
        rev: Option<String>,
        repo: String,
        w: Option<bool>,
    ) -> async_graphql::Result<Vec<FileEntry>> {
        let rev = rev.unwrap_or_else(|| "HEAD".to_string());
        let (subcmd, extra) = diff_extras_for_rev(&rev, w.unwrap_or(false));

        let mut numstat_args: Vec<String> = vec![
            "-c".into(),
            "core.quotePath=false".into(),
            subcmd.into(),
            "--no-color".into(),
            "--numstat".into(),
        ];
        numstat_args.extend(extra.clone());
        let mut status_args: Vec<String> = vec![
            "-c".into(),
            "core.quotePath=false".into(),
            subcmd.into(),
            "--no-color".into(),
            "--name-status".into(),
        ];
        status_args.extend(extra.clone());
        let mut diff_args: Vec<String> = vec![
            "-c".into(),
            "core.quotePath=false".into(),
            subcmd.into(),
            "--no-color".into(),
        ];
        diff_args.extend(extra);

        let cwd = PathBuf::from(&repo);
        let (numstat, name_status, full_diff) = tokio::join!(
            tokio::process::Command::new("git")
                .current_dir(&cwd)
                .args(&numstat_args)
                .output(),
            tokio::process::Command::new("git")
                .current_dir(&cwd)
                .args(&status_args)
                .output(),
            tokio::process::Command::new("git")
                .current_dir(&cwd)
                .args(&diff_args)
                .output(),
        );
        let numstat =
            numstat.map_err(|e| async_graphql::Error::new(format!("git numstat: {e}")))?;
        let name_status =
            name_status.map_err(|e| async_graphql::Error::new(format!("git name-status: {e}")))?;
        let full_diff =
            full_diff.map_err(|e| async_graphql::Error::new(format!("git diff: {e}")))?;
        if !numstat.status.success() || !name_status.status.success() {
            return Err(async_graphql::Error::new(format!(
                "git {rev}: {}",
                String::from_utf8_lossy(&numstat.stderr)
            )));
        }
        let visible = count_visible_lines_per_file(&String::from_utf8_lossy(&full_diff.stdout));

        let mut entries: std::collections::BTreeMap<String, FileEntry> =
            std::collections::BTreeMap::new();
        for line in String::from_utf8_lossy(&numstat.stdout).lines() {
            let mut parts = line.splitn(3, '\t');
            let add = parts.next().unwrap_or("0").parse::<i32>().unwrap_or(0);
            let del = parts.next().unwrap_or("0").parse::<i32>().unwrap_or(0);
            let raw = match parts.next() {
                Some(p) => p,
                None => continue,
            };
            let path = normalize_renamed_path(raw);
            let (vis_u, vis_s) = visible
                .get(&path)
                .map(|v| (v.unified, v.split))
                .unwrap_or((0, 0));
            entries
                .entry(path.clone())
                .and_modify(|e| {
                    e.additions += add;
                    e.deletions += del;
                    if e.visible_lines == 0 {
                        e.visible_lines = vis_u;
                    }
                    if e.visible_lines_split == 0 {
                        e.visible_lines_split = vis_s;
                    }
                })
                .or_insert(FileEntry {
                    path,
                    status: "modified".into(),
                    additions: add,
                    deletions: del,
                    visible_lines: vis_u,
                    visible_lines_split: vis_s,
                });
        }
        for line in String::from_utf8_lossy(&name_status.stdout).lines() {
            let cols: Vec<&str> = line.split('\t').collect();
            if cols.len() < 2 {
                continue;
            }
            let code = cols[0];
            let path = cols.last().unwrap().to_string();
            let status = match code.chars().next().unwrap_or(' ') {
                'A' => "added",
                'D' => "deleted",
                'R' => "renamed",
                'C' => "copied",
                _ => "modified",
            };
            let (vis_u, vis_s) = visible
                .get(&path)
                .map(|v| (v.unified, v.split))
                .unwrap_or((0, 0));
            entries
                .entry(path.clone())
                .and_modify(|e| e.status = status.into())
                .or_insert(FileEntry {
                    path,
                    status: status.into(),
                    additions: 0,
                    deletions: 0,
                    visible_lines: vis_u,
                    visible_lines_split: vis_s,
                });
        }
        Ok(entries.into_values().collect())
    }

    async fn commits(
        &self,
        limit: Option<i32>,
        skip: Option<i32>,
        repo: String,
    ) -> async_graphql::Result<Vec<Commit>> {
        let limit = limit.unwrap_or(50).max(1);
        let skip = skip.unwrap_or(0).max(0);
        let output = tokio::process::Command::new("git")
            .current_dir(PathBuf::from(&repo))
            .args([
                "log",
                &format!("-n{limit}"),
                &format!("--skip={skip}"),
                "--decorate=short",
                "--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%ar%x1f%D%x1f%P",
            ])
            .output()
            .await
            .map_err(|e| async_graphql::Error::new(format!("git log failed: {e}")))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(async_graphql::Error::new(format!("git log: {stderr}")));
        }
        let s = String::from_utf8_lossy(&output.stdout);
        let commits = s
            .lines()
            .filter_map(|line| {
                let parts: Vec<&str> = line.split('\x1f').collect();
                if parts.len() < 7 {
                    return None;
                }
                let parents = parts[6]
                    .split_whitespace()
                    .map(String::from)
                    .collect::<Vec<_>>();
                Some(Commit {
                    sha: parts[0].to_string(),
                    short: parts[1].to_string(),
                    message: parts[2].to_string(),
                    author: parts[3].to_string(),
                    when: parts[4].to_string(),
                    refs: parts[5].to_string(),
                    parents,
                })
            })
            .collect();
        Ok(commits)
    }

    async fn branches(&self, repo: String) -> async_graphql::Result<Vec<GitRef>> {
        run_for_each_ref(&repo, &["refs/heads", "refs/remotes"]).await
    }

    async fn tags(&self, repo: String) -> async_graphql::Result<Vec<GitRef>> {
        run_for_each_ref(&repo, &["refs/tags"]).await
    }

    async fn tree(&self, repo: String, rev: Option<String>) -> async_graphql::Result<Vec<String>> {
        let rev = rev.unwrap_or_else(|| "HEAD".to_string());
        let output = tokio::process::Command::new("git")
            .current_dir(PathBuf::from(&repo))
            .args(["ls-tree", "-r", "--name-only", "-z", &rev])
            .output()
            .await
            .map_err(|e| async_graphql::Error::new(format!("git ls-tree: {e}")))?;
        if !output.status.success() {
            return Err(async_graphql::Error::new(format!(
                "git ls-tree {rev}: {}",
                String::from_utf8_lossy(&output.stderr)
            )));
        }
        Ok(output
            .stdout
            .split(|&b| b == 0)
            .filter(|s| !s.is_empty())
            .map(|s| String::from_utf8_lossy(s).into_owned())
            .collect())
    }
}

async fn run_for_each_ref(repo: &str, patterns: &[&str]) -> async_graphql::Result<Vec<GitRef>> {
    let mut args: Vec<&str> = vec![
        "for-each-ref",
        "--format=%(refname:short)%09%(objectname:short)%09%(HEAD)",
    ];
    args.extend(patterns);
    let output = tokio::process::Command::new("git")
        .current_dir(PathBuf::from(repo))
        .args(&args)
        .output()
        .await
        .map_err(|e| async_graphql::Error::new(format!("git for-each-ref: {e}")))?;
    if !output.status.success() {
        return Err(async_graphql::Error::new(format!(
            "git for-each-ref: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }
    let s = String::from_utf8_lossy(&output.stdout);
    let refs = s
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(3, '\t').collect();
            if parts.len() < 2 {
                return None;
            }
            let name = parts[0].to_string();
            if name == "origin/HEAD" || name.ends_with("/HEAD") {
                return None;
            }
            Some(GitRef {
                name,
                short_sha: parts[1].to_string(),
                is_current: parts.get(2).is_some_and(|s| *s == "*"),
            })
        })
        .collect();
    Ok(refs)
}

pub struct Mutation;

#[Object]
impl Mutation {
    async fn set_preferences(&self, theme: Option<String>) -> async_graphql::Result<Preferences> {
        let mut prefs = load_preferences();
        if let Some(t) = theme {
            if t != "light" && t != "dark" {
                return Err(async_graphql::Error::new(format!("invalid theme: {t}")));
            }
            prefs.theme = t;
        }
        save_preferences(&prefs)
            .map_err(|e| async_graphql::Error::new(format!("save preferences: {e}")))?;
        Ok(prefs)
    }
}

pub type AppSchema = Schema<Query, Mutation, EmptySubscription>;

pub fn build_schema() -> AppSchema {
    Schema::build(Query, Mutation, EmptySubscription).finish()
}

async fn graphql_handler(schema: Extension<AppSchema>, req: GraphQLRequest) -> GraphQLResponse {
    schema.execute(req.into_inner()).await.into()
}

#[derive(Deserialize)]
struct DiffParams {
    rev: Option<String>,
    path: Option<String>,
    repo: String,
    w: Option<String>,
}

#[derive(Deserialize)]
struct BlobParams {
    rev: String,
    path: String,
    repo: String,
}

fn is_working(s: &str) -> bool {
    s.eq_ignore_ascii_case("WORKING")
}

fn is_staging(s: &str) -> bool {
    s.eq_ignore_ascii_case("STAGING")
}

fn diff_extras_for_rev(rev: &str, ignore_ws: bool) -> (&'static str, Vec<String>) {
    let (subcmd, mut args) = base_diff_extras(rev);
    if ignore_ws {
        args.insert(0, "-w".to_string());
    }
    (subcmd, args)
}

fn base_diff_extras(rev: &str) -> (&'static str, Vec<String>) {
    if is_working(rev) {
        return ("diff", vec!["HEAD".into()]);
    }
    if is_staging(rev) {
        return ("diff", vec!["--cached".into(), "HEAD".into()]);
    }
    let parts = if let Some(idx) = rev.find("...") {
        Some((&rev[..idx], &rev[idx + 3..]))
    } else {
        rev.find("..").map(|idx| (&rev[..idx], &rev[idx + 2..]))
    };
    if let Some((base, head)) = parts {
        let base_special = is_working(base) || is_staging(base);
        let head_special = is_working(head) || is_staging(head);
        if base_special || head_special {
            if (is_staging(base) && is_working(head)) || (is_working(base) && is_staging(head)) {
                return ("diff", vec![]);
            }
            let commit = if base_special { head } else { base };
            let cached = is_staging(base) || is_staging(head);
            return if cached {
                ("diff", vec!["--cached".into(), commit.into()])
            } else {
                ("diff", vec![commit.into()])
            };
        }
        return ("diff", vec![rev.into()]);
    }
    (
        "show",
        vec![
            "--format=".into(),
            "-m".into(),
            "--first-parent".into(),
            rev.into(),
        ],
    )
}

#[derive(Clone, Copy)]
struct VisibleLines {
    unified: i32,
    split: i32,
}

/// Walk a unified-diff output and return, per file, the row count pierre/diffs
/// will paint in each mode. Mirrors pierre's `unifiedLineCount` /
/// `splitLineCount` (see `parsePatchFiles.ts`):
///
/// - unified: 1 per hunk header + every body line (additions, deletions,
///   context). `\ No newline at end of file` is metadata, not a row.
/// - split: 1 per hunk header + context lines + sum over each change group
///   of `max(adds, dels)` since pierre stacks paired add/del rows side by
///   side, while unmatched leftovers cascade onto their own rows.
///
/// Inter-hunk expand rows are pierre-internal and only appear when context
/// is collapsed, so we deliberately under-count by ≤1 row per gap to avoid
/// permanent whitespace; the tiny CLS during streaming is preferable.
fn count_visible_lines_per_file(diff: &str) -> std::collections::HashMap<String, VisibleLines> {
    let mut out: std::collections::HashMap<String, VisibleLines> = std::collections::HashMap::new();
    let mut current_path: Option<String> = None;
    let mut unified_body: i32 = 0;
    let mut split_body: i32 = 0;
    let mut hunks: i32 = 0;
    let mut in_hunk = false;
    let mut group_adds: i32 = 0;
    let mut group_dels: i32 = 0;

    let flush_group = |adds: &mut i32, dels: &mut i32, split_body: &mut i32| {
        if *adds > 0 || *dels > 0 {
            *split_body += std::cmp::max(*adds, *dels);
            *adds = 0;
            *dels = 0;
        }
    };

    let commit = |path: &Option<String>,
                  unified_body: i32,
                  split_body: i32,
                  hunks: i32,
                  map: &mut std::collections::HashMap<String, VisibleLines>| {
        if let Some(p) = path {
            if hunks > 0 {
                map.entry(p.clone())
                    .and_modify(|v| {
                        v.unified += unified_body + hunks;
                        v.split += split_body + hunks;
                    })
                    .or_insert(VisibleLines {
                        unified: unified_body + hunks,
                        split: split_body + hunks,
                    });
            }
        }
    };

    for line in diff.lines() {
        if let Some(rest) = line.strip_prefix("diff --git ") {
            flush_group(&mut group_adds, &mut group_dels, &mut split_body);
            commit(&current_path, unified_body, split_body, hunks, &mut out);
            current_path = parse_diff_git_new_path(rest);
            unified_body = 0;
            split_body = 0;
            hunks = 0;
            in_hunk = false;
        } else if line.starts_with("@@") {
            flush_group(&mut group_adds, &mut group_dels, &mut split_body);
            hunks += 1;
            in_hunk = true;
        } else if in_hunk {
            match line.as_bytes().first().copied() {
                Some(b'+') => {
                    unified_body += 1;
                    group_adds += 1;
                }
                Some(b'-') => {
                    unified_body += 1;
                    group_dels += 1;
                }
                Some(b' ') => {
                    unified_body += 1;
                    flush_group(&mut group_adds, &mut group_dels, &mut split_body);
                    split_body += 1;
                }
                _ => {}
            }
        }
    }
    flush_group(&mut group_adds, &mut group_dels, &mut split_body);
    commit(&current_path, unified_body, split_body, hunks, &mut out);
    out
}

/// Extract the new-side path from a `diff --git a/<old> b/<new>` line, using
/// the last occurrence of ` b/` so paths containing spaces still parse. Git
/// quotes paths with truly unprintable bytes; with `core.quotePath=false` that
/// only affects names with literal quotes/tabs/newlines, which we leave alone.
fn parse_diff_git_new_path(rest: &str) -> Option<String> {
    let trimmed = rest.trim_end();
    let idx = trimmed.rfind(" b/")?;
    let raw = &trimmed[idx + 3..];
    let stripped = raw
        .strip_prefix('"')
        .and_then(|s| s.strip_suffix('"'))
        .unwrap_or(raw);
    Some(stripped.to_string())
}

fn normalize_renamed_path(raw: &str) -> String {
    if let (Some(open), Some(close)) = (raw.find('{'), raw.rfind('}')) {
        if open < close {
            if let Some(arrow) = raw[open..close].find(" => ") {
                let prefix = &raw[..open];
                let new_inner = raw[open + arrow + 4..close].trim();
                let suffix = &raw[close + 1..];
                return format!("{prefix}{new_inner}{suffix}");
            }
        }
    }
    if let Some(arrow) = raw.find(" => ") {
        return raw[arrow + 4..].to_string();
    }
    raw.to_string()
}

pub enum BackendError {
    Internal(String),
    BadRequest(String),
    NotFound(String),
}

pub async fn diff_text(
    rev: &str,
    repo: &str,
    path: Option<&str>,
    ignore_ws: bool,
) -> Result<Vec<u8>, BackendError> {
    let (subcmd, extra) = diff_extras_for_rev(rev, ignore_ws);
    let mut args: Vec<String> = vec![
        "-c".into(),
        "core.quotePath=false".into(),
        subcmd.into(),
        "--no-color".into(),
    ];
    args.extend(extra);
    if let Some(p) = path {
        args.push("--".into());
        args.push(p.to_string());
    }
    let output = tokio::process::Command::new("git")
        .current_dir(PathBuf::from(repo))
        .args(&args)
        .output()
        .await
        .map_err(|e| BackendError::Internal(format!("git failed: {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(BackendError::BadRequest(format!("git {rev}: {stderr}")));
    }
    Ok(output.stdout)
}

pub fn spec_to_diff_args(rev: &str) -> (&'static str, Vec<String>) {
    base_diff_extras(rev)
}

pub async fn blob_text(rev: &str, repo: &str, path: &str) -> Result<Vec<u8>, BackendError> {
    let target = format!("{rev}:{path}");
    let output = tokio::process::Command::new("git")
        .current_dir(PathBuf::from(repo))
        .args(["show", &target])
        .output()
        .await
        .map_err(|e| BackendError::Internal(format!("git failed: {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Treat "added file at parent rev" and similar missing-path cases as an
        // empty blob so the diff library can render added/deleted files without
        // a console-spamming 404.
        if stderr.contains("does not exist in")
            || stderr.contains("exists on disk, but not in")
            || stderr.contains("path '")
        {
            return Ok(Vec::new());
        }
        return Err(BackendError::NotFound(format!(
            "git show {target}: {stderr}"
        )));
    }
    Ok(output.stdout)
}

pub fn watcher_for(repo: PathBuf) -> broadcast::Sender<String> {
    ensure_watcher(repo)
}

async fn diff_handler(AxumQuery(params): AxumQuery<DiffParams>) -> Response {
    let rev = params.rev.unwrap_or_else(|| "HEAD".to_string());
    let ignore_ws = matches!(params.w.as_deref(), Some("1") | Some("true"));
    match diff_text(&rev, &params.repo, params.path.as_deref(), ignore_ws).await {
        Ok(out) => ([(header::CONTENT_TYPE, "text/x-diff; charset=utf-8")], out).into_response(),
        Err(BackendError::Internal(msg)) => {
            (StatusCode::INTERNAL_SERVER_ERROR, msg).into_response()
        }
        Err(BackendError::BadRequest(msg)) => (StatusCode::BAD_REQUEST, msg).into_response(),
        Err(BackendError::NotFound(msg)) => (StatusCode::NOT_FOUND, msg).into_response(),
    }
}

async fn blob_handler(AxumQuery(params): AxumQuery<BlobParams>) -> Response {
    match blob_text(&params.rev, &params.repo, &params.path).await {
        Ok(out) => ([(header::CONTENT_TYPE, "text/plain; charset=utf-8")], out).into_response(),
        Err(BackendError::Internal(msg)) => {
            (StatusCode::INTERNAL_SERVER_ERROR, msg).into_response()
        }
        Err(BackendError::BadRequest(msg)) => (StatusCode::BAD_REQUEST, msg).into_response(),
        Err(BackendError::NotFound(msg)) => (StatusCode::NOT_FOUND, msg).into_response(),
    }
}

#[derive(Deserialize)]
struct EventsParams {
    repo: String,
}

fn watchers() -> &'static Mutex<HashMap<PathBuf, broadcast::Sender<String>>> {
    static WATCHERS: OnceLock<Mutex<HashMap<PathBuf, broadcast::Sender<String>>>> = OnceLock::new();
    WATCHERS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn ensure_watcher(repo: PathBuf) -> broadcast::Sender<String> {
    let mut map = watchers().lock().unwrap();
    if let Some(tx) = map.get(&repo) {
        return tx.clone();
    }
    let (tx, _) = broadcast::channel::<String>(32);
    spawn_watcher(tx.clone(), repo.clone());
    map.insert(repo, tx.clone());
    tx
}

async fn events_handler(
    AxumQuery(p): AxumQuery<EventsParams>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let tx = ensure_watcher(PathBuf::from(&p.repo));
    let rx = tx.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|msg| match msg {
        Ok(payload) => Some(Ok(Event::default().data(payload))),
        Err(_) => None,
    });
    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
}

#[derive(RustEmbed)]
#[folder = "$OUT_DIR/dist/"]
struct Assets;

fn asset_response(path: &str) -> Option<Response> {
    let asset = Assets::get(path)?;
    let body = Body::from(asset.data.into_owned());
    let mime = mime_guess::from_path(path)
        .first_or_octet_stream()
        .to_string();
    Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .body(body)
        .ok()
}

async fn static_handler(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    if path.starts_with("api/") {
        return StatusCode::NOT_FOUND.into_response();
    }
    let path = if path.is_empty() { "index.html" } else { path };
    asset_response(path)
        .or_else(|| asset_response("index.html"))
        .unwrap_or_else(|| StatusCode::NOT_FOUND.into_response())
}

fn build_router(schema: AppSchema) -> Router {
    Router::new()
        .route("/api/graphql", post(graphql_handler))
        .route("/api/diff", get(diff_handler))
        .route("/api/blob", get(blob_handler))
        .route("/api/events", get(events_handler))
        .fallback(static_handler)
        .layer(Extension(schema))
        .layer(CompressionLayer::new().gzip(true))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_headers(Any)
                .allow_methods(Any),
        )
}

struct RepoIgnore {
    repo: PathBuf,
    /// Sorted from shallowest to deepest, so deeper rules override shallower ones.
    rules: Vec<(PathBuf, Gitignore)>,
    global: Gitignore,
}

impl RepoIgnore {
    fn load(repo: &Path) -> Self {
        let mut rules: Vec<(PathBuf, Gitignore)> = Vec::new();

        let mut root_b = GitignoreBuilder::new(repo);
        let _ = root_b.add(repo.join(".gitignore"));
        let _ = root_b.add(repo.join(".git/info/exclude"));
        if let Ok(gi) = root_b.build() {
            rules.push((repo.to_owned(), gi));
        }

        for entry in ignore::WalkBuilder::new(repo)
            .standard_filters(true)
            .hidden(false)
            .build()
            .flatten()
        {
            if entry.file_name() != ".gitignore" {
                continue;
            }
            let path = entry.path();
            let dir = match path.parent() {
                Some(d) => d.to_owned(),
                None => continue,
            };
            if dir == *repo {
                continue;
            }
            let mut b = GitignoreBuilder::new(&dir);
            let _ = b.add(path);
            if let Ok(gi) = b.build() {
                rules.push((dir, gi));
            }
        }
        rules.sort_by_key(|(d, _)| d.components().count());

        let (global, _) = Gitignore::global();

        Self {
            repo: repo.to_owned(),
            rules,
            global,
        }
    }

    fn is_ignored(&self, path: &Path, is_dir: bool) -> bool {
        let mut last: Match<&ignore::gitignore::Glob> = Match::None;
        for (dir, gi) in &self.rules {
            if path.starts_with(dir) {
                let m = gi.matched_path_or_any_parents(path, is_dir);
                if !m.is_none() {
                    last = m;
                }
            }
        }
        if !last.is_none() {
            return last.is_ignore();
        }
        if let Ok(rel) = path.strip_prefix(&self.repo) {
            self.global
                .matched_path_or_any_parents(rel, is_dir)
                .is_ignore()
        } else {
            false
        }
    }
}

/// True when a changed path is a git-relevant file (not under `.git/`, not a
/// directory, not gitignored). Cheap enough for the event hot path as long as
/// the caller bounds how often it is invoked (see the flood guard below).
fn is_relevant_change(ig: &RepoIgnore, path: &Path) -> bool {
    let s = path.to_string_lossy();
    if s.contains("/.git/") || s.ends_with("/.git") {
        return false;
    }
    !path.is_dir() && !ig.is_ignored(path, false)
}

fn unignored_dirs(root: &Path) -> Vec<PathBuf> {
    ignore::WalkBuilder::new(root)
        .standard_filters(true)
        .hidden(false)
        .filter_entry(|e| e.file_name() != ".git")
        .build()
        .flatten()
        .filter(|e| e.file_type().is_some_and(|t| t.is_dir()))
        .map(|e| e.into_path())
        .collect()
}

/// How long we coalesce filesystem events before emitting a single "changed".
const WATCH_WINDOW: Duration = Duration::from_secs(2);

/// More than this many raw inotify events inside one window means a watched
/// directory is being rewritten in a hot loop (a build artifact, log file, or
/// temp file that slipped past gitignore). The kernel hands every event to the
/// notify reader thread, so reacting to each one pins a CPU core for no
/// user-visible benefit — instead we unwatch the offending directory once and
/// log it. This is the guard against the "sa pegs 240% CPU for hours" runaway.
const WATCH_FLOOD: u64 = 4000;

/// Past this many events in a window we stop doing per-event gitignore work and
/// let the flood guard handle it. Keeps the notify reader callback O(1) under a
/// storm so a single hot file can't burn a core on relevance checks.
const WATCH_RELEVANCE_BUDGET: u64 = 64;

fn spawn_watcher(tx: broadcast::Sender<String>, root: PathBuf) {
    // Shared, read-only ignore rules. `Gitignore` is Send + Sync so both the
    // notify reader thread and our emit loop can consult it.
    let ignore = Arc::new(RepoIgnore::load(&root));
    // Set by the reader thread when a relevant change is seen; drained once per
    // window by the emit loop. A flood of events collapses to a single store.
    let dirty = Arc::new(AtomicBool::new(false));
    // Raw event tally for the current window, used only by the flood guard.
    let event_count = Arc::new(AtomicU64::new(0));
    // A representative path sampled early in each window, so when the flood
    // guard trips we know which directory to unwatch.
    let sample = Arc::new(Mutex::new(Option::<PathBuf>::None));
    // Newly created directories to extend NonRecursive watches onto. Low volume
    // (only dir-create events), processed off the hot path in the emit loop.
    let (newdir_tx, newdir_rx) = std::sync::mpsc::channel::<PathBuf>();

    let cb_ignore = ignore.clone();
    let cb_dirty = dirty.clone();
    let cb_count = event_count.clone();
    let cb_sample = sample.clone();

    let mut watcher = match notify::recommended_watcher(move |res: notify::Result<FsEvent>| {
        let Ok(event) = res else { return };
        let n = cb_count.fetch_add(1, Ordering::Relaxed);

        if matches!(event.kind, EventKind::Create(CreateKind::Folder)) {
            for p in &event.paths {
                let _ = newdir_tx.send(p.clone());
            }
        }

        // Once we've decided to emit this window, or we've already spent the
        // relevance budget, every further event is a single atomic add above
        // plus this load — no syscalls, no allocation, no gitignore matching.
        if cb_dirty.load(Ordering::Relaxed) || n >= WATCH_RELEVANCE_BUDGET {
            return;
        }

        if n < 4 {
            if let (Some(p), Ok(mut s)) = (event.paths.first(), cb_sample.lock()) {
                *s = Some(p.clone());
            }
        }

        if event
            .paths
            .iter()
            .any(|p| is_relevant_change(&cb_ignore, p))
        {
            cb_dirty.store(true, Ordering::Relaxed);
        }
    }) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("failed to create watcher for {}: {e}", root.display());
            return;
        }
    };

    std::thread::spawn(move || {
        let dirs = unignored_dirs(&root);
        eprintln!("watching {} ({} dirs)", root.display(), dirs.len());
        for dir in &dirs {
            if let Err(e) = watcher.watch(dir, RecursiveMode::NonRecursive) {
                eprintln!("watch failed for {}: {e}", dir.display());
            }
        }

        loop {
            std::thread::sleep(WATCH_WINDOW);

            // Extend watches onto directories created since the last window.
            while let Ok(p) = newdir_rx.try_recv() {
                if p.is_dir() && !ignore.is_ignored(&p, true) {
                    for d in unignored_dirs(&p) {
                        let _ = watcher.watch(&d, RecursiveMode::NonRecursive);
                    }
                }
            }

            let count = event_count.swap(0, Ordering::Relaxed);
            if count >= WATCH_FLOOD {
                let culprit = sample.lock().ok().and_then(|mut s| s.take());
                let dir = culprit.and_then(|p| {
                    if p.is_dir() {
                        Some(p)
                    } else {
                        p.parent().map(Path::to_owned)
                    }
                });
                if let Some(dir) = dir {
                    let _ = watcher.unwatch(&dir);
                    eprintln!(
                        "watch flood: {count} events in {}s from {}; unwatched to protect CPU",
                        WATCH_WINDOW.as_secs(),
                        dir.display()
                    );
                }
            }

            if dirty.swap(false, Ordering::Relaxed) {
                let _ = tx.send("changed".to_string());
            }
        }
    });
}

pub async fn run() -> Result<(), Box<dyn std::error::Error>> {
    run_with_port_callback(|_| {}).await
}

pub async fn run_with_port_callback<F>(on_bound: F) -> Result<(), Box<dyn std::error::Error>>
where
    F: FnOnce(u16),
{
    let schema = build_schema();
    let app = build_router(schema);
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let listener = TcpListener::bind(addr).await?;
    let bound = listener.local_addr()?;
    on_bound(bound.port());
    if let Ok(portless_url) = std::env::var("PORTLESS_URL") {
        println!("graphql at  {portless_url}/api/graphql");
        println!("diff text   {portless_url}/api/diff?rev=HEAD");
        println!("blob text   {portless_url}/api/blob?rev=HEAD&path=README.md");
        println!("sse events  {portless_url}/api/events");
    } else {
        println!("graphql at  http://{bound}/api/graphql");
        println!("diff text   http://{bound}/api/diff?rev=HEAD");
        println!("blob text   http://{bound}/api/blob?rev=HEAD&path=README.md");
        println!("sse events  http://{bound}/api/events");
    }
    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn count(diff: &str, path: &str) -> VisibleLines {
        *count_visible_lines_per_file(diff)
            .get(path)
            .unwrap_or_else(|| panic!("path {path} not in diff"))
    }

    fn args(rev: &str) -> (&'static str, Vec<String>) {
        spec_to_diff_args(rev)
    }

    #[test]
    fn diff_spec_maps_single_rev_to_first_parent_show() {
        assert_eq!(
            args("HEAD"),
            (
                "show",
                vec![
                    "--format=".to_string(),
                    "-m".to_string(),
                    "--first-parent".to_string(),
                    "HEAD".to_string()
                ]
            )
        );
    }

    #[test]
    fn diff_spec_keeps_two_dot_range() {
        assert_eq!(
            args("main..feature"),
            ("diff", vec!["main..feature".to_string()])
        );
    }

    #[test]
    fn diff_spec_keeps_three_dot_range() {
        assert_eq!(
            args("HEAD~3...HEAD"),
            ("diff", vec!["HEAD~3...HEAD".to_string()])
        );
    }

    #[test]
    fn diff_spec_maps_working_and_staging() {
        assert_eq!(args("working"), ("diff", vec!["HEAD".to_string()]));
        assert_eq!(
            args("staging"),
            ("diff", vec!["--cached".to_string(), "HEAD".to_string()])
        );
    }

    #[test]
    fn diff_spec_maps_pseudo_ranges() {
        assert_eq!(args("HEAD..working"), ("diff", vec!["HEAD".to_string()]));
        assert_eq!(
            args("HEAD..staging"),
            ("diff", vec!["--cached".to_string(), "HEAD".to_string()])
        );
        assert_eq!(args("staging..working"), ("diff", vec![]));
    }

    #[test]
    fn paired_change_group_collapses_in_split_mode() {
        // One hunk, 1 deletion immediately followed by 1 addition. Pierre
        // pairs them onto a single visual row in split mode, so split count
        // must be smaller than unified — this is the invariant that the
        // "gap between files" regression keeps tripping over.
        let diff = "\
diff --git a/a b/a
@@ -1,2 +1,2 @@
-old
+new
 context
";
        let v = count(diff, "a");
        assert_eq!(v.unified, 4, "1 hunk + 3 body lines");
        assert_eq!(v.split, 3, "1 hunk + max(1,1) paired + 1 context");
    }

    #[test]
    fn unmatched_add_in_change_group_takes_its_own_row_in_split() {
        // 1 deletion, then 2 additions, with no interleaved context. Pierre
        // stacks the pair onto one row and the unmatched extra add cascades
        // onto its own row, so split body = max(2, 1) = 2.
        let diff = "\
diff --git a/b b/b
@@ -1,1 +1,2 @@
-old
+new1
+new2
";
        let v = count(diff, "b");
        assert_eq!(v.unified, 4, "1 hunk + 3 body lines");
        assert_eq!(v.split, 3, "1 hunk + max(2,1)");
    }

    #[test]
    fn pure_addition_split_equals_unified() {
        // No deletions, no pairing. Split and unified must match.
        let diff = "\
diff --git a/c b/c
@@ -0,0 +1,3 @@
+a
+b
+c
";
        let v = count(diff, "c");
        assert_eq!(v.unified, 4);
        assert_eq!(v.split, 4);
    }

    #[test]
    fn context_only_split_equals_unified() {
        let diff = "\
diff --git a/d b/d
@@ -1,3 +1,3 @@
 x
 y
 z
";
        let v = count(diff, "d");
        assert_eq!(v.unified, 4);
        assert_eq!(v.split, 4);
    }

    #[test]
    fn multiple_hunks_separate_change_groups() {
        // Two hunks, each with its own paired change. The group flush must
        // happen at each hunk boundary so split body sums per-group max.
        let diff = "\
diff --git a/e b/e
@@ -1,2 +1,2 @@
-a
+b
@@ -10,2 +10,2 @@
-c
+d
";
        let v = count(diff, "e");
        assert_eq!(v.unified, 6, "2 hunk headers + 4 body");
        assert_eq!(v.split, 4, "2 hunk headers + max(1,1) twice");
    }

    #[test]
    fn split_count_never_exceeds_unified() {
        // Invariant: split mode collapses pairs, so split <= unified for any
        // diff. This is the cheapest guard against overestimating the
        // split-mode reservation, which is what produces the gap.
        let diffs = [
            "\
diff --git a/f b/f
@@ -1,5 +1,5 @@
-a
-b
-c
+x
+y
+z
 ctx
",
            "\
diff --git a/g b/g
@@ -1,1 +1,4 @@
+a
+b
+c
+d
",
            "\
diff --git a/h b/h
@@ -1,4 +1,1 @@
-a
-b
-c
-d
",
        ];
        for diff in diffs {
            for (_, v) in count_visible_lines_per_file(diff) {
                assert!(
                    v.split <= v.unified,
                    "split ({}) > unified ({})",
                    v.split,
                    v.unified
                );
            }
        }
    }
}
