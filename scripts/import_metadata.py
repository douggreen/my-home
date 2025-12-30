#!/usr/bin/env python3
"""
Import metadata from Google Takeout JSON files and embedded EXIF into SQLite.
"""

import sqlite3
import json
import hashlib
import subprocess
import os
from pathlib import Path
from datetime import datetime
import re

DB_PATH = Path(__file__).parent.parent / "data" / "photos.db"
MEDIA_DIR = Path(__file__).parent.parent / "data" / "images"

# File extensions to process
MEDIA_EXTENSIONS = {'.heic', '.jpg', '.jpeg', '.png', '.mov', '.mp4', '.webp'}


def compute_file_hash(filepath: Path, chunk_size: int = 8192) -> str:
    """Compute MD5 hash of a file."""
    hasher = hashlib.md5()
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(chunk_size), b''):
            hasher.update(chunk)
    return hasher.hexdigest()


def parse_mdls_output(output: str) -> dict:
    """Parse macOS mdls output into a dictionary."""
    result = {}
    for line in output.strip().split('\n'):
        if ' = ' in line:
            key, value = line.split(' = ', 1)
            key = key.strip()
            value = value.strip()

            # Handle null values
            if value == '(null)':
                continue

            # Handle quoted strings
            if value.startswith('"') and value.endswith('"'):
                value = value[1:-1]

            # Handle numbers
            elif re.match(r'^-?\d+\.?\d*(?:e[+-]?\d+)?$', value):
                try:
                    value = float(value) if '.' in value or 'e' in value.lower() else int(value)
                except ValueError:
                    pass

            result[key] = value

    return result


def get_exif_via_mdls(filepath: Path) -> dict:
    """Extract EXIF metadata using macOS mdls command."""
    try:
        result = subprocess.run(
            ['mdls', str(filepath)],
            capture_output=True,
            text=True,
            timeout=30
        )
        if result.returncode == 0:
            return parse_mdls_output(result.stdout)
    except (subprocess.TimeoutExpired, Exception) as e:
        print(f"  Warning: mdls failed for {filepath.name}: {e}")
    return {}


def load_google_json(json_path: Path) -> dict:
    """Load Google Photos supplemental metadata JSON."""
    try:
        with open(json_path, 'r') as f:
            return json.load(f)
    except (json.JSONDecodeError, FileNotFoundError) as e:
        print(f"  Warning: Could not load {json_path.name}: {e}")
        return {}


def find_json_for_media(media_path: Path) -> Path | None:
    """Find the corresponding JSON metadata file for a media file."""
    # Standard pattern: IMG_1234.HEIC.supplemental-metadata.json
    json_path = media_path.parent / f"{media_path.name}.supplemental-metadata.json"
    if json_path.exists():
        return json_path
    return None


def timestamp_to_datetime(ts: str | int) -> str | None:
    """Convert Unix timestamp to ISO datetime string."""
    try:
        ts = int(ts)
        return datetime.utcfromtimestamp(ts).strftime('%Y-%m-%d %H:%M:%S')
    except (ValueError, TypeError, OSError):
        return None


def import_media_file(conn: sqlite3.Connection, media_path: Path) -> bool:
    """Import a single media file's metadata into the database."""
    cursor = conn.cursor()

    # Check if already imported
    cursor.execute("SELECT id FROM images WHERE current_path = ?", (str(media_path),))
    if cursor.fetchone():
        return False  # Already exists

    # Compute file hash
    file_hash = compute_file_hash(media_path)

    # Load Google Photos JSON metadata
    json_path = find_json_for_media(media_path)
    google_meta = load_google_json(json_path) if json_path else {}

    # Get EXIF via mdls
    exif = get_exif_via_mdls(media_path)

    # Extract Google Photos fields
    photo_taken_at = None
    if 'photoTakenTime' in google_meta:
        photo_taken_at = timestamp_to_datetime(google_meta['photoTakenTime'].get('timestamp'))

    uploaded_at = None
    if 'creationTime' in google_meta:
        uploaded_at = timestamp_to_datetime(google_meta['creationTime'].get('timestamp'))

    # Prefer Google geo data, fall back to EXIF
    latitude = None
    longitude = None
    altitude = None
    if 'geoData' in google_meta:
        geo = google_meta['geoData']
        latitude = geo.get('latitude')
        longitude = geo.get('longitude')
        altitude = geo.get('altitude')

    if latitude is None or latitude == 0:
        latitude = exif.get('kMDItemLatitude')
        longitude = exif.get('kMDItemLongitude')
        altitude = exif.get('kMDItemAltitude')

    # Build insert data
    data = {
        'filename': media_path.name,
        'current_path': str(media_path),
        'file_hash': file_hash,
        'google_photos_url': google_meta.get('url'),
        'google_views': int(google_meta.get('imageViews', 0)) if google_meta.get('imageViews') else None,
        'photo_taken_at': photo_taken_at,
        'uploaded_at': uploaded_at,
        'latitude': latitude,
        'longitude': longitude,
        'altitude': altitude,
        'device_make': exif.get('kMDItemAcquisitionMake'),
        'device_model': exif.get('kMDItemAcquisitionModel'),
        'ios_version': exif.get('kMDItemCreator'),
        'focal_length': exif.get('kMDItemFocalLength'),
        'focal_length_35mm': exif.get('kMDItemFocalLength35mm'),
        'aperture': exif.get('kMDItemFNumber'),
        'exposure_time': exif.get('kMDItemExposureTimeSeconds'),
        'iso': exif.get('kMDItemISOSpeed'),
        'image_direction': exif.get('kMDItemImageDirection'),
        'width': exif.get('kMDItemPixelWidth'),
        'height': exif.get('kMDItemPixelHeight'),
    }

    # Insert into database
    columns = ', '.join(data.keys())
    placeholders = ', '.join(['?' for _ in data])

    cursor.execute(
        f"INSERT INTO images ({columns}) VALUES ({placeholders})",
        list(data.values())
    )

    return True


def main():
    """Main import function."""
    print(f"Opening database: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)

    # Find all media files
    media_files = []
    for ext in MEDIA_EXTENSIONS:
        media_files.extend(MEDIA_DIR.glob(f"*{ext}"))
        media_files.extend(MEDIA_DIR.glob(f"*{ext.upper()}"))

    # Remove duplicates and sort
    media_files = sorted(set(media_files))

    print(f"Found {len(media_files)} media files to process")

    imported = 0
    skipped = 0

    for i, media_path in enumerate(media_files, 1):
        if i % 50 == 0 or i == len(media_files):
            print(f"Processing {i}/{len(media_files)}...")

        try:
            if import_media_file(conn, media_path):
                imported += 1
            else:
                skipped += 1
        except Exception as e:
            print(f"  Error processing {media_path.name}: {e}")

    conn.commit()
    conn.close()

    print(f"\nDone!")
    print(f"  Imported: {imported}")
    print(f"  Skipped (already exists): {skipped}")
    print(f"  Total in database: {imported + skipped}")


if __name__ == '__main__':
    main()
