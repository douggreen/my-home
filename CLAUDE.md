# Photo Classification Web App

## Critical Rules

### Database is Source of Truth
- **Never hardcode** room names, material categories, or view angles in code
- Always query database for valid values
- Room names: `SELECT DISTINCT room FROM image_rooms ORDER BY room`
- Materials: `SELECT DISTINCT category FROM materials ORDER BY category`

### Before Bulk Database Changes
**ALWAYS save undo SQL before making changes:**
```bash
mkdir -p .cache/undo
# Example: Before renaming rooms
sqlite3 data/photos.db "SELECT 'INSERT INTO image_rooms (image_id, room) VALUES (' || image_id || ', ''old_room'');' FROM image_rooms WHERE room = 'old_room'" > .cache/undo/restore_$(date +%Y%m%d_%H%M%S).sql
# Then make the change
```

### Material Tagging
- Only link materials **actually visible** in each image
- Background materials (framing, wiring) only tagged when PRIMARY subject
- After drywall: don't tag covered materials unless exposed (basement, utility)

---

## Photo Classification

**interior_exterior:** `interior` or `exterior`

**view_angle (exterior only):** front, back, left, right, driveway, etc.

**room (interior only):** Query database for valid values

**construction_phase:** pre-construction, foundation, framing, rough-in, insulation, drywall, trim, finished

---

## File Locations

| What | Location |
|------|----------|
| Web app | `web/app.py` |
| Static files | `web/static/` |
| Templates | `web/templates/` |
| Settings | `data/settings.json` |
| Database | `data/photos.db` |
| Images | `data/images/` |
| Specs/invoices | `data/specs/` |
| Thumbnails | `.cache/jpg-preview/{id}.jpg` |
| Video keyframes | `.cache/keyframes/{video_id}/` |
| Undo scripts | `.cache/undo/` |
| Private docs | `data/CLAUDE.md` |

---

## Running the App

```bash
# Setup (first time)
./scripts/setup.sh

# Start server
./scripts/start.sh

# Stop server
./scripts/stop.sh
```

Open http://localhost:5001 in your browser.

---

## Video Processing

**Process all videos:**
```bash
python scripts/process_videos.py
```

**Process single video:**
```bash
python scripts/process_videos.py {video_id}
```

Script handles: thumbnails, metadata, transcription (Whisper), keyframe extraction.

**Video segments** stored in `video_segments` table - room/material with start/end timestamps.

**After adding segments**, sync to image_rooms:
```sql
INSERT OR IGNORE INTO image_rooms (image_id, room)
SELECT DISTINCT image_id, segment_value FROM video_segments WHERE segment_type = 'room';
UPDATE images SET interior_exterior = 'interior' WHERE id = {video_id};
```
