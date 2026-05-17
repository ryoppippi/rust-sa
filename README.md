# rust-sa

Local git diff reviewer. Point it at a repository on disk, pick a rev or
range, and review the patch with file tree, viewed state, inline
comments, and vim-flavoured keybindings — without leaving your machine.

## Status

Early development. The codebase is intentionally small and the API
surfaces are not stable.

## Stack

- **Backend** (`src-tauri/`) — Rust, axum, async-graphql, Tauri 2. Shells
  out to `git` for diff / log / show; serves GraphQL at `/api/graphql`
  and SSE at `/api/events`. Per-repo file watcher via
  notify-debouncer-mini.
- **Frontend** (`frontend/`) — TanStack Start (React 19) on Vite +
  Rolldown. React Compiler, TanStack Router / Form / Hotkeys, Apollo
  Client, react-aria-components, Tailwind v4. Diff rendering by
  `@pierre/diffs`, file tree by `@pierre/trees`.
- **Tooling** — oxlint, oxfmt, knip, tsc (via `make lint`); cargo-watch
  for backend auto-reload; treefmt + nixfmt / rustfmt / prettier; flake
  devShell.

## Layout

```
src-tauri/      Rust backend (axum + GraphQL + git CLI)
  src/bin/serve.rs
frontend/       TanStack Start frontend
  src/routes/   __root, /, /compare/$, /graph, /design, /health
  src/components, src/lib
Makefile        Orchestrates src-tauri + frontend
flake.nix       Nix devShell (rust, node, pnpm, cargo-tauri, cargo-watch)
```

## Routes

- `/` — landing page, folder picker, recent repositories
- `/compare/$spec?repo=<abs>` — diff reviewer. `spec` accepts a single
  rev (`HEAD`), a two-dot range (`main..feature`), or three-dot
  (`HEAD~3...HEAD`). Merge commits show first-parent diff.
- `/graph?repo=<abs>` — commit log; click sets base, shift-click sets
  head, "open diff" navigates to `/compare`.
- `/design` — design tokens & palette reference (no repo required).

## Development

Requires Nix with flakes (provides rust, node 24, pnpm 10, cargo-tauri,
cargo-watch). Otherwise install those tools manually.

```bash
# enter devShell
direnv allow   # or: nix develop

# install frontend deps
cd frontend && pnpm install

# run backend (axum at :4000, auto-restart on .rs edits)
make -C src-tauri dev

# run frontend (vite dev via portless proxy at https://sa.localhost)
make -C frontend dev
```

The two processes are independent. `devo.yaml` wires both as a tmux
session named `rust-sa`.

## Lint / format

```bash
make lint     # cargo check + cargo clippy + tsc + oxlint + oxfmt --check + knip
make fmt      # treefmt (rustfmt + prettier + nixfmt) + oxfmt --write
```

## Notable design choices

- `?repo=<absolute-path>` is required on every URL that touches a
  repository. There is no implicit default; the backend never hard-codes
  a repo root.
- SSE watchers are created per-`repo` query parameter and lazily reused
  via a process-wide `OnceLock<Mutex<HashMap>>`.
- React Compiler handles memoisation; `useMemo` / `useCallback` are
  avoided in application code.
- Comments live in `localStorage`, keyed by rev; the model carries
  `startLineNumber` / `endLineNumber` so multi-line ranges round-trip.

## License

MIT
