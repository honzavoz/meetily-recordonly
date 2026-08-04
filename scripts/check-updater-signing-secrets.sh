#!/usr/bin/env bash
set -euo pipefail

required_variables=(
  TAURI_SIGNING_PRIVATE_KEY
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD
)

missing_variables=()
for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    missing_variables+=("$variable_name")
  fi
done

if (( ${#missing_variables[@]} > 0 )); then
  printf 'Updater signing secrets are incomplete. Missing:\n' >&2
  printf '  %s\n' "${missing_variables[@]}" >&2
  exit 1
fi

echo "Updater signing preflight passed"
