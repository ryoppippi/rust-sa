use std::path::Path;

use conao3_sa::server::{build_schema, register_stdin_patch, spec_to_diff_args};

#[cfg(feature = "desktop")]
use std::sync::atomic::{AtomicU32, Ordering};

#[cfg(feature = "desktop")]
use std::path::PathBuf;

#[cfg(feature = "desktop")]
use tauri::{ipc::Channel, AppHandle, State, WebviewUrl, WebviewWindowBuilder};

#[cfg(feature = "desktop")]
use conao3_sa::server::{blob_text, diff_text, watcher_for, AppSchema, BackendError};

#[cfg(feature = "desktop")]
#[tauri::command]
async fn graphql(
    schema: State<'_, AppSchema>,
    query: String,
    variables: Option<serde_json::Value>,
    operation_name: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut request = async_graphql::Request::new(query);
    if let Some(vars) = variables {
        request = request.variables(async_graphql::Variables::from_json(vars));
    }
    if let Some(name) = operation_name {
        request = request.operation_name(name);
    }
    let response = schema.execute(request).await;
    serde_json::to_value(response).map_err(|err| err.to_string())
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn diff(
    rev: String,
    repo: String,
    path: Option<String>,
    w: Option<bool>,
) -> Result<String, String> {
    let bytes = diff_text(&rev, &repo, path.as_deref(), w.unwrap_or(false))
        .await
        .map_err(backend_error_to_string)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn blob(rev: String, repo: String, path: String) -> Result<String, String> {
    let bytes = blob_text(&rev, &repo, &path)
        .await
        .map_err(backend_error_to_string)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn subscribe_events(repo: String, channel: Channel<String>) -> Result<(), String> {
    let tx = watcher_for(PathBuf::from(&repo));
    let mut rx = tx.subscribe();
    tauri::async_runtime::spawn(async move {
        while let Ok(payload) = rx.recv().await {
            if channel.send(payload).is_err() {
                break;
            }
        }
    });
    Ok(())
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn open_new_window(app: AppHandle) -> Result<(), String> {
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let id = COUNTER.fetch_add(1, Ordering::Relaxed);
    let label = format!("window-{id}");
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("/".into()))
        .title("rust-sa")
        .inner_size(1200.0, 800.0)
        .resizable(true)
        .on_document_title_changed(|window, title| {
            let _ = window.set_title(&title);
        })
        .build()
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[cfg(feature = "desktop")]
fn backend_error_to_string(err: BackendError) -> String {
    match err {
        BackendError::Internal(msg) => msg,
        BackendError::BadRequest(msg) => msg,
        BackendError::NotFound(msg) => msg,
    }
}

#[derive(Debug, PartialEq, Eq)]
struct CliOptions {
    schema: bool,
    serve: bool,
    no_open: bool,
    port: Option<u16>,
    spec: Option<String>,
}

fn usage() -> &'static str {
    "usage: sa [--schema | --serve] [--no-open] [--port <port>] [<spec>|-]"
}

fn parse_args(args: &[String]) -> Result<CliOptions, String> {
    let mut out = CliOptions {
        schema: false,
        serve: false,
        no_open: false,
        port: None,
        spec: None,
    };
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        if arg == "--schema" {
            out.schema = true;
        } else if arg == "--serve" {
            out.serve = true;
        } else if arg == "--no-open" {
            out.no_open = true;
        } else if arg == "--port" {
            i += 1;
            let Some(value) = args.get(i) else {
                return Err("--port requires a value".into());
            };
            out.port = Some(parse_port(value)?);
        } else if let Some(value) = arg.strip_prefix("--port=") {
            out.port = Some(parse_port(value)?);
        } else if arg == "--help" || arg == "-h" {
            return Err(usage().into());
        } else if arg.starts_with("--") {
            return Err(format!("unknown option: {arg}"));
        } else if out.spec.is_none() {
            out.spec = Some(arg.clone());
        } else {
            return Err(format!("unexpected argument: {arg}"));
        }
        i += 1;
    }
    if out.schema && (out.serve || out.no_open || out.port.is_some() || out.spec.is_some()) {
        return Err("--schema cannot be combined with other options".into());
    }
    if out.serve && out.spec.is_some() {
        return Err("--serve cannot be combined with <spec>".into());
    }
    Ok(out)
}

fn parse_port(value: &str) -> Result<u16, String> {
    value
        .parse::<u16>()
        .map_err(|_| format!("invalid port: {value}"))
}

fn percent_encode(input: &str) -> String {
    input
        .bytes()
        .flat_map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![b as char]
            }
            _ => format!("%{b:02X}").chars().collect(),
        })
        .collect()
}

