#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
version_script="$repo_root/scripts/check-version-consistency.sh"
signing_script="$repo_root/scripts/check-apple-signing-secrets.sh"
fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT

pass_count=0

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  local value="$1"
  local expected="$2"
  [[ "$value" == *"$expected"* ]] || fail "expected output to contain '$expected', got: $value"
}

make_version_fixture() {
  local package_version="$1"
  local tauri_version="$2"
  local cargo_version="$3"

  mkdir -p "$fixture_root/frontend/src-tauri"
  printf '{"version":"%s"}\n' "$package_version" > "$fixture_root/frontend/package.json"
  printf '{"version":"%s"}\n' "$tauri_version" > "$fixture_root/frontend/src-tauri/tauri.conf.json"
  printf '[package]\nname = "fixture"\nversion = "%s"\n' "$cargo_version" > "$fixture_root/frontend/src-tauri/Cargo.toml"
}

make_version_fixture "0.4.1" "0.4.1" "0.4.1"
matching_output="$(MEETILY_REPO_ROOT="$fixture_root" "$version_script")"
assert_contains "$matching_output" "Version consistency check passed: 0.4.1"
pass_count=$((pass_count + 1))

make_version_fixture "0.4.1" "0.4.2" "0.4.1"
set +e
mismatch_output="$(MEETILY_REPO_ROOT="$fixture_root" "$version_script" 2>&1)"
mismatch_status=$?
set -e
[[ $mismatch_status -ne 0 ]] || fail "mismatched versions unexpectedly passed"
assert_contains "$mismatch_output" "Version mismatch"
assert_contains "$mismatch_output" "tauri.conf.json: 0.4.2"
pass_count=$((pass_count + 1))

tauri_config="$repo_root/frontend/src-tauri/tauri.conf.json"
node -e '
  const fs = require("fs");
  const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (config.bundle?.createUpdaterArtifacts !== true) {
    throw new Error("bundle.createUpdaterArtifacts must be true");
  }
  const expected = "https://github.com/honzavoz/meetily-recordonly/releases/latest/download/latest.json";
  if (!Array.isArray(config.plugins?.updater?.endpoints) || !config.plugins.updater.endpoints.includes(expected)) {
    throw new Error("GitHub latest.json updater endpoint is missing");
  }
  if (typeof config.plugins?.updater?.pubkey !== "string" || config.plugins.updater.pubkey.trim() === "") {
    throw new Error("updater public key is missing");
  }
' "$tauri_config"
pass_count=$((pass_count + 1))

complete_output="$(
  APPLE_CERTIFICATE=certificate \
  APPLE_CERTIFICATE_PASSWORD=password \
  APPLE_ID=developer@example.com \
  APPLE_PASSWORD=app-password \
  APPLE_TEAM_ID=TEAM123 \
  KEYCHAIN_PASSWORD=keychain-password \
  "$signing_script"
)"
assert_contains "$complete_output" "Apple signing preflight passed"
pass_count=$((pass_count + 1))

set +e
missing_output="$(
  APPLE_CERTIFICATE=certificate \
  APPLE_CERTIFICATE_PASSWORD='' \
  APPLE_ID=developer@example.com \
  APPLE_PASSWORD='' \
  APPLE_TEAM_ID=TEAM123 \
  KEYCHAIN_PASSWORD='' \
  "$signing_script" 2>&1
)"
missing_status=$?
set -e
[[ $missing_status -ne 0 ]] || fail "missing Apple credentials unexpectedly passed"
assert_contains "$missing_output" "Apple signing credentials are incomplete"
assert_contains "$missing_output" "APPLE_CERTIFICATE_PASSWORD"
assert_contains "$missing_output" "APPLE_PASSWORD"
assert_contains "$missing_output" "KEYCHAIN_PASSWORD"
[[ "$missing_output" != *"certificate"* ]] || fail "secret value leaked into output"
[[ "$missing_output" != *"app-password"* ]] || fail "secret value leaked into output"
pass_count=$((pass_count + 1))

legacy_workflow_refs="$(
  grep -R -n -E \
    'actions/(checkout|setup-node|upload-artifact)@v4|actions/cache@v4|pnpm/action-setup@v4|node-version:[[:space:]]*['"'"']?20['"'"']?' \
    "$repo_root/.github/workflows"/*.yml 2>/dev/null || true
)"
[[ -z "$legacy_workflow_refs" ]] || fail "deprecated Node 20 workflow actions remain:\n$legacy_workflow_refs"
pass_count=$((pass_count + 1))

macos_workflow="$repo_root/.github/workflows/build-macos.yml"
release_workflow="$repo_root/.github/workflows/release.yml"
grep -A5 'sign-build:' "$macos_workflow" | grep -q 'default: false' || fail "macOS sign-build must default to false"
grep -q 'Validate Apple signing credentials' "$macos_workflow" || fail "macOS signing preflight step is missing"
grep -q 'signed-notarized' "$macos_workflow" || fail "signed artifact label is missing"
grep -q 'unsigned' "$macos_workflow" || fail "unsigned artifact label is missing"
grep -qi 'version consistency' "$release_workflow" || fail "release version consistency check is missing"
grep -Fq '^[0-9]+\.[0-9]+\.[0-9]+$' "$release_workflow" || fail "strict X.Y.Z release validation is missing"
if grep -qE 'seq 1 100|LATEST_MINOR|NEXT_MINOR' "$release_workflow"; then
  fail "legacy four-component release fallback remains"
fi
pass_count=$((pass_count + 1))

echo "PASS: $pass_count release preflight scenarios"
