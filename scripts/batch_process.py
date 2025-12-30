#!/usr/bin/env python3
"""
Batch process images with AI-assisted tagging.
Phase 1: Metadata-based initial guesses
Phase 2: AI visual analysis in batches
"""

import sqlite3
import subprocess
from pathlib import Path
from datetime import datetime

DB_PATH = Path(__file__).parent.parent / "data" / "photos.db"

# Construction timeline based on what we've learned
PHASE_TIMELINE = [
    ('2025-04-01', '2025-07-31', 'pre-construction'),
    ('2025-08-01', '2025-08-25', 'foundation'),
    ('2025-08-26', '2025-09-20', 'framing'),
    ('2025-09-21', '2025-10-10', 'rough-in'),
    ('2025-10-11', '2025-10-25', 'drywall'),
    ('2025-10-26', '2025-12-31', 'trim'),
]

# View angle based on image direction
def guess_view_angle(direction):
    """Guess view angle from EXIF image direction."""
    if direction is None:
        return None, 0.3

    # Based on house orientation: Front=South, Back=North, Left=West, Right=East
    # Camera pointing at front means pointing North (~0°)
    if 315 <= direction <= 360 or 0 <= direction <= 45:
        return 'front', 0.6  # Pointing North = looking at front (south-facing)
    elif 135 <= direction <= 225:
        return 'back', 0.6   # Pointing South = looking at back (north-facing)
    elif 45 < direction < 135:
        return 'left', 0.5   # Pointing East = looking at left/west side
    elif 225 < direction < 315:
        return 'right', 0.5  # Pointing West = looking at right/east side
    return None, 0.3

def guess_phase(photo_date):
    """Guess construction phase from photo date."""
    if photo_date is None:
        return None, 0.3

    for start, end, phase in PHASE_TIMELINE:
        if start <= photo_date <= end:
            return phase, 0.7
    return None, 0.3

def metadata_pass():
    """First pass: Apply metadata-based guesses to all unprocessed images."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Get unprocessed images
    cursor.execute("""
        SELECT id, filename, photo_taken_at, image_direction
        FROM images
        WHERE current_path LIKE '%/home/%'
          AND user_verified = 0
          AND ai_processed = 0
    """)

    images = cursor.fetchall()
    print(f"Processing {len(images)} images with metadata...")

    updated = 0
    for img_id, filename, photo_date, direction in images:
        view_angle, view_conf = guess_view_angle(direction)
        phase, phase_conf = guess_phase(photo_date[:10] if photo_date else None)

        # Average confidence
        confidence = (view_conf + phase_conf) / 2

        cursor.execute("""
            UPDATE images
            SET view_angle = COALESCE(view_angle, ?),
                construction_phase = COALESCE(construction_phase, ?),
                ai_confidence = ?,
                ai_processed = 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (view_angle, phase, confidence, img_id))
        updated += 1

    conn.commit()
    conn.close()
    print(f"Updated {updated} images with metadata-based guesses")

def get_stats():
    """Show current tagging statistics."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    print("\n=== Current Statistics ===\n")

    # By phase
    print("By Construction Phase:")
    cursor.execute("""
        SELECT construction_phase, COUNT(*),
               ROUND(AVG(ai_confidence), 2) as avg_conf
        FROM images
        WHERE current_path LIKE '%/home/%'
        GROUP BY construction_phase
        ORDER BY MIN(photo_taken_at)
    """)
    for phase, count, conf in cursor.fetchall():
        print(f"  {phase or 'unknown'}: {count} images (conf: {conf})")

    # By view angle
    print("\nBy View Angle:")
    cursor.execute("""
        SELECT view_angle, COUNT(*),
               ROUND(AVG(ai_confidence), 2) as avg_conf
        FROM images
        WHERE current_path LIKE '%/home/%'
        GROUP BY view_angle
    """)
    for angle, count, conf in cursor.fetchall():
        print(f"  {angle or 'unknown'}: {count} images (conf: {conf})")

    # By room
    print("\nBy Room (tagged only):")
    cursor.execute("""
        SELECT room, COUNT(*)
        FROM images
        WHERE current_path LIKE '%/home/%' AND room IS NOT NULL
        GROUP BY room
        ORDER BY COUNT(*) DESC
    """)
    for room, count in cursor.fetchall():
        print(f"  {room}: {count} images")

    # Verification status
    print("\nVerification Status:")
    cursor.execute("""
        SELECT
            SUM(CASE WHEN user_verified = 1 THEN 1 ELSE 0 END) as verified,
            SUM(CASE WHEN ai_processed = 1 AND user_verified = 0 THEN 1 ELSE 0 END) as ai_only,
            SUM(CASE WHEN ai_processed = 0 AND user_verified = 0 THEN 1 ELSE 0 END) as unprocessed
        FROM images WHERE current_path LIKE '%/home/%'
    """)
    verified, ai_only, unprocessed = cursor.fetchone()
    print(f"  User verified: {verified}")
    print(f"  AI processed (needs review): {ai_only}")
    print(f"  Unprocessed: {unprocessed}")

    conn.close()

def get_samples(phase=None, view=None, room=None, limit=5):
    """Get sample images for a category."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    query = """
        SELECT filename, photo_taken_at, image_direction,
               view_angle, construction_phase, room, ai_confidence
        FROM images
        WHERE current_path LIKE '%/home/%'
    """
    params = []

    if phase:
        query += " AND construction_phase = ?"
        params.append(phase)
    if view:
        query += " AND view_angle = ?"
        params.append(view)
    if room:
        query += " AND room = ?"
        params.append(room)

    query += " ORDER BY RANDOM() LIMIT ?"
    params.append(limit)

    cursor.execute(query, params)
    results = cursor.fetchall()
    conn.close()
    return results

if __name__ == '__main__':
    import sys

    if len(sys.argv) > 1:
        if sys.argv[1] == 'metadata':
            metadata_pass()
        elif sys.argv[1] == 'stats':
            get_stats()
    else:
        print("Usage:")
        print("  python batch_process.py metadata  - Run metadata-based tagging")
        print("  python batch_process.py stats     - Show statistics")
