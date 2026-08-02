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

complete_output="$(
  APPLE_CERTIFICATE=certificate \
  APPLE_CERTIFICATE_PASSWORD=password \
  APPLE_ID=developer@example.com \
  APPLE_PASSWORD=app-password \
  APPLE_TEAM_ID=TEAM123 \
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
  "$signing_script" 2>&1
)"
missing_status=$?
set -e
[[ $missing_status -ne 0 ]] || fail "missing Apple credentials unexpectedly passed"
assert_contains "$missing_output" "Apple signing credentials are incomplete"
assert_contains "$missing_output" "APPLE_CERTIFICATE_PASSWORD"
assert_contains "$missing_output" "APPLE_PASSWORD"
[[ "$missing_output" != *"certificate"* ]] || fail "secret value leaked into output"
[[ "$missing_output" != *"app-password"* ]] || fail "secret value leaked into output"
pass_count=$((pass_count + 1))

echo "PASS: $pass_count release preflight scenarios"
