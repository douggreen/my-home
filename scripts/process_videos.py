#!/usr/bin/env python3
"""
Video processing script (no API calls).
Run from project root: python scripts/process_videos.py [video_id]

Steps for each video:
1. Generate thumbnail (if missing)
2. Extract metadata - duration, resolution, rotation (if missing)
3. Transcribe with Whisper (if not transcribed)
4. Extract keyframes for manual analysis

Analysis (room/material segments) is done manually via Claude Code.
"""

import subprocess
import sqlite3
import json
import os
import sys
from pathlib import Path


def get_db_connection():
    conn = sqlite3.connect('data/photos.db')
    conn.row_factory = sqlite3.Row
    return conn


def generate_thumbnail(video_id, video_path):
    """Generate thumbnail for video."""
    thumb_path = f".cache/jpg-preview/{video_id}.jpg"
    if os.path.exists(thumb_path):
        return True

    print(f"  Generating thumbnail...")
    os.makedirs(".cache/jpg-preview", exist_ok=True)
    result = subprocess.run([
        'ffmpeg', '-y', '-i', video_path,
        '-vf', 'thumbnail,scale=300:-1',
        '-frames:v', '1',
        thumb_path
    ], capture_output=True)

    return os.path.exists(thumb_path)


def extract_metadata(conn, video_id, video_path):
    """Extract and store video metadata."""
    cursor = conn.cursor()
    cursor.execute("SELECT duration FROM images WHERE id = ?", (video_id,))
    row = cursor.fetchone()
    # Check for actual valid duration (not just not-None, since 0.0 is invalid)
    if row and row['duration'] and row['duration'] > 0:
        return True

    print(f"  Extracting metadata...")

    # Ensure path is relative to data/ directory
    if video_path.startswith('images/'):
        full_path = f"data/{video_path}"
    else:
        full_path = video_path

    if not os.path.exists(full_path):
        print(f"  ERROR: File not found: {full_path}")
        return False

    result = subprocess.run([
        'ffprobe', '-v', 'quiet', '-print_format', 'json',
        '-show_format', '-show_streams', full_path
    ], capture_output=True, text=True)

    try:
        meta = json.loads(result.stdout)
        fmt = meta.get('format', {})
        duration = float(fmt.get('duration', 0))

        # Warn if duration is 0 - likely ffprobe issue
        if duration == 0:
            print(f"  WARNING: ffprobe returned duration=0, may need manual fix")

        video_streams = [s for s in meta.get('streams', []) if s.get('codec_type') == 'video']
        if video_streams:
            vs = video_streams[0]
            width = vs.get('width', 0)
            height = vs.get('height', 0)
            rotation = 0
            for sd in vs.get('side_data_list', []):
                if 'rotation' in sd:
                    rotation = int(sd['rotation'])
                    break
        else:
            width = height = rotation = 0

        cursor.execute("""
            UPDATE images SET duration=?, video_width=?, video_height=?, rotation=?
            WHERE id=?
        """, (duration, width, height, rotation, video_id))

        # Device info from tags
        tags = fmt.get('tags', {})
        make = tags.get('com.apple.quicktime.make', '')
        model = tags.get('com.apple.quicktime.model', '')
        created = tags.get('com.apple.quicktime.creationdate', '')
        if created:
            created = created[:19].replace('T', ' ')

        if make:
            cursor.execute("UPDATE images SET device_make=? WHERE id=? AND device_make IS NULL", (make, video_id))
        if model:
            cursor.execute("UPDATE images SET device_model=? WHERE id=? AND device_model IS NULL", (model, video_id))
        if created:
            cursor.execute("UPDATE images SET photo_taken_at=? WHERE id=? AND photo_taken_at IS NULL", (created, video_id))

        conn.commit()
        return True
    except Exception as e:
        print(f"  Error extracting metadata: {e}")
        return False


