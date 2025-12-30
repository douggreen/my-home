#!/bin/bash
# Convert all unlinked HEIC images to JPG for review
# Run from project root: ./scripts/convert_for_review.sh

OUTPUT_DIR="/tmp/review"

mkdir -p "$OUTPUT_DIR"

# Get all unlinked images
sqlite3 data/photos.db "SELECT id || '|' || current_path FROM images WHERE hidden = 0 AND filename LIKE '%.HEIC' AND id NOT IN (SELECT DISTINCT image_id FROM image_materials) ORDER BY id;" | while IFS='|' read id path; do
    outfile="$OUTPUT_DIR/${id}.jpg"
    if [ ! -f "$outfile" ]; then
        echo "Converting $id: $path"
        sips -s format jpeg "$path" --out "$outfile" -Z 800 2>/dev/null
    fi
done

echo "Done. Images are in $OUTPUT_DIR"
ls "$OUTPUT_DIR" | wc -l
