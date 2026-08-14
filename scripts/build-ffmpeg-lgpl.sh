#!/bin/bash

set -euo pipefail

repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
target=${1:-}
ffmpeg_version=$(tr -d '[:space:]' < "$repository_root/third-party/ffmpeg/VERSION.txt")
source_archive="ffmpeg-${ffmpeg_version}.tar.xz"
source_signature="${source_archive}.asc"
expected_sha256=$(awk -v archive="$source_archive" '$2 == archive { print $1 }' "$repository_root/third-party/ffmpeg/SHA256SUMS")
source_url="https://ffmpeg.org/releases/${source_archive}"
signature_url="${source_url}.asc"
signing_key="$repository_root/third-party/ffmpeg/ffmpeg-devel.asc"
expected_signing_fingerprint="FCF986EA15E6E293A5644F10B4322F04D67658D8"
cache_root=${RECORD_ONLY_FFMPEG_CACHE_DIR:-${TMPDIR:-/tmp}/record-only-ffmpeg-cache}
archive_path="$cache_root/$source_archive"
signature_path="$cache_root/$source_signature"
output_directory="$repository_root/frontend/src-tauri/binaries"
provenance_directory="$repository_root/artifacts/ffmpeg-source"
binary_path="$output_directory/ffmpeg-$target"
install_prefix="/opt/record-only/ffmpeg-$ffmpeg_version"
work_directory=$(mktemp -d "${TMPDIR:-/tmp}/record-only-ffmpeg-build.XXXXXX")

cleanup() {
  rm -rf "$work_directory"
}
trap cleanup EXIT

if [[ -z "$target" ]]; then
  echo "Usage: scripts/build-ffmpeg-lgpl.sh <target-triple>" >&2
  exit 2
fi

case "$target" in
  aarch64-apple-darwin)
    expected_host_arch=arm64
    configure_arch=arm64
    ;;
  x86_64-apple-darwin)
    expected_host_arch=x86_64
    configure_arch=x86_64
    ;;
  *)
    echo "No reviewed reproducible FFmpeg build is available for target: $target" >&2
    exit 2
    ;;
esac

host_arch=$(uname -m)
if [[ "$host_arch" != "$expected_host_arch" ]]; then
  echo "FFmpeg target $target requires host architecture $expected_host_arch; current host is $host_arch" >&2
  exit 2
fi

if [[ -z "$expected_sha256" ]]; then
  echo "Missing pinned SHA-256 for $source_archive" >&2
  exit 2
fi

mkdir -p "$cache_root" "$output_directory" "$provenance_directory"

verify_source_authenticity() {
  local archive=$1
  local signature=$2
  local gnupg_home="$work_directory/gnupg"
  local verification_keyring="$work_directory/ffmpeg-signing-key.gpg"

  if ! command -v gpg >/dev/null 2>&1; then
    echo "GnuPG is required to verify the official FFmpeg release signature" >&2
    return 1
  fi

  mkdir -m 0700 -p "$gnupg_home"
  local key_listing
  local actual_fingerprint
  key_listing=$(gpg --batch --no-options --homedir "$gnupg_home" --with-colons \
    --import-options show-only --import "$signing_key")
  actual_fingerprint=$(printf '%s\n' "$key_listing" | awk -F: '$1 == "fpr" { print $10; exit }')
  if [[ "$actual_fingerprint" != "$expected_signing_fingerprint" ]]; then
    echo "FFmpeg signing key fingerprint mismatch: expected $expected_signing_fingerprint, got $actual_fingerprint" >&2
    return 1
  fi

  gpg --batch --yes --no-options --dearmor --output "$verification_keyring" "$signing_key"
  gpgv --homedir "$gnupg_home" --keyring "$verification_keyring" "$signature" "$archive"
}

