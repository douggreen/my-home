#!/bin/bash
# Convert missing HEIC files to JPG previews
# Run from project root: ./scripts/convert_missing.sh

while IFS='|' read -r id path; do
  if [ ! -f ".cache/jpg-preview/$id.jpg" ]; then
    sips -s format jpeg "$path" --out ".cache/jpg-preview/$id.jpg" -Z 300 2>/dev/null
    echo "Converted $id"
  fi
done < /tmp/all_heic.txt

echo "Done!"
