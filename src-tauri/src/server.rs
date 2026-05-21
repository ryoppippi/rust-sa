use async_graphql::{EmptySubscription, Object, Schema, SimpleObject};
use async_graphql_axum::{GraphQLRequest, GraphQLResponse};
use axum::{
    extract::Query as AxumQuery,
    http::{header, StatusCode},
    response::{sse::{Event, KeepAlive, Sse}, IntoResponse, Response},
    routing::{get, post},
    Extension, Router,
};
use futures::stream::Stream;
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use ignore::Match;
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebounceEventResult};
use serde::Deserialize;
use std::{
    collections::HashMap,
    convert::Infallible,
    net::{Ipv4Addr, SocketAddr},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tokio::{net::TcpListener, sync::broadcast};
use tokio_stream::{wrappers::BroadcastStream, StreamExt};
use tower_http::{compression::CompressionLayer, cors::{Any, CorsLayer}};

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
        Err(_) => return Preferences { theme: "light".into() },
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
    let body = toml::to_string_pretty(prefs)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
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
        let start = start
            .canonicalize()
            .map_err(|e| async_graphql::Error::new(format!("canonicalize {}: {e}", start.display())))?;
        if !start.is_dir() {
            return Err(async_graphql::Error::new(format!("not a directory: {}", start.display())));
        }
        let mut entries: Vec<DirEntry> = std::fs::read_dir(&start)
            .map_err(|e| async_graphql::Error::new(format!("read_dir {}: {e}", start.display())))?
            .filter_map(|res| res.ok())
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().into_owned();
                let ft = e.file_type().ok()?;
                let is_dir = ft.is_dir()
                    || (ft.is_symlink() && std::fs::metadata(e.path()).map(|m| m.is_dir()).unwrap_or(false));
                let is_git_repo = is_dir && e.path().join(".git").exists();
                let is_hidden = name.starts_with('.');
                Some(DirEntry { name, is_dir, is_git_repo, is_hidden })
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

        let mut numstat_args: Vec<String> = vec!["-c".into(), "core.quotePath=false".into(), subcmd.into(), "--no-color".into(), "--numstat".into()];
        numstat_args.extend(extra.clone());
        let mut status_args: Vec<String> = vec!["-c".into(), "core.quotePath=false".into(), subcmd.into(), "--no-color".into(), "--name-status".into()];
        status_args.extend(extra);

        let cwd = PathBuf::from(&repo);
        let (numstat, name_status) = tokio::join!(
            tokio::process::Command::new("git").current_dir(&cwd).args(&numstat_args).output(),
            tokio::process::Command::new("git").current_dir(&cwd).args(&status_args).output(),
        );
        let numstat = numstat.map_err(|e| async_graphql::Error::new(format!("git numstat: {e}")))?;
        let name_status = name_status.map_err(|e| async_graphql::Error::new(format!("git name-status: {e}")))?;
        if !numstat.status.success() || !name_status.status.success() {
            return Err(async_graphql::Error::new(format!(
                "git {rev}: {}",
                String::from_utf8_lossy(&numstat.stderr)
            )));
        }

        let mut entries: std::collections::BTreeMap<String, FileEntry> = std::collections::BTreeMap::new();
        for line in String::from_utf8_lossy(&numstat.stdout).lines() {
            let mut parts = line.splitn(3, '\t');
            let add = parts.next().unwrap_or("0").parse::<i32>().unwrap_or(0);
            let del = parts.next().unwrap_or("0").parse::<i32>().unwrap_or(0);
            let raw = match parts.next() {
                Some(p) => p,
                None => continue,
            };
            let path = normalize_renamed_path(raw);
            entries
                .entry(path.clone())
                .and_modify(|e| {
                    e.additions += add;
                    e.deletions += del;
                })
                .or_insert(FileEntry {
                    path,
                    status: "modified".into(),
                    additions: add,
                    deletions: del,
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
            entries
                .entry(path.clone())
                .and_modify(|e| e.status = status.into())
                .or_insert(FileEntry {
                    path,
                    status: status.into(),
                    additions: 0,
                    deletions: 0,
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

    async fn tree(
        &self,
        repo: String,
        rev: Option<String>,
    ) -> async_graphql::Result<Vec<String>> {
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
    let mut args: Vec<String> = vec!["-c".into(), "core.quotePath=false".into(), subcmd.into(), "--no-color".into()];
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
        return Err(BackendError::NotFound(format!("git show {target}: {stderr}")));
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
        Ok(out) => (
            [(header::CONTENT_TYPE, "text/x-diff; charset=utf-8")],
            out,
        )
            .into_response(),
        Err(BackendError::Internal(msg)) => (StatusCode::INTERNAL_SERVER_ERROR, msg).into_response(),
        Err(BackendError::BadRequest(msg)) => (StatusCode::BAD_REQUEST, msg).into_response(),
        Err(BackendError::NotFound(msg)) => (StatusCode::NOT_FOUND, msg).into_response(),
    }
}

async fn blob_handler(AxumQuery(params): AxumQuery<BlobParams>) -> Response {
    match blob_text(&params.rev, &params.repo, &params.path).await {
        Ok(out) => (
            [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
            out,
        )
            .into_response(),
        Err(BackendError::Internal(msg)) => (StatusCode::INTERNAL_SERVER_ERROR, msg).into_response(),
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
    let debouncer = spawn_watcher(tx.clone(), repo.clone());
    Box::leak(Box::new(debouncer));
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

fn build_router(schema: AppSchema) -> Router {
    Router::new()
        .route("/api/graphql", post(graphql_handler))
        .route("/api/diff", get(diff_handler))
        .route("/api/blob", get(blob_handler))
        .route("/api/events", get(events_handler))
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

fn unignored_paths(ig: &RepoIgnore, paths: &[PathBuf]) -> Vec<PathBuf> {
    paths
        .iter()
        .filter(|p| {
            let s = p.to_string_lossy();
            if s.contains("/.git/") || s.ends_with("/.git") {
                return false;
            }
            if p.is_dir() {
                return false;
            }
            !ig.is_ignored(p, false)
        })
        .cloned()
        .collect()
}

fn spawn_watcher(
    tx: broadcast::Sender<String>,
    root: PathBuf,
) -> notify_debouncer_mini::Debouncer<notify::RecommendedWatcher> {
    let watcher_tx = tx.clone();
    let ignore = RepoIgnore::load(&root);
    let mut debouncer = new_debouncer(Duration::from_secs(3), move |res: DebounceEventResult| {
        if let Ok(events) = res {
            let paths: Vec<PathBuf> = events.iter().map(|e| e.path.clone()).collect();
            if !unignored_paths(&ignore, &paths).is_empty() {
                let _ = watcher_tx.send("changed".to_string());
            }
        }
    })
    .expect("failed to create debouncer");
    if let Err(e) = debouncer.watcher().watch(&root, RecursiveMode::Recursive) {
        eprintln!("watch failed for {}: {e}", root.display());
    } else {
        eprintln!("watching {}", root.display());
    }
    debouncer
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
