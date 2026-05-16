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

    async fn diff(&self, _rev: String) -> String {
        SAMPLE_PATCH.to_string()
    }
}

const SAMPLE_PATCH: &str = "diff --git a/src/index.ts b/src/index.ts
index 1234567..89abcde 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,5 +1,7 @@
-import { greet } from './greet'
+import { greet, farewell } from './greet'
\x20
-console.log(greet('world'))
+console.log(greet('rust-sa'))
+console.log(farewell('rust-sa'))
+
 export {}
diff --git a/src/greet.ts b/src/greet.ts
index 0000000..fedcba9 100644
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,3 +1,7 @@
 export const greet = (name: string) => `hello ${name}`
+
+export const farewell = (name: string) => `goodbye ${name}`
";

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