required_provenance=(
  "$provenance_directory/$source_archive"
  "$provenance_directory/$source_signature"
  "$provenance_directory/COPYING.LGPLv2.1"
  "$provenance_directory/SHA256SUMS"
  "$provenance_directory/BUILD_CONFIGURATION.txt"
  "$provenance_directory/FFMPEG_VERSION.txt"
  "$provenance_directory/FFMPEG_BUILDCONF.txt"
  "$provenance_directory/FFMPEG_LICENSE_OUTPUT.txt"
)

provenance_complete=true
for provenance_file in "${required_provenance[@]}"; do
  if [[ ! -f "$provenance_file" ]]; then
    provenance_complete=false
    break
  fi
done

if [[ -x "$binary_path" && "$provenance_complete" == true ]]; then
  cached_sha256=$(shasum -a 256 "$provenance_directory/$source_archive" | awk '{ print $1 }')
  if [[ "$cached_sha256" == "$expected_sha256" ]] \
    && verify_source_authenticity "$provenance_directory/$source_archive" "$provenance_directory/$source_signature" \
    && grep -Fq -- "--prefix=$install_prefix" "$provenance_directory/BUILD_CONFIGURATION.txt" \
    && node "$repository_root/scripts/verify-ffmpeg-license.js" "$binary_path"; then
    echo "Reusing reviewed LGPL FFmpeg $ffmpeg_version for $target"
    exit 0
  fi
fi

download_if_missing() {
  local url=$1
  local destination=$2
  if [[ ! -f "$destination" ]]; then
    curl -fL --retry 3 --proto '=https' --tlsv1.2 "$url" -o "$destination"
  fi
}

download_if_missing "$source_url" "$archive_path"
download_if_missing "$signature_url" "$signature_path"

actual_sha256=$(shasum -a 256 "$archive_path" | awk '{ print $1 }')
if [[ "$actual_sha256" != "$expected_sha256" ]]; then
  echo "FFmpeg source checksum mismatch: expected $expected_sha256, got $actual_sha256" >&2
  exit 1
fi

verify_source_authenticity "$archive_path" "$signature_path"

tar -xJf "$archive_path" -C "$work_directory"
source_directory="$work_directory/ffmpeg-$ffmpeg_version"

configure_args=(
  "--prefix=$install_prefix"
  "--arch=$configure_arch"
  --disable-gpl
  --disable-nonfree
  --disable-autodetect
  --disable-doc
  --disable-debug
  --disable-ffplay
  --disable-ffprobe
  --enable-ffmpeg
  --enable-static
  --disable-shared
)

build_jobs=2
if command -v getconf >/dev/null 2>&1; then
  detected_jobs=$(getconf _NPROCESSORS_ONLN 2>/dev/null || true)
  if [[ "$detected_jobs" =~ ^[1-9][0-9]*$ ]]; then
    build_jobs=$detected_jobs
  fi
fi

(
  cd "$source_directory"
  ./configure "${configure_args[@]}"
  make -j "$build_jobs" ffmpeg
)

cp "$source_directory/ffmpeg" "$binary_path"
chmod 0755 "$binary_path"

cp "$archive_path" "$provenance_directory/$source_archive"
cp "$signature_path" "$provenance_directory/$source_signature"
cp "$source_directory/COPYING.LGPLv2.1" "$provenance_directory/COPYING.LGPLv2.1"
cp "$repository_root/third-party/ffmpeg/SHA256SUMS" "$provenance_directory/SHA256SUMS"

{
  printf './configure'
  printf ' %q' "${configure_args[@]}"
  printf '\n'
} > "$provenance_directory/BUILD_CONFIGURATION.txt"

"$binary_path" -hide_banner -version > "$provenance_directory/FFMPEG_VERSION.txt" 2>&1
"$binary_path" -hide_banner -buildconf > "$provenance_directory/FFMPEG_BUILDCONF.txt" 2>&1
"$binary_path" -hide_banner -L > "$provenance_directory/FFMPEG_LICENSE_OUTPUT.txt" 2>&1

node "$repository_root/scripts/verify-ffmpeg-license.js" "$binary_path"
echo "Built reviewed LGPL FFmpeg $ffmpeg_version for $target"
