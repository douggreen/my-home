#!/usr/bin/env python3
"""
Prepare web-ready versions of all images and videos.

Creates optimized versions in data/web-images/:
  - full/{id}.jpg    - Full-size images (max 1600px)
  - thumb/{id}.jpg   - Thumbnails (300px)
  - video/{id}.mp4   - Streaming-ready videos (H.264 + faststart)

Usage:
  python scripts/prepare_web_images.py          # Process all
  python scripts/prepare_web_images.py 123      # Process single ID
  python scripts/prepare_web_images.py --force  # Reprocess existing
"""

import os
import sys
import sqlite3
import subprocess
import shutil
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# Configuration
PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data"
DB_PATH = DATA_DIR / "photos.db"
SOURCE_DIR = DATA_DIR / "images"
WEB_DIR = DATA_DIR / "web-images"

FULL_DIR = WEB_DIR / "full"
THUMB_DIR = WEB_DIR / "thumb"
VIDEO_DIR = WEB_DIR / "video"

# Size limits
FULL_MAX_SIZE = 1600  # Max dimension for full-size images
THUMB_SIZE = 300      # Thumbnail size
VIDEO_MAX_HEIGHT = 1080  # Max video height

# File type detection
IMAGE_EXTENSIONS = {'.heic', '.jpg', '.jpeg', '.png'}
VIDEO_EXTENSIONS = {'.mov', '.mp4', '.m4v'}


