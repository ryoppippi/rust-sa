use async_graphql::{EmptySubscription, InputObject, Object, Schema, SimpleObject};
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
    process::Stdio,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    net::TcpListener,
    sync::broadcast,
};
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

#[derive(Clone)]
struct PatchEntry {
    path: String,
    status: String,
    additions: i32,
    deletions: i32,
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

#[derive(SimpleObject, serde::Serialize, serde::Deserialize, Clone)]
struct ReviewComment {
    id: String,
    path: String,
    side: String,
    start_line_number: i32,
    end_line_number: i32,
    author: String,
    body: String,
    created_at: String,
}

#[derive(InputObject)]
struct ReviewCommentInput {
    path: String,
    side: String,
    start_line_number: i32,
    end_line_number: i32,
    author: String,
    body: String,
}

#[derive(SimpleObject, serde::Serialize, serde::Deserialize, Clone)]
struct RecentEntry {
    repo: String,
    spec: Option<String>,
    visited_at: String,
}

#[derive(SimpleObject, Clone)]
struct RepoCandidate {
    path: String,
    source: String,
}

#[derive(SimpleObject)]
struct RepoValidation {
    ok: bool,
    path: Option<String>,
    message: Option<String>,
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

fn comments_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("sa")
        .join("comments")
}

fn recents_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("sa")
        .join("recents.json")
}

fn load_recents() -> std::io::Result<Vec<RecentEntry>> {
    match std::fs::read_to_string(recents_path()) {
        Ok(raw) => serde_json::from_str(&raw).map_err(std::io::Error::other),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e),
    }
}

fn save_recents(recents: &[RecentEntry]) -> std::io::Result<()> {
    let path = recents_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let body = serde_json::to_string_pretty(recents).map_err(std::io::Error::other)?;
    std::fs::write(path, body)
}

async fn comment_path(repo: &str, rev: &str, ignore_ws: bool) -> async_graphql::Result<PathBuf> {
    let repo_path = std::fs::canonicalize(repo).unwrap_or_else(|_| PathBuf::from(repo));
    let repo_key = hash_hex(repo_path.to_string_lossy().as_bytes());
    let diff_key = hash_diff(&repo_path, rev, ignore_ws)
        .await
        .map_err(|e| async_graphql::Error::new(backend_error_text(e)))?;
    Ok(comments_dir()
        .join(repo_key)
        .join(format!("{diff_key}.json")))
}

fn load_comments(path: &Path) -> std::io::Result<Vec<ReviewComment>> {
    match std::fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw).map_err(std::io::Error::other),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e),
    }
}

fn save_comments(path: &Path, comments: &[ReviewComment]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let body = serde_json::to_string_pretty(comments).map_err(std::io::Error::other)?;
    std::fs::write(path, body)
}

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn new_comment_id(input: &ReviewCommentInput) -> String {
    let body = format!(
        "{}\0{}\0{}\0{}\0{}\0{}",
        input.path,
        input.side,
        input.start_line_number,
        input.end_line_number,
        input.author,
        now_millis()
    );
    format!("c{:x}", hash64(body.as_bytes()))
}

fn hash_hex(bytes: &[u8]) -> String {
    format!("{:016x}", hash64(bytes))
}

fn hash64(bytes: &[u8]) -> u64 {
    let mut hasher = FnvHasher::new();
    hasher.update(bytes);
    hasher.finish()
}

struct FnvHasher {
    hash: u64,
}

impl FnvHasher {
    fn new() -> Self {
        Self {
            hash: 0xcbf29ce484222325,
        }
    }

    fn update(&mut self, bytes: &[u8]) {
        for b in bytes {
            self.hash ^= u64::from(*b);
            self.hash = self.hash.wrapping_mul(0x100000001b3);
        }
    }

    fn finish(self) -> u64 {
        self.hash
    }

    fn finish_hex(self) -> String {
        format!("{:016x}", self.finish())
    }
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

    async fn validate_repo(&self, repo: String) -> RepoValidation {
        match resolve_repo(&repo).await {
            Ok(path) => RepoValidation {
                ok: true,
                path: Some(path),
                message: None,
            },
            Err(message) => RepoValidation {
                ok: false,
                path: None,
                message: Some(message),
            },
        }
    }

