#!/usr/bin/env bash
set -euo pipefail

repo_root="${MEETILY_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
package_json="$repo_root/frontend/package.json"
tauri_json="$repo_root/frontend/src-tauri/tauri.conf.json"
cargo_toml="$repo_root/frontend/src-tauri/Cargo.toml"

for file in "$package_json" "$tauri_json" "$cargo_toml"; do
  [[ -f "$file" ]] || {
    echo "Version check failed: missing $file" >&2
    exit 1
  }
done

package_version="$(node -e 'const fs=require("fs"); process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).version)' "$package_json")"
tauri_version="$(node -e 'const fs=require("fs"); process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).version)' "$tauri_json")"
cargo_version="$(awk '
  /^\[package\][[:space:]]*$/ { in_package=1; next }
  /^\[/ && in_package { exit }
  in_package && /^[[:space:]]*version[[:space:]]*=/ {
    value=$0
    sub(/^[^=]*=[[:space:]]*"/, "", value)
    sub(/"[[:space:]]*$/, "", value)
    print value
    exit
  }
' "$cargo_toml")"

if [[ -z "$package_version" || -z "$tauri_version" || -z "$cargo_version" ]]; then
  echo "Version check failed: one or more version values could not be read" >&2
  exit 1
fi

versions_match=true
[[ "$package_version" == "$tauri_version" ]] || versions_match=false
[[ "$package_version" == "$cargo_version" ]] || versions_match=false

if [[ "$versions_match" != true ]]; then
  echo "Version mismatch:" >&2
  echo "  package.json: $package_version" >&2
  echo "  tauri.conf.json: $tauri_version" >&2
  echo "  Cargo.toml: $cargo_version" >&2
  exit 1
fi

echo "Version consistency check passed: $package_version"
