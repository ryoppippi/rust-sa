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

struct Query;

#[Object]
impl Query {
    async fn health(&self) -> String {
        "ok".to_string()
    }

    async fn repo_root(&self) -> async_graphql::Result<String> {
        let repo = gix::discover(".")
            .map_err(|e| async_graphql::Error::new(format!("gix discover: {e}")))?;
        let workdir = repo
            .workdir()
            .ok_or_else(|| async_graphql::Error::new("bare repository has no workdir"))?;
        Ok(workdir.to_string_lossy().into_owned())
    }

    async fn commits(&self, limit: Option<i32>) -> async_graphql::Result<Vec<Commit>> {
        let limit = limit.unwrap_or(50).max(1);
        let output = tokio::process::Command::new("git")
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
    let output = match tokio::process::Command::new("git").args(&args).output().await {
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

fn spawn_watcher(tx: broadcast::Sender<String>) -> notify_debouncer_mini::Debouncer<notify::RecommendedWatcher> {
    let watcher_tx = tx.clone();
    let mut debouncer = new_debouncer(Duration::from_millis(250), move |res: DebounceEventResult| {
        if let Ok(events) = res {
            if events.iter().any(|e| is_interesting(&e.path)) {
                let _ = watcher_tx.send("changed".to_string());
            }
        }
    })
    .expect("failed to create debouncer");
    let root: PathBuf = gix::discover(".")
        .ok()
        .and_then(|r| r.workdir().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
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
    let _watcher = spawn_watcher(tx.clone());
    let app = build_router(schema, tx);
    let addr: SocketAddr = "127.0.0.1:4000".parse().unwrap();
    let listener = TcpListener::bind(addr).await.unwrap();
    println!("graphql at  http://{addr}/api/graphql");
    println!("diff text   http://{addr}/api/diff?rev=HEAD");
    println!("sse events  http://{addr}/api/events");
    axum::serve(listener, app).await.unwrap();
}
