#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <input_dir> [input_dir...]"
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required. Install it with: brew install ffmpeg"
  exit 1
fi

for input_dir in "$@"; do
  if [ ! -d "$input_dir" ]; then
    echo "Skipping, not a directory: $input_dir"
    continue
  fi

  dir_name="$(basename "${input_dir%/}")"
  output_name="./${dir_name}.mp3"
  list_file="./.${dir_name}-concat-list.txt"

  rm -f "$list_file"

  found=0

  while IFS= read -r file; do
    abs_file="$(cd "$(dirname "$file")" && pwd)/$(basename "$file")"
    escaped="${abs_file//\'/\'\\\'\'}"
    printf "file '%s'\n" "$escaped" >> "$list_file"
    found=1
  done < <(find "$input_dir" -maxdepth 1 -type f -name "*.mp3" | LC_ALL=C sort)

  if [ "$found" -eq 0 ]; then
    rm -f "$list_file"
    echo "Skipping, no .mp3 files found in: $input_dir"
    continue
  fi

  ffmpeg -hide_banner -y \
    -f concat \
    -safe 0 \
    -i "$list_file" \
    -vn \
    -c:a libmp3lame \
    -b:a 192k \
    "$output_name"

  rm -f "$list_file"

  echo "Created: $output_name"
done