fn repo_root(cwd: &Path) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .map_err(|err| format!("git rev-parse failed: {err}"))?;
    if !output.status.success() {
        return Err(format!(
            "git rev-parse failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn open_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("open").arg(url).status();
    #[cfg(target_os = "linux")]
    let status = std::process::Command::new("xdg-open").arg(url).status();
    #[cfg(target_os = "windows")]
    let status = std::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .status();
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    let status: Result<std::process::ExitStatus, std::io::Error> = Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "unsupported platform",
    ));

    let status = status.map_err(|err| format!("open browser failed: {err}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("open browser exited with {status}"))
    }
}

fn run_runtime<F>(f: F) -> !
where
    F: std::future::Future<Output = Result<(), Box<dyn std::error::Error>>>,
{
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("failed to start tokio runtime");
    if let Err(err) = runtime.block_on(f) {
        eprintln!("backend exited: {err}");
        std::process::exit(1);
    }
    std::process::exit(0);
}

fn run_cli(spec: String, no_open: bool, port: Option<u16>) -> ! {
    if spec == "-" {
        run_stdin_cli(no_open, port);
    }
    let cwd = std::env::current_dir().expect("failed to get current directory");
    let repo = match repo_root(&cwd) {
        Ok(repo) => repo,
        Err(err) => {
            eprintln!("{err}");
            std::process::exit(1);
        }
    };
    let _ = spec_to_diff_args(&spec);
    let encoded_spec = percent_encode(&spec);
    let encoded_repo = percent_encode(&repo);
    run_runtime(conao3_sa::server::run_on_port_with_callback(
        port,
        move |port| {
            let url = format!("http://127.0.0.1:{port}/compare/{encoded_spec}?repo={encoded_repo}");
            if no_open {
                println!("url        {url}");
            } else {
                println!("opening    {url}");
                if let Err(err) = open_browser(&url) {
                    eprintln!("{err}");
                }
            }
        },
    ))
}

fn run_stdin_cli(no_open: bool, port: Option<u16>) -> ! {
    use std::io::Read;
    let mut patch = Vec::new();
    if let Err(err) = std::io::stdin().read_to_end(&mut patch) {
        eprintln!("read stdin failed: {err}");
        std::process::exit(1);
    }
    let patch_id = register_stdin_patch(patch);
    run_runtime(conao3_sa::server::run_on_port_with_callback(
        port,
        move |port| {
            let url = format!("http://127.0.0.1:{port}/compare/stdin?patch={patch_id}");
            if no_open {
                println!("url        {url}");
            } else {
                println!("opening    {url}");
                if let Err(err) = open_browser(&url) {
                    eprintln!("{err}");
                }
            }
        },
    ))
}

#[cfg(feature = "desktop")]
fn run_desktop() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(build_schema())
        .invoke_handler(tauri::generate_handler![
            graphql,
            diff,
            blob,
            subscribe_events,
            open_new_window
        ])
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("/".into()))
                .title("rust-sa")
                .inner_size(1200.0, 800.0)
                .resizable(true)
                .on_document_title_changed(|window, title| {
                    let _ = window.set_title(&title);
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(not(feature = "desktop"))]
fn run_desktop() {
    eprintln!("{}", usage());
    std::process::exit(1);
}

fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let options = match parse_args(&args) {
        Ok(options) => options,
        Err(err) => {
            if err == usage() {
                println!("{err}");
                return;
            }
            eprintln!("{err}");
            eprintln!("{}", usage());
            std::process::exit(1);
        }
    };
    if options.schema {
        print!("{}", build_schema().sdl());
    } else if options.serve {
        run_runtime(conao3_sa::server::run_on_port_with_callback(
            options.port,
            |_| {},
        ));
    } else if let Some(spec) = options.spec {
        run_cli(spec, options.no_open, options.port);
    } else if options.port.is_some() || options.no_open {
        eprintln!("{}", usage());
        std::process::exit(1);
    } else {
        run_desktop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(args: &[&str]) -> Vec<String> {
        args.iter().map(|arg| arg.to_string()).collect()
    }

    #[test]
    fn parses_spec_flags() {
        assert_eq!(
            parse_args(&s(&["--no-open", "--port", "9000", "HEAD~1..HEAD"])).unwrap(),
            CliOptions {
                schema: false,
                serve: false,
                no_open: true,
                port: Some(9000),
                spec: Some("HEAD~1..HEAD".into()),
            }
        );
    }

    #[test]
    fn parses_serve_port() {
        assert_eq!(
            parse_args(&s(&["--serve", "--port=9001"])).unwrap(),
            CliOptions {
                schema: false,
                serve: true,
                no_open: false,
                port: Some(9001),
                spec: None,
            }
        );
    }

    #[test]
    fn parses_stdin_spec() {
        assert_eq!(
            parse_args(&s(&["--no-open", "-"])).unwrap(),
            CliOptions {
                schema: false,
                serve: false,
                no_open: true,
                port: None,
                spec: Some("-".into()),
            }
        );
    }
}
