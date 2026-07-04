#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--once" ]; then
  bin=${2:?missing binary}
  out=$(mktemp)
  "$bin" --serve >"$out" 2>&1 &
  pid=$!
  cleanup() {
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    rm -f "$out"
  }
  trap cleanup EXIT INT TERM
  url=""
  for _ in $(seq 1 500); do
    url=$(sed -n 's/^graphql at  \(http:\/\/.*\/api\/graphql\)$/\1/p' "$out" | tail -n 1)
    if [ -n "$url" ]; then
      break
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      cat "$out" >&2
      exit 1
    fi
    sleep 0.01
  done
  if [ -z "$url" ]; then
    cat "$out" >&2
    exit 1
  fi
  curl --silent --show-error --retry 200 --retry-connrefused --retry-all-errors --retry-delay 0 --max-time 5 \
    -H 'content-type: application/json' \
    --data '{"query":"{ health }"}' \
    "$url" >/dev/null
  exit 0
fi

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
make dist
mkdir -p src-tauri/target/bench bench/results
cargo build --release --manifest-path src-tauri/Cargo.toml --bin sa --target-dir src-tauri/target/desktop
cargo build --release --no-default-features --manifest-path src-tauri/Cargo.toml --bin sa --target-dir src-tauri/target/headless
hyperfine --runs 10 --warmup 1 --export-json bench/results/.coldstart-hyperfine.json \
  "bench/coldstart.sh --once src-tauri/target/desktop/release/sa" \
  "bench/coldstart.sh --once src-tauri/target/headless/release/sa"
node <<'NODE'
const fs = require('node:fs')
const os = require('node:os')
const childProcess = require('node:child_process')
const date = new Date().toISOString().slice(0, 10)
const hyperfine = JSON.parse(fs.readFileSync('bench/results/.coldstart-hyperfine.json', 'utf8'))
const exec = (cmd) => childProcess.execSync(cmd, { encoding: 'utf8' }).trim()
const result = {
  metadata: {
    date,
    cache: 'warm page cache',
    cpu: os.cpus()[0]?.model ?? 'unknown',
    kernel: exec('uname -srmo'),
    git: exec('git --version'),
    revision: exec('git describe --always --dirty'),
  },
  hyperfine,
}
fs.writeFileSync(`bench/results/${date}.json`, `${JSON.stringify(result, null, 2)}\n`)
fs.unlinkSync('bench/results/.coldstart-hyperfine.json')
NODE
