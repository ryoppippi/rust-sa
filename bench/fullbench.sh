#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
work=${BENCH_WORKDIR:-$root/.claude-dev/bench}
sa_bin=${SA_BIN:-$root/src-tauri/target/headless/release/sa}
difit_cmd=${DIFIT_CMD:-npx -y difit@latest}
medium_url=${MEDIUM_REPO_URL:-https://github.com/BurntSushi/ripgrep.git}
medium_base=${MEDIUM_BASE:-14.1.0}
medium_head=${MEDIUM_HEAD:-14.1.1}
large_files=${LARGE_FILES:-1000}
large_lines=${LARGE_LINES:-50}
xlarge_files=${XLARGE_FILES:-20000}

usage() {
  cat <<'USAGE'
usage: bench/fullbench.sh prepare
       bench/fullbench.sh serve <sa|difit> <small|medium|large|xlarge> [port]
       bench/fullbench.sh matrix
USAGE
}

git_config() {
  git config user.name bench
  git config user.email bench@example.invalid
}

prepare_medium() {
  mkdir -p "$work/fixtures"
  if [ ! -d "$work/fixtures/medium/.git" ]; then
    git clone --filter=blob:none "$medium_url" "$work/fixtures/medium"
  fi
  git -C "$work/fixtures/medium" fetch --tags --force origin
}

prepare_large() {
  rm -rf "$work/fixtures/large"
  mkdir -p "$work/fixtures/large"
  cd "$work/fixtures/large"
  git init -q
  git_config
  git commit --allow-empty -qm base
  git tag base
  for i in $(seq -w 1 "$large_files"); do
    mkdir -p "src/${i%??}"
    for line in $(seq 1 "$large_lines"); do
      printf 'file %s line %s\n' "$i" "$line"
    done >"src/${i%??}/file-$i.txt"
  done
  git add .
  git commit -qm "large fixture"
}

prepare_xlarge() {
  rm -rf "$work/fixtures/xlarge"
  mkdir -p "$work/fixtures/xlarge"
  cd "$work/fixtures/xlarge"
  git init -q
  git_config
  first_file=
  for i in $(seq -w 1 "$xlarge_files"); do
    dir="tree/${i%??}"
    file="$dir/file-$i.txt"
    mkdir -p "$dir"
    printf 'base %s\n' "$i" >"$file"
    first_file=${first_file:-$file}
  done
  git add .
  git commit -qm base
  git tag base
  printf 'changed\n' >>"$first_file"
  git add "$first_file"
  git commit -qm "xlarge fixture"
}

prepare() {
  prepare_medium
  prepare_large
  prepare_xlarge
}

fixture_repo() {
  case "$1" in
    small) printf '%s\n' "$root" ;;
    medium) printf '%s\n' "$work/fixtures/medium" ;;
    large) printf '%s\n' "$work/fixtures/large" ;;
    xlarge) printf '%s\n' "$work/fixtures/xlarge" ;;
    *) usage >&2; exit 2 ;;
  esac
}

fixture_sa_spec() {
  case "$1" in
    small) printf '%s\n' 'HEAD~1..HEAD' ;;
    medium) printf '%s..%s\n' "$medium_base" "$medium_head" ;;
    large|xlarge) printf '%s\n' 'base..HEAD' ;;
    *) usage >&2; exit 2 ;;
  esac
}

fixture_difit_args() {
  case "$1" in
    small) printf '%s\n' 'HEAD~1 HEAD' ;;
    medium) printf '%s %s\n' "$medium_base" "$medium_head" ;;
    large|xlarge) printf '%s\n' 'base HEAD' ;;
    *) usage >&2; exit 2 ;;
  esac
}

serve_sa() {
  fixture=$1
  port=$2
  repo=$(fixture_repo "$fixture")
  spec=$(fixture_sa_spec "$fixture")
  cd "$repo"
  exec "$sa_bin" --no-open --port "$port" "$spec"
}

serve_difit() {
  fixture=$1
  port=$2
  repo=$(fixture_repo "$fixture")
  args=$(fixture_difit_args "$fixture")
  cd "$repo"
  exec bash -lc "$difit_cmd --no-open --keep-alive --include-untracked --port '$port' $args"
}

matrix() {
  for target in sa difit; do
    for fixture in small medium large xlarge; do
      printf '%s\t%s\tbench/fullbench.sh serve %s %s %s\n' "$target" "$fixture" "$target" "$fixture" "<port>"
    done
  done
}

case "${1:-}" in
  prepare) prepare ;;
  serve)
    target=${2:-}
    fixture=${3:-}
    port=${4:-0}
    case "$target" in
      sa) serve_sa "$fixture" "$port" ;;
      difit) serve_difit "$fixture" "$port" ;;
      *) usage >&2; exit 2 ;;
    esac
    ;;
  matrix) matrix ;;
  *) usage >&2; exit 2 ;;
esac
