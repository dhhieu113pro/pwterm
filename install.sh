#!/data/data/com.termux/files/usr/bin/bash
# pwterm — one-shot installer for Termux.
#
# From inside this repo:            bash install.sh
# Or one-liner in a fresh Termux:   curl -fsSL <raw-url-for-install.sh> | bash
#
# Options:
#   --dir PATH   install location for a fresh clone (default ~/pwterm)
#   --repo URL   git repository to clone (default: this repo's upstream)
#   --no-global  skip `npm install -g .` (CLI stays usable only via `node bin/pwterm.js`)

set -euo pipefail

REPO_URL="${PWTERM_REPO_URL:-https://github.com/dhhieu113pro/pwterm.git}"
DEST=""
WANT_GLOBAL=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) DEST="${2:?--dir needs a value}"; shift 2 ;;
    --repo) REPO_URL="${2:?--repo needs a value}"; shift 2 ;;
    --no-global) WANT_GLOBAL=0; shift ;;
    -h|--help)
      sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 1 ;;
  esac
done

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. Termux only — the whole point of this project

if [[ -z "${PREFIX:-}" || "$(uname -o 2>/dev/null || echo)" != "Android" ]]; then
  fail "this installer targets Termux on Android (no \$PREFIX detected). On Linux/macOS just run: npm install"
fi

PKG_UPDATED="${PWTERM_HOME:-$HOME}/.pwterm-install-updated"
pkg_install() {
  # pkg update once per run, quietly, then install what's missing.
  [[ -f "$PKG_UPDATED" ]] || { pkg update -y >/dev/null 2>&1 || true; touch "$PKG_UPDATED"; }
  pkg install -y "$@"
}

# ---------------------------------------------------------------------------
# 2. Locate (or clone) the repo

if [[ -z "$DEST" ]]; then
  DEST="$HOME/pwterm"
fi

# Running from inside the repo itself? Use it as-is.
if [[ -n "${BASH_SOURCE:-}" && "${BASH_SOURCE[0]}" != "bash" ]] && \
   [[ -f "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/package.json" ]]; then
  REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
else
  if [[ -f "$DEST/package.json" ]]; then
    REPO_DIR="$DEST"
    say "$REPO_DIR already exists, reusing it"
  else
    say "cloning $REPO_URL into $DEST"
    command -v git >/dev/null || pkg_install git
    git clone --depth 1 "$REPO_URL" "$DEST"
    REPO_DIR="$DEST"
  fi
fi

cd "$REPO_DIR"

# ---------------------------------------------------------------------------
# 3. Dependencies: node, chromium, npm packages

if command -v node >/dev/null; then
  say "node $(node --version) found"
else
  say "installing nodejs (this can take a while)"
  pkg_install nodejs
fi

# Chromium from the Termux X11 repo — Play Store/Android Chrome will NOT work.
CHROMIUM=""
for bin_name in chromium-browser chromium chromium-browser-stable; do
  if command -v "$bin_name" >/dev/null; then CHROMIUM="$(command -v "$bin_name")"; break; fi
done

if [[ -z "$CHROMIUM" ]]; then
  say "installing chromium from the x11-repo"
  pkg_install x11-repo
  pkg_install chromium
  for bin_name in chromium-browser chromium chromium-browser-stable; do
    if command -v "$bin_name" >/dev/null; then CHROMIUM="$(command -v "$bin_name")"; break; fi
  done
fi
[[ -n "$CHROMIUM" ]] || fail "chromium still missing after install; try: pkg install chromium"

say "chromium at $CHROMIUM"

say "installing npm dependencies"
PLAYWRIGHT_BROWSERS_PATH=0 npm install

# ---------------------------------------------------------------------------
# 4. Global `pwterm` command

if [[ "$WANT_GLOBAL" == 1 ]]; then
  say "installing the global pwterm CLI"
  # The repo-local `npm install` above already ran its postinstall, which
  # wrote the shim into $PREFIX/bin — that makes `npm install -g .` fail
  # with EEXIST. Remove our own wrapper first; leave foreign files alone.
  shim_path="$PREFIX/bin/pwterm"
  if [[ -e "$shim_path" ]] && ! grep -q '# pwterm termux shim' "$shim_path" 2>/dev/null; then
    say "$shim_path belongs to another program; keeping the CLI repo-local"
    WANT_GLOBAL=0
  else
    [[ -e "$shim_path" ]] && rm -f "$shim_path"
    npm install -g .
  fi
fi

# Make sure the Termux bin shim exists and points at this repo checkout.
# npm >= 11 can gate the postinstall behind a prompt, and a successful global
# install points its own postinstall at the (frozen) global copy — bind the
# `pwterm` command to this repo either way. When $PREFIX/bin/pwterm belongs
# to another program, termux-shim warns and leaves it untouched.
node "$REPO_DIR/scripts/termux-shim.js"
if [[ "$WANT_GLOBAL" == 0 ]]; then
  say "global CLI skipped; use: node $REPO_DIR/bin/pwterm.js"
fi

# ---------------------------------------------------------------------------
# 5. .env with the detected paths

if [[ ! -f .env ]]; then
  say "writing .env"
  cat > .env <<EOF
PLAYWRIGHT_BROWSERS_PATH=0
CHROMIUM_PATH=$CHROMIUM
EOF
else
  say ".env already exists, leaving it alone"
fi

# ---------------------------------------------------------------------------
# 6. Verify

export PLAYWRIGHT_BROWSERS_PATH=0
export CHROMIUM_PATH="$CHROMIUM"

if command -v pwterm >/dev/null && grep -q '# pwterm termux shim' "$PREFIX/bin/pwterm" 2>/dev/null; then
  PWTERM="pwterm"
else
  PWTERM="node $REPO_DIR/bin/pwterm.js"
fi

say "checking Chromium path, npm env, and a real Chromium launch…"
"$PWTERM" doctor || fail "doctor failed — see the output above"

say "done ✓"
say "try it out:"
say "  $PWTERM doctor"
say "  $PWTERM open"
say "  $PWTERM run examples/login.yaml"
say "  npm test   (from $REPO_DIR)"
