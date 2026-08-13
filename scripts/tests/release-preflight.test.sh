#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
version_script="$repo_root/scripts/check-version-consistency.sh"
signing_script="$repo_root/scripts/check-apple-signing-secrets.sh"
updater_signing_script="$repo_root/scripts/check-updater-signing-secrets.sh"
fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT

grep -Eq '^[[:space:]]*packages:' "$repo_root/frontend/pnpm-workspace.yaml" \
  || { echo "FAIL: frontend pnpm workspace must declare packages for pnpm 11" >&2; exit 1; }
grep -Fq 'Build with Tauri (unsigned app, signed updater)' "$repo_root/.github/workflows/build.yml" \
  || { echo "FAIL: unsigned updater build step is missing" >&2; exit 1; }
grep -Fq 'Validate updater private key' "$repo_root/.github/workflows/build.yml" \
  || { echo "FAIL: updater private key must be validated before compilation" >&2; exit 1; }
grep -Fq 'tauri signer sign' "$repo_root/.github/workflows/build.yml" \
  || { echo "FAIL: updater private key preflight must parse and use the key" >&2; exit 1; }
unsigned_tauri_block="$(sed -n '/Build with Tauri (unsigned app, signed updater)/,/Verify signed and notarized macOS app/p' "$repo_root/.github/workflows/build.yml")"
[[ "$unsigned_tauri_block" != *'APPLE_CERTIFICATE'* ]] \
  || { echo "FAIL: unsigned Tauri build must not receive Apple certificate variables" >&2; exit 1; }

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
grep -Fq 'bun test chrome-extension/tests' "$release_workflow" || fail "release does not run Chrome extension tests"
grep -Fq 'bun scripts/build-chrome-extension.ts' "$release_workflow" || fail "release does not build the Chrome extension"
grep -Fq 'node scripts/verify-chrome-extension.js chrome-extension/dist' "$release_workflow" || fail "release does not verify the Chrome extension package"
extension_check_line="$(grep -n 'Verify Chrome reminder extension' "$release_workflow" | head -1 | cut -d: -f1)"
draft_release_line="$(grep -n 'Find or Create Draft Release' "$release_workflow" | head -1 | cut -d: -f1)"
[[ -n "$extension_check_line" && -n "$draft_release_line" && "$extension_check_line" -lt "$draft_release_line" ]] \
  || fail "Chrome extension verification must run before draft release creation"
pass_count=$((pass_count + 1))
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
build_test_workflow="$repo_root/.github/workflows/build-test.yml"
asset_verifier="$repo_root/scripts/verify-updater-release-assets.js"
pubkey_extractor="$repo_root/scripts/extract-updater-public-key.js"
signature_decoder="$repo_root/scripts/decode-updater-signature.js"
grep -Fq 'uses: oven-sh/setup-bun@v2' "$build_workflow" || fail "shared build workflow does not install Bun required by beforeBuildCommand"
grep -Fq 'bun-version: 1.3.14' "$build_workflow" || fail "shared build workflow does not pin the expected Bun version"
grep -Fq "release.tag_name.startsWith('untagged-')" "$release_workflow" || fail "release verification does not normalize GitHub temporary draft tags"
grep -Fq 'release.name === releaseName' "$release_workflow" || fail "release retry does not safely recover its temporary untagged draft"
grep -Fq 'target_commitish: context.sha' "$release_workflow" || fail "release verification does not bind the draft to the verified commit"
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
crypto_verify_line="$(grep -n 'Cryptographically verify updater archive' "$release_workflow" | head -1 | cut -d: -f1)"
signature_decode_line="$(grep -n 'Decode updater minisign signature' "$release_workflow" | head -1 | cut -d: -f1)"
draft_false_line="$(grep -n 'draft: false' "$release_workflow" | tail -1 | cut -d: -f1)"
[[ -n "$updater_check_line" && -n "$draft_line" && "$updater_check_line" -lt "$draft_line" ]] || fail "updater secret preflight must run before draft creation"
[[ -n "$branch_gate_line" && -n "$updater_check_line" && "$branch_gate_line" -lt "$updater_check_line" ]] || fail "default branch gate must run before updater secrets are accessed"
[[ -n "$verify_line" && -n "$publish_line" && "$verify_line" -lt "$publish_line" ]] || fail "publishing must happen after asset verification"
[[ -n "$crypto_verify_line" && -n "$publish_line" && "$crypto_verify_line" -lt "$publish_line" ]] || fail "publishing must happen after cryptographic archive verification"
[[ -n "$crypto_verify_line" && -n "$draft_false_line" && "$crypto_verify_line" -lt "$draft_false_line" ]] || fail "draft:false must happen after cryptographic archive verification"
[[ -n "$signature_decode_line" && -n "$crypto_verify_line" && "$signature_decode_line" -lt "$crypto_verify_line" ]] || fail "signature base64 decode must happen before cryptographic verification"

