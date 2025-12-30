# Photo Classification Web App

## Critical Rules

### Database is Source of Truth
- **Never hardcode** location names or material categories in code
- Always query database for valid values
- Locations: `SELECT id, name, full_path FROM locations ORDER BY full_path`
- Materials: `SELECT DISTINCT category FROM materials ORDER BY category`

### Before Bulk Database Changes
**ALWAYS save undo SQL before making changes:**
```bash
mkdir -p .cache/undo
# Example: Before renaming locations
sqlite3 data/photos.db "SELECT 'UPDATE locations SET name = ''old_name'' WHERE id = ' || id || ';' FROM locations WHERE name = 'new_name'" > .cache/undo/restore_$(date +%Y%m%d_%H%M%S).sql
# Then make the change
```

### Material Tagging
- Only link materials **actually visible** in each image
- Background materials (framing, wiring) only tagged when PRIMARY subject
- After drywall: don't tag covered materials unless exposed (basement, utility)

---

## Photo Classification

**location:** Hierarchical locations from `locations` table (e.g., "Interior > Kitchen", "Exterior > Front")

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
| Source images | `data/images/` |
| Web-ready images | `data/web-images/` |
| Specs/invoices | `data/specs/` |
| Video keyframes | `.cache/keyframes/{video_id}/` |
| Undo scripts | `.cache/undo/` |
| Private docs | `data/CLAUDE.md` |

**Web-ready images** (`data/web-images/`) are used for both local classification and deployment:
- `full/{id}.jpg` - Full-size (1600px) for viewing/classification
- `thumb/{id}.jpg` - Thumbnails (300px) for grid view
- `video/{id}.mp4` - Streaming-ready videos

Run `python scripts/prepare_web_images.py` after importing new images.

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

### Primary Task: Create Video Segments

The main goal of video processing is to create `video_segments` entries with **locations and timestamps**. Each segment identifies what location is visible and when (start/end times in seconds).

**Workflow:**
1. Extract keyframes at 1fps to `.cache/keyframes/{video_id}/`
2. Review frames to identify location transitions
3. Insert segments with timestamps into `video_segments` table
4. Sync to `image_locations` for search/filtering

**Video segments table:**
```sql
INSERT INTO video_segments (image_id, segment_type, segment_value, start_time, end_time, location_id, confidence)
VALUES (23, 'location', 'cul-de-sac', 0.0, 15.5, 230, 'high');
```

**After adding segments**, sync to image_locations:
```sql
INSERT OR IGNORE INTO image_locations (image_id, location_id)
SELECT DISTINCT image_id, location_id FROM video_segments WHERE location_id IS NOT NULL;
```

### Extract Keyframes

```bash
# Extract keyframes for a video
ffmpeg -i data/images/VIDEO.MOV -vf "fps=1" .cache/keyframes/{id}/frame_%03d.jpg
```

### Process Videos Script

```bash
python scripts/process_videos.py        # All videos
python scripts/process_videos.py {id}   # Single video
```

Script handles: thumbnails, metadata, transcription (Whisper), keyframe extraction.

---

## Deployment

### Architecture

```
Local (macOS)                    Production (Linux)
─────────────────                ─────────────────
data/images/     ──prepare──►    data/web-images/
  (HEIC, MOV)                      (JPEG, MP4)
     ↓                                  ↓
  Read/Write                       Read-Only
```

- **Local dev**: Source files in `data/images/`, full editing enabled
- **Production**: Pre-converted files in `data/web-images/`, **read-only viewer**

### Read-Only Production Mode

Production is automatically read-only when `data/images/` doesn't exist:
- All POST endpoints return 403 Forbidden
- No edits, favorites, or classification changes allowed
- All data manipulation done locally, then rsync to server

### Prepare Web-Ready Images

Run locally before deploying:

```bash
python scripts/prepare_web_images.py
```

Creates `data/web-images/`:
| Directory | Contents |
|-----------|----------|
| `full/` | Full-size JPEGs (max 1600px) |
| `thumb/` | Thumbnails (300px) |
| `video/` | Streaming-ready MP4s (H.264 + faststart) |

Options:
- `python scripts/prepare_web_images.py 123` - Process single ID
- `python scripts/prepare_web_images.py --force` - Reprocess existing

### Deploy to Server

Upload to server (e.g., `/var/www/myhome/`):

```bash
# Required files
rsync -avz data/photos.db server:/var/www/myhome/data/
rsync -avz data/settings.json server:/var/www/myhome/data/
rsync -avz data/web-images/ server:/var/www/myhome/data/web-images/

# App code (or use git pull on server)
rsync -avz web/ server:/var/www/myhome/web/
rsync -avz scripts/ server:/var/www/myhome/scripts/
```

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `DATA_DIR` | Path to data directory | `../data` relative to web/ |
| `PHOTOS_BASE_PATH` | Path to source images | Same as DATA_DIR |

### Server Requirements

- Python 3.8+
- Flask
- No ffmpeg/sips needed (uses pre-converted files)

### Apache Configuration

```apache
<VirtualHost *:80>
    ServerName myhome.example.com

    WSGIDaemonProcess myhome python-path=/var/www/myhome
    WSGIScriptAlias / /var/www/myhome/web/app.wsgi

    <Directory /var/www/myhome/web>
        Require all granted
    </Directory>

    # Basic auth
    <Location />
        AuthType Basic
        AuthName "MyHome"
        AuthUserFile /var/www/myhome/.htpasswd
        Require valid-user
    </Location>
</VirtualHost>
```

Create `.htpasswd`:
```bash
htpasswd -c /var/www/myhome/.htpasswd username
```
