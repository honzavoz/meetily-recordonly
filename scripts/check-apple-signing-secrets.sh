#!/usr/bin/env bash
set -euo pipefail

required_variables=(
  APPLE_CERTIFICATE
  APPLE_CERTIFICATE_PASSWORD
  APPLE_ID
  APPLE_PASSWORD
  APPLE_TEAM_ID
)
missing_variables=()

for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name-}" ]]; then
    missing_variables+=("$variable_name")
  fi
done

if (( ${#missing_variables[@]} > 0 )); then
  echo "Apple signing credentials are incomplete." >&2
  echo "Missing GitHub secrets/environment variables:" >&2
  printf '  - %s\n' "${missing_variables[@]}" >&2
  echo "Signed/notarized builds require an active Apple Developer account and all values above." >&2
  exit 1
fi

echo "Apple signing preflight passed"