grep -Fq 'TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}' "$release_workflow" || fail "release does not reference updater private key secret"
grep -Fq 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}' "$release_workflow" || fail "release does not reference updater password secret"
grep -Fq '.app.tar.gz.sig' "$asset_verifier" || fail "release does not require updater signature asset"
grep -Fq 'latest.json' "$asset_verifier" || fail "release does not require updater manifest"
grep -Fq '.dmg' "$asset_verifier" || fail "release does not require DMG asset"
grep -Fq '.app.tar.gz' "$asset_verifier" || fail "release does not require updater archive"
grep -Fq "manifest.version !== expectedVersion" "$asset_verifier" || fail "latest.json version is not validated"
grep -Fq "platforms['darwin-aarch64']" "$asset_verifier" || fail "latest.json canonical darwin-aarch64 platform is not validated"
grep -Fq "platforms['darwin-aarch64-app']" "$asset_verifier" || fail "latest.json darwin-aarch64-app alias is not validated when present"
grep -Fq 'entry.url !== expectedArchiveUrl' "$asset_verifier" || fail "latest.json updater URL is not validated exactly"
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
grep -A8 '^  create-release:' "$release_workflow" | grep -Fq 'environment: release' || fail "release creation is not protected by the release environment"
grep -Fq 'deployment-environment:' "$build_workflow" || fail "reusable build lacks deployment-environment input"
grep -A5 'deployment-environment:' "$build_workflow" | grep -Fq 'default: "ci"' || fail "normal reusable builds must default to the ci environment"
grep -Fq 'environment: ${{ inputs.deployment-environment }}' "$build_workflow" || fail "reusable build job does not use its selected environment"
grep -Fq 'deployment-environment: "release"' "$release_workflow" || fail "release build does not select the protected release environment"
release_build_block="$(sed -n '/^  build-macos-apple-silicon:/,/^  verify-and-publish:/p' "$release_workflow")"
[[ "$release_build_block" == *'TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}'* ]] \
  || fail "release caller must pass the encrypted updater private key"
[[ "$release_build_block" == *'TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}'* ]] \
  || fail "release caller must pass the encrypted updater password"
workflow_call_block="$(sed -n '/^  workflow_call:/,/^jobs:/p' "$build_workflow")"
[[ "$workflow_call_block" == *'TAURI_SIGNING_PRIVATE_KEY:'* ]] || fail "reusable workflow_call must declare the updater private key"
[[ "$workflow_call_block" == *'TAURI_SIGNING_PRIVATE_KEY_PASSWORD:'* ]] || fail "reusable workflow_call must declare the updater password"
if grep -Eq 'deployment-environment:.*release' "$build_test_workflow"; then
  fail "normal build-test must not gain access to the release environment"
fi
grep -Fq 'uses: ./.github/workflows/build.yml' "$build_test_workflow" || fail "normal build-test no longer exercises reusable build defaults"
[[ -x "$pubkey_extractor" ]] || fail "updater public key extractor is missing or not executable"
grep -Fq "config.plugins?.updater?.pubkey" "$pubkey_extractor" || fail "public key extractor does not read the exact Tauri updater pubkey"
grep -Fq 'verified.archive' "$release_workflow" || fail "workflow does not download the exact metadata-verified updater archive"
grep -Fq 'updater.app.tar.gz' "$release_workflow" || fail "workflow does not persist the updater archive for crypto verification"
grep -Fq 'extract-updater-public-key.js' "$release_workflow" || fail "workflow does not extract the configured updater public key"
grep -Fq 'apt-get install --no-install-recommends -y minisign' "$release_workflow" || fail "workflow does not install minisign from the pinned Ubuntu repository"
grep -Fq 'dpkg-query' "$release_workflow" || fail "workflow does not report the repository minisign version"
grep -Fq 'command -v minisign' "$release_workflow" || fail "workflow does not verify minisign tool availability"
grep -Fq 'minisign -Vm' "$release_workflow" || fail "workflow does not cryptographically verify the updater archive"
[[ -x "$signature_decoder" ]] || fail "updater signature decoder is missing or not executable"
grep -Fq 'decode-updater-signature.js' "$release_workflow" || fail "workflow does not decode the raw updater signature"
grep -Fq 'updater.app.tar.gz.minisig' "$release_workflow" || fail "workflow does not persist the decoded minisign signature"
grep -Fq -- '-x "$RUNNER_TEMP/updater-verification/updater.app.tar.gz.minisig"' "$release_workflow" || fail "minisign does not consume the decoded signature"
pass_count=$((pass_count + 1))

extracted_pubkey="$fixture_root/updater.pub"
"$pubkey_extractor" "$tauri_config" "$extracted_pubkey" >/dev/null
node -e '
  const fs = require("fs");
  const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const expected = Buffer.from(config.plugins.updater.pubkey, "base64");
  const actual = fs.readFileSync(process.argv[2]);
  if (!actual.equals(expected)) throw new Error("extracted updater public key differs from tauri.conf.json");
' "$tauri_config" "$extracted_pubkey"
pass_count=$((pass_count + 1))

if command -v ruby >/dev/null 2>&1; then
  ruby -e 'require "yaml"; ARGV.each { |path| YAML.parse_file(path) }' "$release_workflow" "$build_workflow" || fail "workflow YAML parsing failed"
  pass_count=$((pass_count + 1))
fi

echo "PASS: $pass_count release preflight scenarios"