def transcribe_video(conn, video_id, video_path):
    """Transcribe video using Whisper."""
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM video_transcriptions WHERE image_id = ?", (video_id,))
    if cursor.fetchone():
        return True

    audio_dir = ".cache/audio"
    os.makedirs(audio_dir, exist_ok=True)
    audio_path = f"{audio_dir}/{video_id}.wav"
    json_path = f"{audio_dir}/{video_id}.json"

    # Check cache
    if os.path.exists(json_path):
        print(f"  Loading transcription from cache...")
        with open(json_path) as f:
            data = json.load(f)
    else:
        # Extract audio
        print(f"  Extracting audio...")
        subprocess.run([
            'ffmpeg', '-y', '-i', video_path,
            '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1',
            audio_path
        ], capture_output=True)

        if not os.path.exists(audio_path):
            print(f"  ERROR: Failed to extract audio")
            return False

        # Transcribe with Whisper
        print(f"  Transcribing with Whisper...")
        result = subprocess.run([
            'whisper', audio_path,
            '--model', 'base',
            '--output_format', 'json',
            '--output_dir', audio_dir,
            '--language', 'en'
        ], capture_output=True, text=True)

        if not os.path.exists(json_path):
            print(f"  ERROR: Transcription failed")
            return False

        with open(json_path) as f:
            data = json.load(f)

    # Store in database
    text = data.get('text', '').strip()
    json_str = json.dumps(data)

    cursor.execute("""
        INSERT OR REPLACE INTO video_transcriptions (image_id, transcription, transcription_json)
        VALUES (?, ?, ?)
    """, (video_id, text, json_str))
    conn.commit()

    preview = text[:60] + "..." if len(text) > 60 else text
    print(f"  Transcription: {preview}")
    return True


def extract_keyframes(video_id, video_path):
    """Extract 1-second interval keyframes for analysis."""
    keyframes_dir = Path(f".cache/keyframes/{video_id}")
    keyframes_dir.mkdir(parents=True, exist_ok=True)

    existing = list(keyframes_dir.glob("frame_*.jpg"))
    if existing:
        print(f"  Keyframes already exist ({len(existing)} frames)")
        return sorted(existing)

    print(f"  Extracting keyframes...")
    subprocess.run([
        'ffmpeg', '-y', '-i', video_path,
        '-vf', 'fps=1,scale=400:-1',
        str(keyframes_dir / 'frame_%03d.jpg')
    ], capture_output=True)

    frames = sorted(keyframes_dir.glob("frame_*.jpg"))
    print(f"  Extracted {len(frames)} keyframes")
    return frames


def process_video(conn, video_id, video_path, duration):
    """Process a single video through all steps."""
    # Step 1: Thumbnail
    generate_thumbnail(video_id, video_path)

    # Step 2: Metadata
    extract_metadata(conn, video_id, video_path)

    # Skip very short videos (Live Photos)
    if duration and duration < 5:
        print(f"  Skipping short video (Live Photo)")
        return

    # Step 3: Transcription
    transcribe_video(conn, video_id, video_path)

    # Step 4: Keyframes (for manual analysis via Claude Code)
    extract_keyframes(video_id, video_path)

    print(f"  Ready for manual analysis via Claude Code")


def main():
    # Change to project root
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(os.path.dirname(script_dir))

    conn = get_db_connection()
    cursor = conn.cursor()

    # Check for specific video ID argument
    if len(sys.argv) > 1:
        video_id = int(sys.argv[1])
        cursor.execute("SELECT id, current_path, duration FROM images WHERE id = ?", (video_id,))
        row = cursor.fetchone()
        if not row:
            print(f"Video {video_id} not found")
            return
        print(f"Processing video {video_id}: {row['current_path']}")
        process_video(conn, row['id'], row['current_path'], row['duration'])
    else:
        # Process all videos needing work
        cursor.execute("""
            SELECT i.id, i.current_path, i.duration,
                   vt.id as has_transcription
            FROM images i
            LEFT JOIN video_transcriptions vt ON i.id = vt.image_id
            WHERE lower(i.current_path) LIKE '%.mov'
               OR lower(i.current_path) LIKE '%.mp4'
               OR lower(i.current_path) LIKE '%.m4v'
            ORDER BY i.duration
        """)
        videos = cursor.fetchall()

        need_work = [v for v in videos if not v['has_transcription']]

        if not need_work:
            print("All videos have thumbnails, metadata, and transcriptions!")
            print("Use Claude Code to analyze videos for room/material segments.")
            return

        print(f"Found {len(need_work)} videos needing processing\n")

        for i, video in enumerate(need_work):
            vid_id = video['id']
            path = video['current_path']
            duration = video['duration'] or 0

            mins = int(duration // 60)
            secs = int(duration % 60)
            print(f"[{i+1}/{len(need_work)}] Video {vid_id} ({mins}:{secs:02d})")

            process_video(conn, vid_id, path, duration)
            print()

    conn.close()
    print("Done!")


if __name__ == '__main__':
    main()
