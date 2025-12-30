#!/usr/bin/env python3
"""
Initialize the photo classification database.
Run from project root: python scripts/init_db.py
"""

import sqlite3
import os
from pathlib import Path

# Database location
PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data"
DB_PATH = DATA_DIR / "photos.db"

SCHEMA = """
-- Main images table
CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY,
    filename TEXT NOT NULL,
    current_path TEXT NOT NULL,
    file_hash TEXT,

    -- Timestamps
    photo_taken_at DATETIME,
    uploaded_at DATETIME,

    -- Location
    latitude REAL,
    longitude REAL,
    altitude REAL,

    -- Camera/EXIF
    device_make TEXT,
    device_model TEXT,
    focal_length REAL,
    aperture REAL,
    exposure_time REAL,
    iso INTEGER,
    image_direction REAL,

    -- Dimensions
    width INTEGER,
    height INTEGER,

    -- Classification
    description TEXT,
    construction_phase TEXT,
    interior_exterior TEXT,
    material_notes TEXT,

    -- Video metadata
    duration REAL,
    video_width INTEGER,
    video_height INTEGER,
    rotation INTEGER,

    -- Flags
    hidden INTEGER DEFAULT 0,
    favorite INTEGER DEFAULT 0,
    human_verified INTEGER DEFAULT 0,
    verified_at TEXT,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Rooms linked to images
CREATE TABLE IF NOT EXISTS image_rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_id INTEGER NOT NULL,
    room TEXT NOT NULL,
    FOREIGN KEY (image_id) REFERENCES images(id),
    UNIQUE(image_id, room)
);

-- View angles for exterior photos
CREATE TABLE IF NOT EXISTS image_view_angles (
    image_id INTEGER NOT NULL,
    view_angle TEXT NOT NULL,
    PRIMARY KEY (image_id, view_angle),
    FOREIGN KEY (image_id) REFERENCES images(id)
);

-- Materials catalog
CREATE TABLE IF NOT EXISTS materials (
    id INTEGER PRIMARY KEY,
    category TEXT NOT NULL,
    name TEXT,
    manufacturer TEXT,
    model TEXT,
    color TEXT,
    specs TEXT,
    location TEXT,
    purchase_info TEXT,
    url TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Materials linked to images
CREATE TABLE IF NOT EXISTS image_materials (
    image_id INTEGER REFERENCES images(id),
    material_id INTEGER REFERENCES materials(id),
    PRIMARY KEY (image_id, material_id)
);

-- Video transcriptions
CREATE TABLE IF NOT EXISTS video_transcriptions (
    id INTEGER PRIMARY KEY,
    image_id INTEGER NOT NULL UNIQUE,
    transcription TEXT,
    transcription_json TEXT,
    summary TEXT,
    transcribed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (image_id) REFERENCES images(id)
);

-- Video segments (rooms/materials with timestamps)
CREATE TABLE IF NOT EXISTS video_segments (
    id INTEGER PRIMARY KEY,
    image_id INTEGER NOT NULL,
    segment_type TEXT NOT NULL,
    segment_value TEXT NOT NULL,
    start_time REAL NOT NULL,
    end_time REAL NOT NULL,
    description TEXT,
    confidence TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (image_id) REFERENCES images(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_photo_taken ON images(photo_taken_at);
CREATE INDEX IF NOT EXISTS idx_construction_phase ON images(construction_phase);
CREATE INDEX IF NOT EXISTS idx_filename ON images(filename);
CREATE INDEX IF NOT EXISTS idx_materials_category ON materials(category);
CREATE INDEX IF NOT EXISTS idx_video_segments_image ON video_segments(image_id);
"""

def init_db():
    """Create the database and tables (only creates tables that don't exist)."""
    # Ensure data directory exists
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    existed = DB_PATH.exists()

    print(f"{'Updating' if existed else 'Creating'} database at {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()

    if existed:
        print("Database updated (new tables added if any).")
    else:
        print("Database initialized successfully!")
        print("\nNext steps:")
        print("1. Copy your photos to data/images/")
        print("2. Run: python scripts/import_metadata.py")
        print("3. Start the app: ./scripts/start.sh")

if __name__ == "__main__":
    init_db()
