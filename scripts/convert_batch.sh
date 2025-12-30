#!/bin/bash
# Run from project root: ./scripts/convert_batch.sh
sqlite3 data/photos.db "SELECT id || '|' || current_path FROM images WHERE current_path LIKE 'home/%.HEIC' AND id NOT IN (SELECT DISTINCT image_id FROM image_materials) ORDER BY id;" | while IFS='|' read id path; do
  if [ ! -f ".cache/jpg-preview/$id.jpg" ]; then
    sips -s format jpeg "$path" --out ".cache/jpg-preview/$id.jpg" -Z 300 2>/dev/null
    echo "Converted $id"
  fi
done