def get_db():
    """Get database connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_dirs():
    """Create output directories."""
    for d in [FULL_DIR, THUMB_DIR, VIDEO_DIR]:
        d.mkdir(parents=True, exist_ok=True)


def get_source_path(row):
    """Get the source file path for an image record."""
    current_path = row['current_path']

    # Handle both absolute and relative paths
    if current_path.startswith('/'):
        source = Path(current_path)
    else:
        source = DATA_DIR / current_path

    return source


def is_video(filename):
    """Check if file is a video based on extension."""
    return Path(filename).suffix.lower() in VIDEO_EXTENSIONS


def process_image(row, force=False):
    """Process a single image file."""
    id = row['id']
    source = get_source_path(row)

    full_out = FULL_DIR / f"{id}.jpg"
    thumb_out = THUMB_DIR / f"{id}.jpg"

    # Skip if already exists (unless force)
    if not force and full_out.exists() and thumb_out.exists():
        return {'id': id, 'status': 'skipped', 'reason': 'exists'}

    if not source.exists():
        return {'id': id, 'status': 'error', 'reason': f'source not found: {source}'}

    try:
        is_heic = str(source).lower().endswith('.heic')

        if is_heic:
            # Use sips for HEIC (ffmpeg can't decode full resolution)
            subprocess.run([
                'sips', '-s', 'format', 'jpeg',
                '-Z', str(FULL_MAX_SIZE),
                str(source), '--out', str(full_out)
            ], capture_output=True, check=True)

            # Thumbnail - resize to max dimension
            subprocess.run([
                'sips', '-s', 'format', 'jpeg',
                '-Z', str(THUMB_SIZE),
                str(source), '--out', str(thumb_out)
            ], capture_output=True, check=True)
        else:
            # Use ffmpeg for other formats (JPG, PNG, etc.)
            subprocess.run([
                'ffmpeg', '-y',
                '-i', str(source),
                '-vf', f"scale='min({FULL_MAX_SIZE},iw)':'min({FULL_MAX_SIZE},ih)':force_original_aspect_ratio=decrease",
                '-q:v', '2',  # High quality JPEG
                str(full_out)
            ], capture_output=True, check=True)

            # Create thumbnail
            subprocess.run([
                'ffmpeg', '-y',
                '-i', str(source),
                '-vf', f"scale='min({THUMB_SIZE},iw)':'min({THUMB_SIZE},ih)':force_original_aspect_ratio=decrease",
                '-q:v', '3',  # Slightly lower quality for thumbs
                str(thumb_out)
            ], capture_output=True, check=True)

        return {'id': id, 'status': 'ok', 'type': 'image'}

    except subprocess.CalledProcessError as e:
        return {'id': id, 'status': 'error', 'reason': e.stderr.decode() if e.stderr else str(e)}


def process_video(row, force=False):
    """Process a single video file."""
    id = row['id']
    source = get_source_path(row)

    video_out = VIDEO_DIR / f"{id}.mp4"
    thumb_out = THUMB_DIR / f"{id}.jpg"

    # Skip if already exists (unless force)
    if not force and video_out.exists() and thumb_out.exists():
        return {'id': id, 'status': 'skipped', 'reason': 'exists'}

    if not source.exists():
        return {'id': id, 'status': 'error', 'reason': f'source not found: {source}'}

    try:
        # Convert video to H.264 MP4 with faststart for streaming
        subprocess.run([
            'ffmpeg', '-y',
            '-i', str(source),
            '-c:v', 'h264',
            '-crf', '28',                    # Quality (lower = better, 18-28 typical)
            '-preset', 'medium',             # Encoding speed vs compression
            '-vf', f"scale='min({VIDEO_MAX_HEIGHT}*2,iw)':'min({VIDEO_MAX_HEIGHT},ih)':force_original_aspect_ratio=decrease",
            '-c:a', 'aac',
            '-b:a', '128k',
            '-movflags', '+faststart',       # Enable streaming
            str(video_out)
        ], capture_output=True, check=True)

        # Extract thumbnail from first few seconds
        subprocess.run([
            'ffmpeg', '-y',
            '-i', str(source),
            '-ss', '00:00:01',               # 1 second in
            '-vframes', '1',
            '-vf', f'scale={THUMB_SIZE}:-1',
            str(thumb_out)
        ], capture_output=True, check=True)

        return {'id': id, 'status': 'ok', 'type': 'video'}

    except subprocess.CalledProcessError as e:
        return {'id': id, 'status': 'error', 'reason': e.stderr.decode() if e.stderr else str(e)}


def process_item(row, force=False):
    """Process a single item (image or video)."""
    filename = row['filename'].lower()

    if is_video(filename):
        # Skip Live Photos (short videos)
        duration = row['duration']
        if duration and duration < 5:
            return {'id': row['id'], 'status': 'skipped', 'reason': 'live photo'}
        return process_video(row, force)
    else:
        return process_image(row, force)


def get_items(single_id=None):
    """Get items to process from database."""
    conn = get_db()
    cursor = conn.cursor()

    if single_id:
        cursor.execute("SELECT id, filename, current_path, duration FROM images WHERE id = ?", (single_id,))
    else:
        cursor.execute("SELECT id, filename, current_path, duration FROM images ORDER BY id")

    items = cursor.fetchall()
    conn.close()
    return items


def main():
    # Parse arguments
    force = '--force' in sys.argv
    single_id = None

    for arg in sys.argv[1:]:
        if arg.isdigit():
            single_id = int(arg)
        elif arg != '--force':
            print(f"Unknown argument: {arg}")
            print(__doc__)
            sys.exit(1)

    # Setup
    ensure_dirs()
    items = get_items(single_id)

    if not items:
        print("No items to process")
        return

    print(f"Processing {len(items)} items...")
    print(f"Output: {WEB_DIR}")
    print()

    # Process items
    stats = {'ok': 0, 'skipped': 0, 'error': 0, 'images': 0, 'videos': 0}
    errors = []

    for i, row in enumerate(items, 1):
        result = process_item(row, force)

        stats[result['status']] += 1
        if result.get('type') == 'image':
            stats['images'] += 1
        elif result.get('type') == 'video':
            stats['videos'] += 1

        if result['status'] == 'error':
            errors.append(result)

        # Progress
        status_char = '.' if result['status'] == 'ok' else ('s' if result['status'] == 'skipped' else 'E')
        print(status_char, end='', flush=True)
        if i % 50 == 0:
            print(f" {i}/{len(items)}")

    print()
    print()
    print("=" * 40)
    print(f"Processed: {stats['ok']} ({stats['images']} images, {stats['videos']} videos)")
    print(f"Skipped:   {stats['skipped']}")
    print(f"Errors:    {stats['error']}")

    if errors:
        print()
        print("Errors:")
        for e in errors[:10]:
            print(f"  ID {e['id']}: {e['reason']}")
        if len(errors) > 10:
            print(f"  ... and {len(errors) - 10} more")

    # Show output size
    print()
    total_size = sum(f.stat().st_size for f in WEB_DIR.rglob('*') if f.is_file())
    print(f"Total size: {total_size / (1024*1024*1024):.2f} GB")


if __name__ == '__main__':
    main()
