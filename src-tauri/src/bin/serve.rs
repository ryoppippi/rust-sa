use async_graphql::{EmptyMutation, EmptySubscription, Object, Schema, SimpleObject};
use async_graphql_axum::{GraphQLRequest, GraphQLResponse};
use axum::{
    extract::Query as AxumQuery,
    http::{header, StatusCode},
    response::{sse::{Event, KeepAlive, Sse}, IntoResponse, Response},
    routing::{get, post},
    Extension, Router,
};
use futures::stream::Stream;
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebounceEventResult};
use serde::Deserialize;
use std::{convert::Infallible, net::SocketAddr, path::PathBuf, time::Duration};
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
}

#[derive(SimpleObject)]
struct FileEntry {
    path: String,
    status: String,
    additions: i32,
    deletions: i32,
}

struct Query;

#[Object]
impl Query {
    async fn health(&self) -> String {
        "ok".to_string()
    }

    async fn files(
        &self,
        rev: Option<String>,
        repo: String,
    ) -> async_graphql::Result<Vec<FileEntry>> {
        let rev = rev.unwrap_or_else(|| "HEAD".to_string());
        let is_range = rev.contains("..");
        let (subcmd, extra): (&str, Vec<String>) = if is_range {
            ("diff", vec![rev.clone()])
        } else {
            ("show", vec!["--format=".into(), rev.clone()])
        };

        let mut numstat_args: Vec<String> = vec![subcmd.into(), "--no-color".into(), "--numstat".into()];
        numstat_args.extend(extra.clone());
        let mut status_args: Vec<String> = vec![subcmd.into(), "--no-color".into(), "--name-status".into()];
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
        repo: String,
    ) -> async_graphql::Result<Vec<Commit>> {
        let limit = limit.unwrap_or(50).max(1);
        let output = tokio::process::Command::new("git")
            .current_dir(PathBuf::from(&repo))
            .args([
                "log",
                &format!("-n{limit}"),
                "--decorate=short",
                "--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%ar%x1f%D",
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
                if parts.len() < 6 {
                    return None;
                }
                Some(Commit {
                    sha: parts[0].to_string(),
                    short: parts[1].to_string(),
                    message: parts[2].to_string(),
                    author: parts[3].to_string(),
                    when: parts[4].to_string(),
                    refs: parts[5].to_string(),
                })
            })
            .collect();
        Ok(commits)
    }
}

type AppSchema = Schema<Query, EmptyMutation, EmptySubscription>;

async fn graphql_handler(schema: Extension<AppSchema>, req: GraphQLRequest) -> GraphQLResponse {
    schema.execute(req.into_inner()).await.into()
}

#[derive(Deserialize)]
struct DiffParams {
    rev: Option<String>,
    path: Option<String>,
    repo: String,
}

#[derive(Deserialize)]
struct BlobParams {
    rev: String,
    path: String,
    repo: String,
}

fn watch_root_from_env() -> Option<PathBuf> {
    std::env::var("RUST_SA_REPO").ok().map(PathBuf::from)
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


async fn diff_handler(AxumQuery(params): AxumQuery<DiffParams>) -> Response {
    let rev = params.rev.unwrap_or_else(|| "HEAD".to_string());
    let mut args: Vec<String> = if rev.contains("..") {
        vec!["diff".into(), "--no-color".into(), rev.clone()]
    } else {
        vec![
            "show".into(),
            "--no-color".into(),
            "--format=".into(),
            rev.clone(),
        ]
    };
    if let Some(p) = params.path.as_ref() {
        args.push("--".into());
        args.push(p.clone());
    }
    let output = match tokio::process::Command::new("git")
        .current_dir(PathBuf::from(&params.repo))
        .args(&args)
        .output()
        .await
    {
        Ok(o) => o,
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, format!("git failed: {e}")).into_response()
        }
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return (
            StatusCode::BAD_REQUEST,
            format!("git {rev}: {stderr}"),
        )
            .into_response();
    }
    (
        [(header::CONTENT_TYPE, "text/x-diff; charset=utf-8")],
        output.stdout,
    )
        .into_response()
}

async fn blob_handler(AxumQuery(params): AxumQuery<BlobParams>) -> Response {
    let target = format!("{}:{}", params.rev, params.path);
    let output = match tokio::process::Command::new("git")
        .current_dir(PathBuf::from(&params.repo))
        .args(["show", &target])
        .output()
        .await
    {
        Ok(o) => o,
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, format!("git failed: {e}")).into_response()
        }
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return (
            StatusCode::NOT_FOUND,
            format!("git show {target}: {stderr}"),
        )
            .into_response();
    }
    (
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        output.stdout,
    )
        .into_response()
}

async fn events_handler(
    Extension(tx): Extension<broadcast::Sender<String>>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = tx.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|msg| match msg {
        Ok(payload) => Some(Ok(Event::default().data(payload))),
        Err(_) => None,
    });
    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
}

fn build_router(schema: AppSchema, tx: broadcast::Sender<String>) -> Router {
    Router::new()
        .route("/api/graphql", post(graphql_handler))
        .route("/api/diff", get(diff_handler))
        .route("/api/blob", get(blob_handler))
        .route("/api/events", get(events_handler))
        .layer(Extension(schema))
        .layer(Extension(tx))
        .layer(CompressionLayer::new().gzip(true))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_headers(Any)
                .allow_methods(Any),
        )
}

const IGNORED_SEGMENTS: &[&str] = &[
    "/.git/",
    "/target/",
    "/node_modules/",
    "/.tanstack/",
    "/.output/",
    "/.nitro/",
    "/dist/",
    "/.direnv/",
];

fn is_interesting(path: &std::path::Path) -> bool {
    let p = path.to_string_lossy();
    !IGNORED_SEGMENTS.iter().any(|seg| p.contains(seg))
}

fn spawn_watcher(
    tx: broadcast::Sender<String>,
    root: PathBuf,
) -> notify_debouncer_mini::Debouncer<notify::RecommendedWatcher> {
    let watcher_tx = tx.clone();
    let mut debouncer = new_debouncer(Duration::from_millis(250), move |res: DebounceEventResult| {
        if let Ok(events) = res {
            if events.iter().any(|e| is_interesting(&e.path)) {
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

#[tokio::main]
async fn main() {
    let schema = Schema::build(Query, EmptyMutation, EmptySubscription).finish();
    let (tx, _rx) = broadcast::channel::<String>(32);
    let _watcher = watch_root_from_env().map(|root| spawn_watcher(tx.clone(), root));
    let app = build_router(schema, tx);
    let addr: SocketAddr = "127.0.0.1:4000".parse().unwrap();
    let listener = TcpListener::bind(addr).await.unwrap();
    println!("graphql at  http://{addr}/api/graphql");
    println!("diff text   http://{addr}/api/diff?rev=HEAD");
    println!("blob text   http://{addr}/api/blob?rev=HEAD&path=README.md");
    println!("sse events  http://{addr}/api/events");
    axum::serve(listener, app).await.unwrap();
}
