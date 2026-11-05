#!/bin/bash
set -euo pipefail
repo="$1"; base="$2"; commit="$3"; arch="$4"; origin="$5"
export PATH="$HOME/.local/share/vite-plus/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
release="$base/releases/$commit"
if test -f "$release/READY" && test "$(cat "$release/SOURCE_COMMIT")" = "$commit"; then
  echo "Release $commit is already staged."
  exit 0
fi
test ! -e "$release" || { echo 'Incomplete release exists; inspect it before retrying.' >&2; exit 1; }
build="$base/builds/$commit"
mkdir -p "$base/builds" "$base/artifacts/$commit" "$base/tooling" "$base/releases"
git -C "$repo" fetch origin personal
if ! test -d "$build"; then
  git clone --shared --no-checkout "$repo" "$build"
  git -C "$build" remote set-url origin "$origin"
  # Shared clones may borrow a partial object store; allow checkout to fetch missing blobs.
  git -C "$build" config remote.origin.promisor true
  git -C "$build" config remote.origin.partialclonefilter blob:none
  git -C "$build" checkout --detach "$commit"
fi
cd "$build"
test "$(git rev-parse HEAD)" = "$commit"
test -z "$(git status --porcelain)" || { echo 'Build checkout has changes; preserve them.' >&2; exit 1; }
node_version="$(python3 -c 'import json; print(json.load(open("package.json"))["engines"]["node"])')"
if ! test -x "$base/tooling/node-v$node_version-linux-$arch/bin/node"; then
  cd "$base/tooling"
  curl -fsSLO "https://nodejs.org/dist/v$node_version/node-v$node_version-linux-$arch.tar.xz"
  curl -fsSL "https://nodejs.org/dist/v$node_version/SHASUMS256.txt" -o "SHASUMS256-$node_version.txt"
  awk -v name="node-v$node_version-linux-$arch.tar.xz" '$2 == name' "SHASUMS256-$node_version.txt" | sha256sum -c
  tar xf "node-v$node_version-linux-$arch.tar.xz"
  cd "$build"
fi
export PATH="$base/tooling/node-v$node_version-linux-$arch/bin:$PATH"
test "$(node --version)" = "v$node_version"
vp install --frozen-lockfile
vp run --filter t3 build
node apps/server/scripts/cli.ts build-exe
case "$arch" in
  x64) rust_target=x86_64-unknown-linux-gnu ;;
  arm64) rust_target=aarch64-unknown-linux-gnu ;;
  *) exit 2 ;;
esac
cargo build --locked --release --manifest-path native/resource-monitor/Cargo.toml --target "$rust_target"
artifacts="$base/artifacts/$commit"
mkdir -p "$artifacts/resource-monitor/linux-$arch"
cp "native/resource-monitor/target/$rust_target/release/t3-resource-monitor" "$artifacts/resource-monitor/linux-$arch/"
version="$(node -p 'require("./apps/server/package.json").version')"
node scripts/build-cli-archive.ts --platform linux --arch "$arch" --version "$version" --resource-monitor-dir "$artifacts/resource-monitor" --output-dir "$artifacts"
archive="$artifacts/t3-$version-linux-$arch.tar.gz"
node scripts/smoke-cli-archive.ts --archive "$archive" --expect-version "$version"
sha256sum "$archive" > "$archive.sha256"
mkdir "$release"
tar xzf "$archive" -C "$release" --strip-components=1
test -x "$release/t3"
printf '%s\n' "$commit" > "$release/SOURCE_COMMIT"
touch "$release/READY"
git show "$commit:pnpm-lock.yaml" > pnpm-lock.yaml
