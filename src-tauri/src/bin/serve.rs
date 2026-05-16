use async_graphql::{EmptyMutation, EmptySubscription, Object, Schema};
use async_graphql_axum::{GraphQLRequest, GraphQLResponse};
use axum::{routing::post, Extension, Router};
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tower_http::cors::{Any, CorsLayer};

struct Query;

#[Object]
impl Query {
    async fn health(&self) -> String {
        "ok".to_string()
    }

    async fn diff(&self, rev: Option<String>) -> async_graphql::Result<String> {
        let rev = rev.unwrap_or_else(|| "HEAD".to_string());
        let output = tokio::process::Command::new("git")
            .arg("show")
            .arg("--no-color")
            .arg("--format=")
            .arg(&rev)
            .output()
            .await
            .map_err(|e| async_graphql::Error::new(format!("git show failed: {e}")))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(async_graphql::Error::new(format!(
                "git show {rev}: {stderr}"
            )));
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }
}

type AppSchema = Schema<Query, EmptyMutation, EmptySubscription>;

async fn graphql_handler(schema: Extension<AppSchema>, req: GraphQLRequest) -> GraphQLResponse {
    schema.execute(req.into_inner()).await.into()
}

fn build_router(schema: AppSchema) -> Router {
    Router::new()
        .route("/graphql", post(graphql_handler))
        .layer(Extension(schema))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_headers(Any)
                .allow_methods(Any),
        )
}

#[tokio::main]
async fn main() {
    let schema = Schema::build(Query, EmptyMutation, EmptySubscription).finish();
    let app = build_router(schema);
    let addr: SocketAddr = "127.0.0.1:4000".parse().unwrap();
    let listener = TcpListener::bind(addr).await.unwrap();
    println!("graphql server listening on http://{addr}/graphql");
    axum::serve(listener, app).await.unwrap();
}
