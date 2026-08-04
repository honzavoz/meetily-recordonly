#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
version_script="$repo_root/scripts/check-version-consistency.sh"
signing_script="$repo_root/scripts/check-apple-signing-secrets.sh"
updater_signing_script="$repo_root/scripts/check-updater-signing-secrets.sh"
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

updater_complete_output="$(
  TAURI_SIGNING_PRIVATE_KEY='private-key-secret-value' \
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD='private-key-password-secret-value' \
  "$updater_signing_script"
)"
assert_contains "$updater_complete_output" "Updater signing preflight passed"
[[ "$updater_complete_output" != *"private-key-secret-value"* ]] || fail "updater private key leaked into output"
[[ "$updater_complete_output" != *"private-key-password-secret-value"* ]] || fail "updater private key password leaked into output"
pass_count=$((pass_count + 1))

set +e
missing_updater_key_output="$(
  TAURI_SIGNING_PRIVATE_KEY='' \
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD='private-key-password-secret-value' \
  "$updater_signing_script" 2>&1
)"
missing_updater_key_status=$?
set -e
[[ $missing_updater_key_status -ne 0 ]] || fail "missing updater private key unexpectedly passed"
assert_contains "$missing_updater_key_output" "TAURI_SIGNING_PRIVATE_KEY"
[[ "$missing_updater_key_output" != *"TAURI_SIGNING_PRIVATE_KEY_PASSWORD"* ]] || fail "present updater password was reported missing"
[[ "$missing_updater_key_output" != *"private-key-password-secret-value"* ]] || fail "updater password leaked into output"
pass_count=$((pass_count + 1))

set +e
missing_updater_password_output="$(
  TAURI_SIGNING_PRIVATE_KEY='private-key-secret-value' \
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD='' \
  "$updater_signing_script" 2>&1
)"
missing_updater_password_status=$?
set -e
[[ $missing_updater_password_status -ne 0 ]] || fail "missing updater private key password unexpectedly passed"
assert_contains "$missing_updater_password_output" "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"
[[ "$missing_updater_password_output" != *"private-key-secret-value"* ]] || fail "updater private key leaked into output"
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

build_workflow="$repo_root/.github/workflows/build.yml"
asset_verifier="$repo_root/scripts/verify-updater-release-assets.js"
grep -Fq 'TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}' "$build_workflow" || fail "build does not pass updater private key to Tauri"
grep -Fq 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}' "$build_workflow" || fail "build does not pass updater private key password to Tauri"
grep -Fq "if: contains(inputs.platform, 'macos') && inputs.sign-binaries" "$build_workflow" || fail "Apple signing is not conditional on sign-binaries"

grep -Fq 'platform: "macos-14"' "$release_workflow" || fail "release is not pinned to a macOS Apple Silicon runner"
grep -Fq 'target: "aarch64-apple-darwin"' "$release_workflow" || fail "release target is not Apple Silicon"
grep -Fq 'build-args: "--target aarch64-apple-darwin"' "$release_workflow" || fail "release build args are not Apple Silicon"
grep -Fq 'sign-binaries: false' "$release_workflow" || fail "release must not Apple-codesign binaries"
if grep -qE 'matrix:|windows-latest|x86_64-pc-windows-msvc' "$release_workflow"; then
  fail "release workflow still contains a matrix or Windows build"
fi
if grep -q 'check-apple-signing-secrets.sh' "$release_workflow"; then
  fail "release workflow still unconditionally checks Apple signing credentials"
fi