    async fn recents(&self) -> async_graphql::Result<Vec<RecentEntry>> {
        load_recents().map_err(|e| async_graphql::Error::new(format!("load recents: {e}")))
    }

    async fn repo_candidates(
        &self,
        limit: Option<i32>,
    ) -> async_graphql::Result<Vec<RepoCandidate>> {
        let limit = limit.unwrap_or(2000).clamp(1, 2000) as usize;
        Ok(cached_repo_candidates(limit))
    }

    async fn files(
        &self,
        rev: Option<String>,
        repo: Option<String>,
        w: Option<bool>,
        patch: Option<String>,
    ) -> async_graphql::Result<Vec<FileEntry>> {
        let rev = rev.unwrap_or_else(|| "HEAD".to_string());
        if let Some(id) = patch {
            return files_from_patch(&id).map_err(async_graphql::Error::new);
        }
        let repo = repo.ok_or_else(|| async_graphql::Error::new("repo is required"))?;
        let plan = diff_plan_for_rev(&rev, w.unwrap_or(false));
        let subcmd = plan.subcmd;
        let extra = plan.args;

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
        let (numstat, name_status, visible) = tokio::join!(
            tokio::process::Command::new("git")
                .current_dir(&cwd)
                .args(&numstat_args)
                .output(),
            tokio::process::Command::new("git")
                .current_dir(&cwd)
                .args(&status_args)
                .output(),
            count_visible_lines_from_git(&cwd, &diff_args),
        );
        let numstat =
            numstat.map_err(|e| async_graphql::Error::new(format!("git numstat: {e}")))?;
        let name_status =
            name_status.map_err(|e| async_graphql::Error::new(format!("git name-status: {e}")))?;
        let mut visible = visible.map_err(|e| async_graphql::Error::new(backend_error_text(e)))?;
        if !numstat.status.success() || !name_status.status.success() {
            return Err(async_graphql::Error::new(format!(
                "git {rev}: {}{}",
                String::from_utf8_lossy(&numstat.stderr),
                String::from_utf8_lossy(&name_status.stderr),
            )));
        }
        let untracked = if plan.include_untracked {
            untracked_files(&cwd, None)
                .await
                .map_err(|e| async_graphql::Error::new(backend_error_text(e)))?
        } else {
            Vec::new()
        };
        for file in &untracked {
            let patch_visible = count_visible_lines_per_file(&String::from_utf8_lossy(&file.diff));
            merge_visible_lines(&mut visible, patch_visible);
        }

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
        for file in untracked {
            let (vis_u, vis_s) = visible
                .get(&file.path)
                .map(|v| (v.unified, v.split))
                .unwrap_or((0, 0));
            entries.insert(
                file.path.clone(),
                FileEntry {
                    path: file.path,
                    status: "untracked".into(),
                    additions: file.additions,
                    deletions: 0,
                    visible_lines: vis_u,
                    visible_lines_split: vis_s,
                },
            );
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

    async fn comments(
        &self,
        repo: String,
        rev: String,
        w: Option<bool>,
    ) -> async_graphql::Result<Vec<ReviewComment>> {
        load_comments(&comment_path(&repo, &rev, w.unwrap_or(false)).await?)
            .map_err(|e| async_graphql::Error::new(format!("load comments: {e}")))
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

    async fn add_comment(
        &self,
        repo: String,
        rev: String,
        w: Option<bool>,
        input: ReviewCommentInput,
    ) -> async_graphql::Result<Vec<ReviewComment>> {
        if input.side != "additions" && input.side != "deletions" {
            return Err(async_graphql::Error::new(format!(
                "invalid side: {}",
                input.side
            )));
        }
        let path = comment_path(&repo, &rev, w.unwrap_or(false)).await?;
        let mut comments = load_comments(&path)
            .map_err(|e| async_graphql::Error::new(format!("load comments: {e}")))?;
        comments.push(ReviewComment {
            id: new_comment_id(&input),
            path: input.path,
            side: input.side,
            start_line_number: input.start_line_number,
            end_line_number: input.end_line_number,
            author: input.author,
            body: input.body,
            created_at: now_millis().to_string(),
        });
        save_comments(&path, &comments)
            .map_err(|e| async_graphql::Error::new(format!("save comments: {e}")))?;
        Ok(comments)
    }

    async fn delete_comment(
        &self,
        repo: String,
        rev: String,
        w: Option<bool>,
        id: String,
    ) -> async_graphql::Result<Vec<ReviewComment>> {
        let path = comment_path(&repo, &rev, w.unwrap_or(false)).await?;
        let comments = load_comments(&path)
            .map_err(|e| async_graphql::Error::new(format!("load comments: {e}")))?;
        let next = comments
            .into_iter()
            .filter(|comment| comment.id != id)
            .collect::<Vec<_>>();
        save_comments(&path, &next)
            .map_err(|e| async_graphql::Error::new(format!("save comments: {e}")))?;
        Ok(next)
    }

    async fn clear_comments(
        &self,
        repo: String,
        rev: String,
        w: Option<bool>,
    ) -> async_graphql::Result<Vec<ReviewComment>> {
        let path = comment_path(&repo, &rev, w.unwrap_or(false)).await?;
        save_comments(&path, &[])
            .map_err(|e| async_graphql::Error::new(format!("save comments: {e}")))?;
        Ok(Vec::new())
    }

    async fn record_recent(
        &self,
        repo: String,
        spec: Option<String>,
    ) -> async_graphql::Result<Vec<RecentEntry>> {
        let repo = resolve_repo(&repo)
            .await
            .map_err(async_graphql::Error::new)?;
        let mut recents =
            load_recents().map_err(|e| async_graphql::Error::new(format!("load recents: {e}")))?;
        let previous = recents
            .iter()
            .find(|entry| entry.repo == repo)
            .and_then(|entry| entry.spec.clone());
        recents.retain(|entry| entry.repo != repo);
        recents.insert(
            0,
            RecentEntry {
                repo,
                spec: spec.filter(|s| !s.trim().is_empty()).or(previous),
                visited_at: now_millis().to_string(),
            },
        );
        recents.truncate(12);
        save_recents(&recents)
            .map_err(|e| async_graphql::Error::new(format!("save recents: {e}")))?;
        Ok(recents)
    }

    async fn remove_recent(&self, repo: String) -> async_graphql::Result<Vec<RecentEntry>> {
        let mut recents =
            load_recents().map_err(|e| async_graphql::Error::new(format!("load recents: {e}")))?;
        recents.retain(|entry| entry.repo != repo);
        save_recents(&recents)
            .map_err(|e| async_graphql::Error::new(format!("save recents: {e}")))?;
        Ok(recents)
    }
}

pub type AppSchema = Schema<Query, Mutation, EmptySubscription>;

pub fn build_schema() -> AppSchema {
    Schema::build(Query, Mutation, EmptySubscription).finish()
}

async fn resolve_repo(repo: &str) -> Result<String, String> {
    let path = PathBuf::from(repo);
    if !path.exists() {
        return Err(format!("path does not exist: {}", path.display()));
    }
    if !path.is_dir() {
        return Err(format!("not a directory: {}", path.display()));
    }
    let output = tokio::process::Command::new("git")
        .current_dir(&path)
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .await
        .map_err(|e| format!("git rev-parse: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "not a git repository: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn cached_repo_candidates(limit: usize) -> Vec<RepoCandidate> {
    static CANDIDATES: OnceLock<Mutex<Option<Vec<RepoCandidate>>>> = OnceLock::new();
    let cache = CANDIDATES.get_or_init(|| Mutex::new(None));
    let mut guard = cache.lock().unwrap();
    if let Some(candidates) = &*guard {
        return candidates.iter().take(limit).cloned().collect();
    }
    let candidates = discover_repo_candidates(2000);
    let out = candidates.iter().take(limit).cloned().collect();
    *guard = Some(candidates);
    out
}

fn discover_repo_candidates(limit: usize) -> Vec<RepoCandidate> {
    let root = repo_scan_root();
    let mut out = Vec::new();
    scan_repo_candidates(&root, 0, 5, limit, &mut out);
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out.truncate(limit);
    out
}

fn repo_scan_root() -> PathBuf {
    if let Ok(output) = std::process::Command::new("ghq").arg("root").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return PathBuf::from(path);
            }
        }
    }
    std::env::var("HOME")
        .map(|home| PathBuf::from(home).join("ghq"))
        .unwrap_or_else(|_| PathBuf::from("ghq"))
}

fn scan_repo_candidates(
    dir: &Path,
    depth: usize,
    max_depth: usize,
    limit: usize,
    out: &mut Vec<RepoCandidate>,
) {
    if out.len() >= limit || depth > max_depth {
        return;
    }
    if dir.join(".git").exists() {
        out.push(RepoCandidate {
            path: dir.to_string_lossy().into_owned(),
            source: "discovered".into(),
        });
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut dirs = entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path();
            if entry.file_type().ok()?.is_dir() {
                Some(path)
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    dirs.sort();
    for child in dirs {
        scan_repo_candidates(&child, depth + 1, max_depth, limit, out);
        if out.len() >= limit {
            return;
        }
    }
}

async fn graphql_handler(schema: Extension<AppSchema>, req: GraphQLRequest) -> GraphQLResponse {
    schema.execute(req.into_inner()).await.into()
}

#[derive(Deserialize)]
struct DiffParams {
    rev: Option<String>,
    path: Option<String>,
    repo: Option<String>,
    patch: Option<String>,
    w: Option<String>,
}

#[derive(Deserialize)]
struct BlobParams {
    rev: String,
    path: String,
    repo: Option<String>,
    patch: Option<String>,
}

fn is_working(s: &str) -> bool {
    s.eq_ignore_ascii_case("WORKING")
}

fn is_staging(s: &str) -> bool {
    s.eq_ignore_ascii_case("STAGING")
}

struct DiffPlan {
    subcmd: &'static str,
    args: Vec<String>,
    include_untracked: bool,
}

fn diff_plan_for_rev(rev: &str, ignore_ws: bool) -> DiffPlan {
    let mut plan = base_diff_plan(rev);
    if ignore_ws {
        plan.args.insert(0, "-w".to_string());
    }
    plan
}

fn base_diff_extras(rev: &str) -> (&'static str, Vec<String>) {
    let plan = base_diff_plan(rev);
    (plan.subcmd, plan.args)
}

fn base_diff_plan(rev: &str) -> DiffPlan {
    if is_working(rev) {
        return DiffPlan {
            subcmd: "diff",
            args: vec!["HEAD".into()],
            include_untracked: true,
        };
    }
    if is_staging(rev) {
        return DiffPlan {
            subcmd: "diff",
            args: vec!["--cached".into(), "HEAD".into()],
            include_untracked: false,
        };
    }
    let parts = if let Some(idx) = rev.find("...") {
        Some((&rev[..idx], &rev[idx + 3..]))
    } else {
        rev.find("..").map(|idx| (&rev[..idx], &rev[idx + 2..]))
    };
    if let Some((base, head)) = parts {
        let base_working = is_working(base);
        let head_working = is_working(head);
        let base_staging = is_staging(base);
        let head_staging = is_staging(head);
        let base_special = base_working || base_staging;
        let head_special = head_working || head_staging;
        if base_special || head_special {
            if (base_staging && head_working) || (base_working && head_staging) {
                return DiffPlan {
                    subcmd: "diff",
                    args: vec![],
                    include_untracked: true,
                };
            }
            let commit = if base_special { head } else { base };
            let cached = base_staging || head_staging;
            return if cached {
                DiffPlan {
                    subcmd: "diff",
                    args: vec!["--cached".into(), commit.into()],
                    include_untracked: false,
                }
            } else {
                DiffPlan {
                    subcmd: "diff",
                    args: vec![commit.into()],
                    include_untracked: base_working || head_working,
                }
            };
        }
        return DiffPlan {
            subcmd: "diff",
            args: vec![rev.into()],
            include_untracked: false,
        };
    }
    DiffPlan {
        subcmd: "show",
        args: vec![
            "--format=".into(),
            "-m".into(),
            "--first-parent".into(),
            rev.into(),
        ],
        include_untracked: false,
    }
}

#[derive(Clone, Copy)]
struct VisibleLines {
    unified: i32,
    split: i32,
}

struct VisibleLineCounter {
    out: std::collections::HashMap<String, VisibleLines>,
    current_path: Option<String>,
    unified_body: i32,
    split_body: i32,
    hunks: i32,
    in_hunk: bool,
    group_adds: i32,
    group_dels: i32,
}

impl VisibleLineCounter {
    fn new() -> Self {
        Self {
            out: std::collections::HashMap::new(),
            current_path: None,
            unified_body: 0,
            split_body: 0,
            hunks: 0,
            in_hunk: false,
            group_adds: 0,
            group_dels: 0,
        }
    }

    fn ingest(&mut self, line: &str) {
        if let Some(rest) = line.strip_prefix("diff --git ") {
            self.flush_group();
            self.commit();
            self.current_path = parse_diff_git_new_path(rest);
            self.unified_body = 0;
            self.split_body = 0;
            self.hunks = 0;
            self.in_hunk = false;
        } else if line.starts_with("@@") {
            self.flush_group();
            self.hunks += 1;
            self.in_hunk = true;
        } else if self.in_hunk {
            match line.as_bytes().first().copied() {
                Some(b'+') => {
                    self.unified_body += 1;
                    self.group_adds += 1;
                }
                Some(b'-') => {
                    self.unified_body += 1;
                    self.group_dels += 1;
                }
                Some(b' ') => {
                    self.unified_body += 1;
                    self.flush_group();
                    self.split_body += 1;
                }
                _ => {}
            }
        }
    }

    fn finish(mut self) -> std::collections::HashMap<String, VisibleLines> {
        self.flush_group();
        self.commit();
        self.out
    }

    fn flush_group(&mut self) {
        if self.group_adds > 0 || self.group_dels > 0 {
            self.split_body += std::cmp::max(self.group_adds, self.group_dels);
            self.group_adds = 0;
            self.group_dels = 0;
        }
    }

    fn commit(&mut self) {
        if let Some(p) = &self.current_path {
            if self.hunks > 0 {
                self.out
                    .entry(p.clone())
                    .and_modify(|v| {
                        v.unified += self.unified_body + self.hunks;
                        v.split += self.split_body + self.hunks;
                    })
                    .or_insert(VisibleLines {
                        unified: self.unified_body + self.hunks,
                        split: self.split_body + self.hunks,
                    });
            }
        }
    }
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
    let mut counter = VisibleLineCounter::new();
    for line in diff.lines() {
        counter.ingest(line);
    }
    counter.finish()
}

async fn count_visible_lines_from_git(
    repo: &Path,
    args: &[String],
) -> Result<std::collections::HashMap<String, VisibleLines>, BackendError> {
    let mut child = tokio::process::Command::new("git")
        .current_dir(repo)
        .args(args)
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| BackendError::Internal(format!("git diff failed: {e}")))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| BackendError::Internal("git diff stdout unavailable".into()))?;
    let mut lines = BufReader::new(stdout).lines();
    let mut counter = VisibleLineCounter::new();
    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|e| BackendError::Internal(format!("read git diff: {e}")))?
    {
        counter.ingest(&line);
    }
    let status = child
        .wait()
        .await
        .map_err(|e| BackendError::Internal(format!("wait git diff: {e}")))?;
    if !status.success() {
        return Err(BackendError::BadRequest(format!(
            "git diff exited with {status}"
        )));
    }
    Ok(counter.finish())
}

async fn hash_diff(repo: &Path, rev: &str, ignore_ws: bool) -> Result<String, BackendError> {
    let plan = diff_plan_for_rev(rev, ignore_ws);
    let mut args: Vec<String> = vec![
        "-c".into(),
        "core.quotePath=false".into(),
        plan.subcmd.into(),
        "--no-color".into(),
    ];
    args.extend(plan.args);
    let mut child = tokio::process::Command::new("git")
        .current_dir(repo)
        .args(&args)
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| BackendError::Internal(format!("git diff failed: {e}")))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| BackendError::Internal("git diff stdout unavailable".into()))?;
    let mut hasher = FnvHasher::new();
    let mut buf = [0u8; 8192];
    loop {
        let read = stdout
            .read(&mut buf)
            .await
            .map_err(|e| BackendError::Internal(format!("read git diff: {e}")))?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    let status = child
        .wait()
        .await
        .map_err(|e| BackendError::Internal(format!("wait git diff: {e}")))?;
    if !status.success() {
        return Err(BackendError::BadRequest(format!(
            "git diff exited with {status}"
        )));
    }
    if plan.include_untracked {
        for file in untracked_files(repo, None).await? {
            hasher.update(&file.diff);
        }
    }
    Ok(hasher.finish_hex())
}

fn merge_visible_lines(
    base: &mut std::collections::HashMap<String, VisibleLines>,
    extra: std::collections::HashMap<String, VisibleLines>,
) {
    for (path, lines) in extra {
        base.entry(path)
            .and_modify(|v| {
                v.unified += lines.unified;
                v.split += lines.split;
            })
            .or_insert(lines);
    }
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

fn backend_error_text(err: BackendError) -> String {
    match err {
        BackendError::Internal(msg) => msg,
        BackendError::BadRequest(msg) => msg,
        BackendError::NotFound(msg) => msg,
    }
}

struct UntrackedFile {
    path: String,
    additions: i32,
    diff: Vec<u8>,
}

async fn untracked_files(
    repo: &Path,
    path: Option<&str>,
) -> Result<Vec<UntrackedFile>, BackendError> {
    let mut args = vec!["ls-files", "--others", "--exclude-standard", "-z"];
    if let Some(p) = path {
        args.push("--");
        args.push(p);
    }
    let output = tokio::process::Command::new("git")
        .current_dir(repo)
        .args(&args)
        .output()
        .await
        .map_err(|e| BackendError::Internal(format!("git ls-files failed: {e}")))?;
    if !output.status.success() {
        return Err(BackendError::BadRequest(format!(
            "git ls-files: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }
    let mut files = Vec::new();
    for raw in output.stdout.split(|b| *b == 0).filter(|p| !p.is_empty()) {
        let path = String::from_utf8_lossy(raw).into_owned();
        let full_path = repo.join(&path);
        let bytes = tokio::fs::read(&full_path)
            .await
            .map_err(|e| BackendError::Internal(format!("read {}: {e}", full_path.display())))?;
        let mode = file_mode(&full_path).await?;
        let additions = if bytes.is_empty() || bytes.contains(&0) {
            0
        } else {
            String::from_utf8_lossy(&bytes).lines().count() as i32
        };
        files.push(UntrackedFile {
            path: path.clone(),
            additions,
            diff: render_untracked_diff(&path, &bytes, mode),
        });
    }
    Ok(files)
}

async fn file_mode(path: &Path) -> Result<&'static str, BackendError> {
    let meta = tokio::fs::metadata(path)
        .await
        .map_err(|e| BackendError::Internal(format!("metadata {}: {e}", path.display())))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if meta.permissions().mode() & 0o111 != 0 {
            return Ok("100755");
        }
    }
    Ok("100644")
}

fn render_untracked_diff(path: &str, bytes: &[u8], mode: &str) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(format!("diff --git a/{path} b/{path}\n").as_bytes());
    out.extend_from_slice(format!("new file mode {mode}\n").as_bytes());
    out.extend_from_slice(b"index 0000000..0000000\n");
    if bytes.is_empty() {
        return out;
    }
    if bytes.contains(&0) {
        out.extend_from_slice(format!("Binary files /dev/null and b/{path} differ\n").as_bytes());
        return out;
    }
    let additions = String::from_utf8_lossy(bytes).lines().count();
    out.extend_from_slice(b"--- /dev/null\n");
    out.extend_from_slice(format!("+++ b/{path}\n").as_bytes());
    out.extend_from_slice(format!("@@ -0,0 +1,{additions} @@\n").as_bytes());
    for line in String::from_utf8_lossy(bytes).split_inclusive('\n') {
        out.push(b'+');
        out.extend_from_slice(line.trim_end_matches('\n').as_bytes());
        out.push(b'\n');
    }
    if !bytes.ends_with(b"\n") {
        out.extend_from_slice(b"\\ No newline at end of file\n");
    }
    out
}

pub async fn diff_text(
    rev: &str,
    repo: &str,
    path: Option<&str>,
    ignore_ws: bool,
) -> Result<Vec<u8>, BackendError> {
    let plan = diff_plan_for_rev(rev, ignore_ws);
    let mut args: Vec<String> = vec![
        "-c".into(),
        "core.quotePath=false".into(),
        plan.subcmd.into(),
        "--no-color".into(),
    ];
    args.extend(plan.args);
    if let Some(p) = path {
        args.push("--".into());
        args.push(p.to_string());
    }
    let repo = PathBuf::from(repo);
    let output = tokio::process::Command::new("git")
        .current_dir(&repo)
        .args(&args)
        .output()
        .await
        .map_err(|e| BackendError::Internal(format!("git failed: {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(BackendError::BadRequest(format!("git {rev}: {stderr}")));
    }
    let mut stdout = output.stdout;
    if plan.include_untracked {
        for file in untracked_files(&repo, path).await? {
            stdout.extend_from_slice(&file.diff);
        }
    }
    Ok(stdout)
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

pub fn register_stdin_patch(patch: Vec<u8>) -> String {
    let id = hash_hex(&patch);
    stdin_patches().lock().unwrap().insert(id.clone(), patch);
    id
}

fn stdin_patches() -> &'static Mutex<HashMap<String, Vec<u8>>> {
    static PATCHES: OnceLock<Mutex<HashMap<String, Vec<u8>>>> = OnceLock::new();
    PATCHES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn get_stdin_patch(id: &str) -> Result<Vec<u8>, BackendError> {
    stdin_patches()
        .lock()
        .unwrap()
        .get(id)
        .cloned()
        .ok_or_else(|| BackendError::NotFound(format!("patch not found: {id}")))
}

fn files_from_patch(id: &str) -> Result<Vec<FileEntry>, String> {
    let patch = get_stdin_patch(id).map_err(backend_error_text)?;
    let text = String::from_utf8_lossy(&patch);
    let visible = count_visible_lines_per_file(&text);
    let entries = patch_entries(&text);
    Ok(entries
        .into_iter()
        .map(|entry| {
            let (vis_u, vis_s) = visible
                .get(&entry.path)
                .map(|v| (v.unified, v.split))
                .unwrap_or((0, 0));
            FileEntry {
                path: entry.path,
                status: entry.status,
                additions: entry.additions,
                deletions: entry.deletions,
                visible_lines: vis_u,
                visible_lines_split: vis_s,
            }
        })
        .collect())
}

fn patch_entries(diff: &str) -> Vec<PatchEntry> {
    let mut entries = Vec::new();
    let mut current: Option<PatchEntry> = None;
    let mut in_hunk = false;
    for line in diff.lines() {
        if let Some(rest) = line.strip_prefix("diff --git ") {
            if let Some(entry) = current.take() {
                entries.push(entry);
            }
            current = parse_diff_git_new_path(rest).map(|path| PatchEntry {
                path,
                status: "modified".into(),
                additions: 0,
                deletions: 0,
            });
            in_hunk = false;
        } else if line.starts_with("new file mode ") {
            if let Some(entry) = &mut current {
                entry.status = "added".into();
            }
        } else if line.starts_with("deleted file mode ") {
            if let Some(entry) = &mut current {
                entry.status = "deleted".into();
            }
        } else if line.starts_with("rename ") {
            if let Some(entry) = &mut current {
                entry.status = "renamed".into();
            }
        } else if line.starts_with("@@") {
            in_hunk = true;
        } else if in_hunk {
            match line.as_bytes().first().copied() {
                Some(b'+') => {
                    if let Some(entry) = &mut current {
                        entry.additions += 1;
                    }
                }
                Some(b'-') => {
                    if let Some(entry) = &mut current {
                        entry.deletions += 1;
                    }
                }
                _ => {}
            }
        }
    }
    if let Some(entry) = current {
        entries.push(entry);
    }
    entries
}

async fn diff_handler(AxumQuery(params): AxumQuery<DiffParams>) -> Response {
    let rev = params.rev.unwrap_or_else(|| "HEAD".to_string());
    let ignore_ws = matches!(params.w.as_deref(), Some("1") | Some("true"));
    let result = if let Some(patch) = params.patch.as_deref() {
        patch_text(patch, params.path.as_deref())
    } else if let Some(repo) = params.repo.as_deref() {
        diff_text(&rev, repo, params.path.as_deref(), ignore_ws).await
    } else {
        Err(BackendError::BadRequest("repo or patch is required".into()))
    };
    match result {
        Ok(out) => ([(header::CONTENT_TYPE, "text/x-diff; charset=utf-8")], out).into_response(),
        Err(BackendError::Internal(msg)) => {
            (StatusCode::INTERNAL_SERVER_ERROR, msg).into_response()
        }
        Err(BackendError::BadRequest(msg)) => (StatusCode::BAD_REQUEST, msg).into_response(),
        Err(BackendError::NotFound(msg)) => (StatusCode::NOT_FOUND, msg).into_response(),
    }
}

async fn blob_handler(AxumQuery(params): AxumQuery<BlobParams>) -> Response {
    if params.patch.is_some() {
        return (
            [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
            Vec::new(),
        )
            .into_response();
    }
    let Some(repo) = params.repo else {
        return (StatusCode::BAD_REQUEST, "repo is required").into_response();
    };
    match blob_text(&params.rev, &repo, &params.path).await {
        Ok(out) => ([(header::CONTENT_TYPE, "text/plain; charset=utf-8")], out).into_response(),
        Err(BackendError::Internal(msg)) => {
            (StatusCode::INTERNAL_SERVER_ERROR, msg).into_response()
        }
        Err(BackendError::BadRequest(msg)) => (StatusCode::BAD_REQUEST, msg).into_response(),
        Err(BackendError::NotFound(msg)) => (StatusCode::NOT_FOUND, msg).into_response(),
    }
}

fn patch_text(id: &str, path: Option<&str>) -> Result<Vec<u8>, BackendError> {
    let patch = get_stdin_patch(id)?;
    let Some(path) = path else {
        return Ok(patch);
    };
    let text = String::from_utf8_lossy(&patch);
    let mut out = String::new();
    let mut include = false;
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("diff --git ") {
            include = parse_diff_git_new_path(rest).is_some_and(|p| p == path);
        }
        if include {
            out.push_str(line);
            out.push('\n');
        }
    }
    Ok(out.into_bytes())
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
    run_with_port(None, on_bound).await
}

pub async fn run_on_port_with_callback<F>(
    port: Option<u16>,
    on_bound: F,
) -> Result<(), Box<dyn std::error::Error>>
where
    F: FnOnce(u16),
{
    run_with_port(port, on_bound).await
}

async fn run_with_port<F>(port: Option<u16>, on_bound: F) -> Result<(), Box<dyn std::error::Error>>
where
    F: FnOnce(u16),
{
    let schema = build_schema();
    let app = build_router(schema);
    let port: u16 = port.unwrap_or_else(|| {
        std::env::var("PORT")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0)
    });
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

    fn plan(rev: &str) -> DiffPlan {
        base_diff_plan(rev)
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
        assert!(plan("working").include_untracked);
        assert!(!plan("staging").include_untracked);
    }

    #[test]
    fn diff_spec_maps_pseudo_ranges() {
        assert_eq!(args("HEAD..working"), ("diff", vec!["HEAD".to_string()]));
        assert_eq!(
            args("HEAD..staging"),
            ("diff", vec!["--cached".to_string(), "HEAD".to_string()])
        );
        assert_eq!(args("staging..working"), ("diff", vec![]));
        assert!(plan("HEAD..working").include_untracked);
        assert!(plan("staging..working").include_untracked);
    }

    #[test]
    fn untracked_text_diff_renders_added_file() {
        let diff =
            String::from_utf8(render_untracked_diff("new.txt", b"one\ntwo\n", "100644")).unwrap();
        assert!(diff.contains("diff --git a/new.txt b/new.txt"));
        assert!(diff.contains("new file mode 100644"));
        assert!(diff.contains("@@ -0,0 +1,2 @@"));
        assert!(diff.contains("+one\n+two\n"));
    }

    #[test]
    fn patch_entries_parse_statuses_and_counts() {
        let diff = "\
diff --git a/a.txt b/a.txt
new file mode 100644
@@ -0,0 +1,2 @@
+one
+two
diff --git a/b.txt b/b.txt
deleted file mode 100644
@@ -1,2 +0,0 @@
-one
-two
diff --git a/c.txt b/d.txt
similarity index 100%
rename from c.txt
rename to d.txt
@@ -1,1 +1,1 @@
-old
+new
";
        let entries = patch_entries(diff);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].path, "a.txt");
        assert_eq!(entries[0].status, "added");
        assert_eq!(entries[0].additions, 2);
        assert_eq!(entries[0].deletions, 0);
        assert_eq!(entries[1].path, "b.txt");
        assert_eq!(entries[1].status, "deleted");
        assert_eq!(entries[1].additions, 0);
        assert_eq!(entries[1].deletions, 2);
        assert_eq!(entries[2].path, "d.txt");
        assert_eq!(entries[2].status, "renamed");
        assert_eq!(entries[2].additions, 1);
        assert_eq!(entries[2].deletions, 1);
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
