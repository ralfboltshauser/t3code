#!/bin/bash
set -euo pipefail
project_dir="$1"; repo="$2"; commit="$3"; destination="$4"; settings="$5"; hosts="$6"
mkdir -p "$project_dir/tooling"
node_version="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["engines"]["node"])' "$repo/package.json")"
export PATH="$project_dir/tooling/node-v$node_version-darwin-arm64/bin:$HOME/.local/share/vite-plus/bin:$HOME/.cargo/bin:$PATH"
if ! test -x "$project_dir/tooling/node-v$node_version-darwin-arm64/bin/node"; then
  cd "$project_dir/tooling"
  curl -fsSLO "https://nodejs.org/dist/v$node_version/node-v$node_version-darwin-arm64.tar.gz"
  curl -fsSL "https://nodejs.org/dist/v$node_version/SHASUMS256.txt" -o "SHASUMS256-$node_version.txt"
  awk -v name="node-v$node_version-darwin-arm64.tar.gz" '$2 == name' "SHASUMS256-$node_version.txt" | shasum -a 256 -c
  tar xf "node-v$node_version-darwin-arm64.tar.gz"
fi
test "$(node --version)" = "v$node_version"
identity="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["signing_identity"])' "$settings")"
test -n "$identity"
security find-identity -v -p codesigning | /usr/bin/grep -F "$identity" >/dev/null
cd "$repo"
version="$(node -p "require('./apps/server/package.json').version.split('-')[0]")-preview.$(date +%Y%m%d).$(date +%s)"
vp install --frozen-lockfile
node scripts/build-desktop-artifact.ts --platform mac --target dir --arch arm64 --build-version "$version" --output-dir "$destination/build"
app="$destination/T3 Code (Personal).app"
test ! -e "$app"
ditto "$destination/build/mac-arm64/T3 Code (Beta).app" "$app"
python3 - "$app/Contents/Info.plist" "$commit" "$settings" "$hosts" <<'PY'
import json,plistlib,sys
from pathlib import Path
path=Path(sys.argv[1]); value=plistlib.loads(path.read_bytes())
settings=json.load(open(sys.argv[3])); hosts=json.load(open(sys.argv[4]))
local=next(host for host in hosts['hosts'] if host['transport']=='local')
value['CFBundleIdentifier']=settings['bundle_id']
env=value.setdefault('LSEnvironment',{})
env.update(T3CODE_HOME=local['home'],T3CODE_DISABLE_AUTO_UPDATE='true')
for key in ['OPENAI_API_KEY','CODEX_API_KEY','OPENAI_BASE_URL','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY']:
 env[key]=''
path.write_bytes(plistlib.dumps(value))
(path.parent/'Resources/SOURCE_COMMIT').write_text(sys.argv[2]+'\n')
(path.parent/'Resources/MAINTENANCE_READY').write_text('staged\n')
PY
codesign --force --deep --timestamp=none --sign "$identity" "$app"
codesign --verify --deep --strict "$app"
git show "$commit:pnpm-lock.yaml" > pnpm-lock.yaml