updater_check_line="$(grep -n 'check-updater-signing-secrets.sh' "$release_workflow" | head -1 | cut -d: -f1)"
branch_gate_line="$(grep -n 'Require default branch release' "$release_workflow" | head -1 | cut -d: -f1)"
draft_line="$(grep -n 'Create Draft Release' "$release_workflow" | head -1 | cut -d: -f1)"
verify_line="$(grep -n 'Verify draft release assets' "$release_workflow" | head -1 | cut -d: -f1)"
publish_line="$(grep -n 'Publish verified release' "$release_workflow" | head -1 | cut -d: -f1)"
[[ -n "$updater_check_line" && -n "$draft_line" && "$updater_check_line" -lt "$draft_line" ]] || fail "updater secret preflight must run before draft creation"
[[ -n "$branch_gate_line" && -n "$updater_check_line" && "$branch_gate_line" -lt "$updater_check_line" ]] || fail "default branch gate must run before updater secrets are accessed"
[[ -n "$verify_line" && -n "$publish_line" && "$verify_line" -lt "$publish_line" ]] || fail "publishing must happen after asset verification"

grep -Fq 'TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}' "$release_workflow" || fail "release does not reference updater private key secret"
grep -Fq 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}' "$release_workflow" || fail "release does not reference updater password secret"
grep -Fq '.app.tar.gz.sig' "$asset_verifier" || fail "release does not require updater signature asset"
grep -Fq 'latest.json' "$asset_verifier" || fail "release does not require updater manifest"
grep -Fq '.dmg' "$asset_verifier" || fail "release does not require DMG asset"
grep -Fq '.app.tar.gz' "$asset_verifier" || fail "release does not require updater archive"
grep -Fq "manifest.version !== expectedVersion" "$asset_verifier" || fail "latest.json version is not validated"
grep -Fq "normalized.includes('darwin')" "$asset_verifier" || fail "latest.json Darwin platform is not validated"
grep -Fq "normalized.includes('aarch64')" "$asset_verifier" || fail "latest.json aarch64 platform is not validated"
grep -Fq 'platform.url !== archive.browser_download_url' "$asset_verifier" || fail "latest.json updater URL is not validated exactly"
grep -Fq 'github.rest.repos.updateRelease' "$release_workflow" || fail "verified draft is not published"
grep -Fq 'draft: false' "$release_workflow" || fail "release publish does not clear draft flag"
grep -Fq 'github.ref_name' "$release_workflow" || fail "release does not gate execution to the default branch"
grep -Fq 'github.event.repository.default_branch' "$release_workflow" || fail "release does not use the repository default branch"
grep -Fq 'target_commitish: context.sha' "$release_workflow" || fail "release tag is not pinned to the dispatched SHA"
grep -Fq 'source-ref: ${{ github.sha }}' "$release_workflow" || fail "release build checkout is not pinned to the dispatched SHA"
grep -Fq 'source-ref:' "$build_workflow" || fail "reusable build has no source-ref input"
grep -Fq 'ref: ${{ inputs.source-ref }}' "$build_workflow" || fail "reusable build does not checkout source-ref"
if grep -q 'secrets: inherit' "$release_workflow"; then
  fail "release passes more secrets than required to reusable build"
fi
grep -Fq 'TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}' "$release_workflow" || fail "release does not explicitly map updater private key"
grep -Fq 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}' "$release_workflow" || fail "release does not explicitly map updater password"
grep -Fq 'github.rest.repos.listReleases' "$release_workflow" || fail "release does not look up an existing draft"
grep -Fq 'github.rest.repos.deleteReleaseAsset' "$release_workflow" || fail "release retry does not clear stale draft assets"
grep -Fq 'if (!matchingRelease.draft)' "$release_workflow" || fail "release may reuse a non-draft release"
grep -Fq 'target_commitish: context.sha' "$release_workflow" || fail "reused draft is not pinned to the dispatched SHA"
grep -Fq "require('./scripts/verify-updater-release-assets.js')" "$release_workflow" || fail "workflow does not run the executable asset verifier"
grep -Fq 'release.tag_name !== expectedTag' "$release_workflow" || fail "draft release tag is not verified before publish"
pass_count=$((pass_count + 1))

if command -v ruby >/dev/null 2>&1; then
  ruby -e 'require "yaml"; ARGV.each { |path| YAML.parse_file(path) }' "$release_workflow" "$build_workflow" || fail "workflow YAML parsing failed"
  pass_count=$((pass_count + 1))
fi

echo "PASS: $pass_count release preflight scenarios"
