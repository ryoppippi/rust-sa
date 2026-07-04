# conao3-sa

Local git diff & repo reviewer. Browse a working tree, walk the commit
graph, and review diffs (file-tree, viewed state, inline comments,
vim-flavoured keybindings) — all from your own machine, no upload.

Crate name: `conao3-sa`. Executable: `sa`.

## Status

Early development. The codebase is intentionally small and the API
surfaces are not stable.

## Install & run

`conao3-sa` is published on crates.io
([crates.io/crates/conao3-sa](https://crates.io/crates/conao3-sa)).

### Prerequisites

- Rust toolchain (1.95+) — install via [rustup](https://rustup.rs/) or
  the Nix devShell (`nix develop`).
- A `git` binary on `PATH` (the backend shells out to it).
- For the Tauri shell on Linux: `webkit2gtk-4.1`, `libsoup-3`,
  `gtk3` (see the Tauri docs for your distro).

### Option A — install from crates.io

```bash
cargo install conao3-sa
```

One executable lands in `~/.cargo/bin`:

| Command       | What it does                                                                  |
| ------------- | ----------------------------------------------------------------------------- |
| `sa`          | Tauri desktop shell that starts the axum backend in-process and opens a WebView. |
| `sa <spec>`   | Headless axum backend, browser open at `/compare/<spec>?repo=<cwd repo>`.      |
| `sa --serve`  | Headless axum backend with `/api/*` and embedded SPA static serving.            |

The published crate **bundles a pre-built SPA**, so `sa` works out of
the box without a Node/pnpm toolchain on the host.

### Option B — install from source

```bash
git clone https://github.com/conao3/rust-sa
cd rust-sa
direnv allow   # or: nix develop      # gives you rust, node, pnpm, cargo-tauri

make dist                              # build the SPA into src-tauri/dist
cargo install --path src-tauri --bin sa
```

`make dist` runs `pnpm build` and copies `frontend/.output/public` into
`src-tauri/dist`, which is the path Tauri reads as `frontendDist`.

### Producing a platform bundle

```bash
make ship      # cargo tauri build --no-bundle      → target/release/sa
make bundle    # cargo tauri build (full bundle)    → .deb / .AppImage / .rpm etc.
```

Bundling needs the usual platform tooling (`linuxdeploy`/`fpm` on Linux,
Xcode on macOS, MSVC + WiX on Windows); cargo-tauri provisions most of
it on first run.

### Launching

```bash
# Desktop UI. The shell starts the backend in a side thread, then opens
# the WebView pointed at the embedded SPA.
sa

# CLI diff review for the current git repository. The backend binds to
# 127.0.0.1 on a dynamic port and opens the system browser.
sa HEAD~3...HEAD
sa working
sa staging

# Headless backend with embedded SPA static serving.
sa --serve
```

`sa --serve` reads `PORT`; when it is unset, the OS assigns a dynamic
port. The startup log prints the bound GraphQL, diff, blob, and SSE
URLs. `PORTLESS_URL` rewrites the printed URLs for portless-based dev
sessions.

The first time you launch the desktop UI, you'll be on `/` — point it
at any local repo via the folder picker and you'll land in `/browse`.
From there `graph` / `diff` are linked in the top bar. The headless
server serves the SPA with deep-link fallback, so `/compare/<spec>` and
other client routes can be reloaded directly.

### Preferences

Theme is persisted to `~/.config/sa/config.toml`. Everything else
(layout, density, pane widths, recents, comments, viewed state) lives
in browser `localStorage`.


## Stack

- **Backend** (`src-tauri/`) — Rust, axum, async-graphql, Tauri 2.
  Shells out to `git` for diff / log / show / ls-tree / for-each-ref;
  serves the embedded SPA, GraphQL at `/api/graphql`, and SSE at `/api/events`.
  Per-repo file watcher via notify-debouncer-mini, filtered through the
  `ignore` crate so nested `.gitignore` and global excludes are honored.
  Preferences persist to `~/.config/sa/config.toml`.
- **Frontend** (`frontend/`) — TanStack Start (React 19) on Vite +
  Rolldown. React Compiler, TanStack Router / Form / Hotkeys, Apollo
  Client 4, react-aria-components, Tailwind v4. Diff rendering via
  `@pierre/diffs`, file tree via `@pierre/trees`, syntax highlighting
  via Shiki.
- **Tooling** — oxlint, oxfmt, knip, tsc (via `make lint`); cargo-watch
  for backend auto-reload; treefmt + nixfmt / rustfmt / prettier; flake
  devShell.

## Layout

```
src-tauri/      Rust backend (axum + GraphQL + git CLI)
  src/main.rs        Tauri shell (executable: sa)
  src/server.rs      axum + GraphQL backend (also reachable via `sa --serve`)
frontend/       TanStack Start frontend
  src/routes/   __root, /, /browse, /compare/$, /graph, /preference, /design, /health
  src/components, src/lib
Makefile        Orchestrates src-tauri + frontend
flake.nix       Nix devShell (rust, node, pnpm, cargo-tauri, cargo-watch)
```

## Routes

- `/` — landing. Repo input + folder picker (fuzzy filter; click the
  `GIT` badge on any row to open it directly); recents list with
  per-row trash.
- `/browse?repo=<abs>&path=<rel>&rev=<ref>` — repo browser. Closed
  tree on first paint; clicking a file fetches its content from
  `/api/blob` and renders it with Shiki. Blob & highlight are cached
  by URL/path so revisits are instant. `rev` defaults to `HEAD`.
- `/compare/$spec?repo=<abs>&w=1` — diff reviewer. `spec` accepts any
  git rev (`HEAD`, `main`, `v1.0`, `feature/foo`), a two-dot range
  (`main..feature`), or three-dot (`HEAD~3...HEAD`). The pseudos
  `working` and `staging` resolve to `git diff HEAD` and
  `git diff --cached HEAD`, and can also participate in ranges
  (`<commit>..working`, `<commit>..staging`, `staging..working`, …).
  Merge commits show first-parent diff. `?w=1` adds `-w` to ignore
  whitespace. Toggle layout (unified/split) and whitespace from the
  gear menu in the top bar.
- `/graph?repo=<abs>` — commit log + range picker.
  - Sticky `COMMITS` header, infinite scroll for older history.
  - `WORKING` / `STAGING` pseudo-rows pinned at the top, branches and
    tags as collapsible sections (with a fuzzy filter when there are
    more than a handful).
  - **click** sets base, **Ctrl/Cmd + click** sets head,
    **drag across rows** picks `base..head` in one gesture (with the
    intermediate commits tinted), **double-click** opens that commit's
    diff in `/compare`.
- `/preference` — settings. Theme (light/dark) is persisted to
  `~/.config/sa/config.toml`; display options (layout, density,
  pane widths) live in localStorage.
- `/design` — design tokens & palette reference.

## Backend API

```
POST /api/graphql      health, preferences, listDir, commits(limit, skip, repo),
                       files(rev, repo, w), branches(repo), tags(repo),
                       tree(repo, rev), setPreferences(theme)
GET  /api/diff         ?rev=&path=&repo=[&w=1]   text/x-diff, gzip
GET  /api/blob         ?rev=&path=&repo=         text/plain, gzip
GET  /api/events       ?repo=                     SSE; per-repo, gitignore-aware
```

`?repo=<absolute-path>` is required on every URL that touches a
repository. There is no implicit default.

## Development

For working on rust-sa itself (auto-rebuild backend, vite HMR for
frontend). Requires Nix with flakes (provides rust, node 24, pnpm 10,
cargo-tauri, cargo-watch). Otherwise install those tools manually.

```bash
# enter devShell
direnv allow   # or: nix develop

# install frontend deps
cd frontend && pnpm install

# run backend (axum via portless, auto-restart on .rs edits)
make -C src-tauri dev

# run frontend (vite dev via portless proxy at https://sa.localhost)
make -C frontend dev
```

`devo run` wires both processes as a tmux session named `rust-sa`.

## Lint / format

```bash
make lint     # cargo check + cargo clippy + tsc + oxlint + oxfmt --check + knip
make fmt      # treefmt (rustfmt + prettier + nixfmt) + oxfmt --write
```

## Notable design choices

- `/browse` caches blob fetches **and** Shiki highlight output by URL
  and `(path, theme, content prefix)`, so flipping between files is
  instant after the first visit. The `loading…` indicator is deferred
  200 ms — cache hits never get to show it, only cold fetches do.
- `ignore` crate is used in the watcher so SSE only fires for paths the
  target repo actually cares about (nested `.gitignore`, `info/exclude`,
  global excludes via `core.excludesFile`). Directory-level notify
  events are skipped to suppress spurious refreshes when generated
  files inside ignored directories churn.
- Watcher events are debounced (3 s) and the frontend additionally
  debounces SSE (1.5 s) plus compares the file-list signature before
  flipping any `live` UI, so background dev servers (e.g. Next.js
  rebuilding `.next/`) never flicker the diff view.
- React Compiler handles memoisation; `useMemo` / `useCallback` are
  avoided in application code.
- Comments live in `localStorage`, keyed by rev; the model carries
  `startLineNumber` / `endLineNumber` so multi-line ranges round-trip.
- Theme is the only preference that goes to disk (`config.toml`); all
  ephemeral display state (mode, density, pane widths, section
  open/closed) stays in localStorage to avoid filesystem chatter.

## License

MIT
