# Photo Classification Web App

A lightweight Flask-based web application for organizing and classifying construction photos and videos during a home build project.

## About This Project

This application was developed collaboratively between a human product owner/architect and Claude (Anthropic's AI assistant) using [Claude Code](https://claude.com/claude-code). The entire codebase—Flask app, JavaScript UI, database schema, and utility scripts—was written by Claude based on requirements and feedback from the product owner.

### AI-Assisted Workflow

The real power of this tool comes from pairing it with AI assistance:

- **Photo Analysis** - Claude reviewed photos in batches, identifying rooms based on visual cues (window sizes, fixtures, floor types) and EXIF direction metadata
- **Video Segmentation** - Claude analyzed video keyframes and transcriptions to identify room transitions and timestamp segments
- **Material Identification** - Claude matched visible materials to specs from invoices and manufacturer documents
- **Data Correction** - Interactive review sessions where Claude proposed changes and the human confirmed/corrected them

### Scripts Note

The scripts in `scripts/` were designed for interactive use with AI assistance. While `init_db.py`, `start.sh`, and `stop.sh` work standalone, others like `import_metadata.py` and `process_videos.py` were typically run by Claude during collaborative sessions where it could review output and make database updates based on the results.

## Features

- **Photo/Video Browsing** - Grid view with filtering by room, phase, material, date
- **Classification** - Interior/exterior, room tags, view angles, construction phases
- **Material Linking** - Link photos to a materials database (windows, doors, fixtures, etc.)
- **Video Support** - Playback with transcription and room/time segments
- **Keyboard Navigation** - Arrow keys to browse, 'e' to edit

## Quick Start

### 1. Clone and Setup

```bash
git clone <repo-url>
cd MyHome

# Create virtual environment
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Initialize Data Directory

```bash
# Create data directory structure
mkdir -p data/images data/specs

# Copy example settings
cp example-data/settings.json data/

# Edit settings with your site title
nano data/settings.json

# Initialize database
python scripts/init_db.py
```

### 3. Add Your Photos

Copy your construction photos to `data/images/`:

```bash
cp /path/to/your/photos/*.HEIC data/images/
cp /path/to/your/photos/*.MOV data/images/
```

### 4. Import Photo Metadata

```bash
python scripts/import_metadata.py
```

This extracts EXIF data (dates, GPS, camera info) from your photos.

### 5. Start the App

```bash
./scripts/start.sh
```

Open http://localhost:5001 in your browser.

## Project Structure

```
├── web/                 # Flask application
│   ├── app.py          # Main Flask app
│   ├── static/         # JavaScript, CSS
│   └── templates/      # HTML templates
├── scripts/            # Utility scripts
│   ├── start.sh        # Start server
│   ├── stop.sh         # Stop server
│   ├── init_db.py      # Initialize database
│   ├── import_metadata.py  # Import photo EXIF data
│   └── process_videos.py   # Process video files
├── data/               # Your data (gitignored)
│   ├── settings.json   # Site configuration
│   ├── photos.db       # SQLite database
│   ├── images/         # Your photos/videos
│   └── specs/          # PDF specs/invoices
├── example-data/       # Example structure
├── .cache/             # Generated thumbnails (gitignored)
├── CLAUDE.md           # AI assistant instructions
└── requirements.txt    # Python dependencies
```

## Configuration

Edit `data/settings.json`:

```json
{
  "site_title": "My Home Build"
}
```

## Video Processing

To enable video transcription (requires [Whisper](https://github.com/openai/whisper)):

```bash
pip install openai-whisper
python scripts/process_videos.py
```

## Deployment

### Requirements

- Python 3.8+
- ffmpeg (for image/video conversion)

### Prepare Web-Ready Images

Before deploying, convert source images to web-optimized formats:

```bash
python scripts/prepare_web_images.py
```

This creates `data/web-images/` with:
- `full/` - Full-size JPEGs (max 1600px)
- `thumb/` - Thumbnails (300px)
- `video/` - Streaming-ready MP4s (H.264 + faststart)

### Deploy to Server

```bash
# On server
cd /var/www/myhome
./scripts/setup.sh

# Upload from local machine
rsync -avz data/photos.db server:/var/www/myhome/data/
rsync -avz data/settings.json server:/var/www/myhome/data/
rsync -avz data/web-images/ server:/var/www/myhome/data/web-images/
```

See `CLAUDE.md` for full deployment instructions including Apache configuration.

## Development

This project was built over several interactive sessions using Claude Code. Key development milestones:

1. **Initial Setup** - Database schema, Flask app skeleton, basic grid view
2. **Classification UI** - Dropdowns for rooms, phases, materials with auto-save
3. **Video Support** - Thumbnail generation, HTML5 playback, transcription integration
4. **Room Identification** - Window size/direction table for validating room assignments
5. **Material Database** - Catalog from Pella, Ferguson, Carter Lumber specs
6. **Code Organization** - Refactored into `web/`, `data/`, `scripts/` structure

The `CLAUDE.md` file contains instructions that help Claude understand the project context when resuming work. A private `data/CLAUDE.md` (gitignored) contains property-specific details.

## Credits

- **Product Owner & Architect:** Doug Green
- **Developer:** Claude (Anthropic)
- **Built with:** [Claude Code](https://claude.com/claude-code)

## License

MIT
