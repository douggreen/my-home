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
| Source images | `data/images/` |
| Web-ready images | `data/web-images/` |
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

---

## Deployment

### Architecture

```
Local (macOS)                    Production (Linux)
─────────────────                ─────────────────
data/images/     ──prepare──►    data/web-images/
  (HEIC, MOV)                      (JPEG, MP4)
```

- **Local dev**: Source files in `data/images/`, converted on-the-fly (macOS only)
- **Production**: Pre-converted files in `data/web-images/`, no conversion needed

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
