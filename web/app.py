#!/usr/bin/env python3
"""
Photo Classification Web UI
Simple Flask app to view and reclassify construction photos.
"""

import os
import json
import sqlite3
import subprocess
import hashlib
from flask import Flask, render_template, jsonify, request, send_file, abort

app = Flask(__name__)

# Configuration
APP_DIR = os.path.dirname(__file__)
PROJECT_ROOT = os.path.dirname(APP_DIR)
DATA_DIR = os.environ.get('DATA_DIR', os.path.join(PROJECT_ROOT, 'data'))
DB_PATH = os.path.join(DATA_DIR, 'photos.db')
SETTINGS_PATH = os.path.join(DATA_DIR, 'settings.json')
PHOTOS_BASE_PATH = os.environ.get('PHOTOS_BASE_PATH', DATA_DIR)
CACHE_DIR = '/tmp/photo_cache'

# Web-ready images directory (pre-converted for production)
WEB_IMAGES_DIR = os.path.join(DATA_DIR, 'web-images')

# Source images directory (original HEIC/MOV files for local development)
SOURCE_IMAGES_DIR = os.path.join(DATA_DIR, 'images')

# If source images exist, prefer on-the-fly conversion (local dev)
# If only web-images exist, use those (production)
HAS_SOURCE_IMAGES = os.path.isdir(SOURCE_IMAGES_DIR) and bool(os.listdir(SOURCE_IMAGES_DIR))
HAS_WEB_IMAGES = os.path.isdir(WEB_IMAGES_DIR)
USE_WEB_IMAGES = HAS_WEB_IMAGES and not HAS_SOURCE_IMAGES

# Production mode is read-only (no source images = no edits allowed)
READ_ONLY = not HAS_SOURCE_IMAGES

# Load settings
def load_settings():
    if os.path.exists(SETTINGS_PATH):
        with open(SETTINGS_PATH) as f:
            return json.load(f)
    return {'site_title': 'Photo Classification'}

SETTINGS = load_settings()

# Ensure cache directory exists
os.makedirs(CACHE_DIR, exist_ok=True)


def get_db():
    """Get database connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def check_read_only():
    """Return error response if in read-only mode, None otherwise."""
    if READ_ONLY:
        return jsonify({'error': 'Read-only mode - edits disabled in production'}), 403
    return None


def degrees_to_compass(degrees):
    """Convert degrees (0-360) to compass direction."""
    if degrees is None:
        return None
    # Normalize to 0-360
    degrees = degrees % 360
    directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    # Each direction covers 45 degrees, offset by 22.5
    index = int((degrees + 22.5) / 45) % 8
    return directions[index]


@app.route('/')
def index():
    """Serve main HTML page."""
    return render_template('index.html', site_title=SETTINGS.get('site_title', 'Photo Classification'))


@app.route('/api/status')
def get_status():
    """Get server status including read-only mode."""
    return jsonify({
        'read_only': READ_ONLY,
        'has_source_images': HAS_SOURCE_IMAGES,
        'has_web_images': HAS_WEB_IMAGES
    })


@app.route('/api/rooms')
def get_rooms():
    """Get list of rooms with image counts."""
    conn = get_db()
    cursor = conn.cursor()

    # Get rooms for interior images from junction table
    cursor.execute('''
        SELECT ir.room, COUNT(*) as count
        FROM image_rooms ir
        JOIN images i ON ir.image_id = i.id
        WHERE i.interior_exterior = 'interior'
        GROUP BY ir.room
        ORDER BY ir.room
    ''')
    rooms = [{'name': row['room'], 'count': row['count']} for row in cursor.fetchall()]

    # Get total count
    cursor.execute("SELECT COUNT(*) as count FROM images WHERE interior_exterior = 'interior'")
    total = cursor.fetchone()['count']

    # Get exterior count
    cursor.execute("SELECT COUNT(*) as count FROM images WHERE interior_exterior = 'exterior'")
    exterior = cursor.fetchone()['count']

    # Get count of images with linked materials
    cursor.execute("SELECT COUNT(DISTINCT image_id) as count FROM image_materials")
    materials = cursor.fetchone()['count']

    # Get count of videos (exclude Live Photos under 5 seconds)
    cursor.execute("""SELECT COUNT(*) as count FROM images
        WHERE (lower(current_path) LIKE '%.mov' OR lower(current_path) LIKE '%.mp4' OR lower(current_path) LIKE '%.m4v')
        AND (duration IS NULL OR duration >= 5)""")
    videos = cursor.fetchone()['count']

    # Get count of favorites
    cursor.execute("SELECT COUNT(*) as count FROM images WHERE favorite = 1 AND hidden = 0")
    favorites = cursor.fetchone()['count']

    conn.close()
    return jsonify({
        'rooms': rooms,
        'total_interior': total,
        'total_exterior': exterior,
        'total_materials': materials,
        'total_videos': videos,
        'total_favorites': favorites
    })


@app.route('/api/images')
def get_images():
    """Get images, optionally filtered by room, view_angle, material_category, construction_phase, date range, search text, or interior/exterior."""
    room = request.args.get('room')
    location = request.args.get('location', 'interior')  # interior, exterior, or materials
    view_angle = request.args.get('view_angle')
    material_category = request.args.get('material_category')
    phase = request.args.get('phase')
    month = request.args.get('month')  # Format: YYYY-MM
    show_hidden = request.args.get('show_hidden', 'false') == 'true'
    search = request.args.get('search', '').strip()
    has_material_category = request.args.get('has_material_category')  # Find images linked to this material category
    videos_only = request.args.get('videos_only', 'false') == 'true'  # Filter to only show videos
    room_filter = request.args.get('room_filter')  # Filter by room (used in Materials view)
    favorites_only = request.args.get('favorites_only', 'false') == 'true'  # Filter to only show favorites
    material_id = request.args.get('material_id')  # Filter by specific material ID

    conn = get_db()
    cursor = conn.cursor()

    # Build query dynamically
    conditions = []
    params = []
    join_clause = ""
    extra_joins = []

    # Filter by hidden status: show_hidden=true shows ONLY hidden, otherwise show non-hidden
    if show_hidden:
        conditions.append("i.hidden = 1")
    else:
        conditions.append("i.hidden = 0")

    # Filter to videos only (exclude Live Photos under 5 seconds)
    if videos_only:
        conditions.append("(lower(i.current_path) LIKE '%.mov' OR lower(i.current_path) LIKE '%.mp4' OR lower(i.current_path) LIKE '%.m4v')")
        conditions.append("(i.duration IS NULL OR i.duration >= 5)")

    # Filter to favorites only (skip location filter for favorites view)
    if favorites_only:
        conditions.append("i.favorite = 1")
    elif location == 'exterior':
        conditions.append("i.interior_exterior = 'exterior'")
        if view_angle:
            if view_angle == 'unclassified':
                # Images with no view angles in junction table
                conditions.append("NOT EXISTS (SELECT 1 FROM image_view_angles iva WHERE iva.image_id = i.id)")
            else:
                # Use junction table to find images with this view angle
                join_clause = "JOIN image_view_angles iva ON i.id = iva.image_id"
                conditions.append("iva.view_angle = ?")
                params.append(view_angle)
    elif location == 'materials':
        # Materials tab shows images with linked materials OR videos with material segments
        if material_category:
            # Images with materials in this category OR videos with material segments matching this category
            conditions.append("""(
                EXISTS (SELECT 1 FROM image_materials im JOIN materials m ON im.material_id = m.id
                        WHERE im.image_id = i.id AND m.category = ?)
                OR EXISTS (SELECT 1 FROM video_segments vs JOIN materials m ON lower(vs.segment_value) = lower(m.name)
                           WHERE vs.image_id = i.id AND vs.segment_type = 'material' AND m.category = ?)
            )""")
            params.append(material_category)
            params.append(material_category)
        else:
            # Show all images with any linked materials OR videos with material segments
            conditions.append("""(
                EXISTS (SELECT 1 FROM image_materials im WHERE im.image_id = i.id)
                OR EXISTS (SELECT 1 FROM video_segments vs WHERE vs.image_id = i.id AND vs.segment_type = 'material')
            )""")
    elif location == 'videos':
        # Videos tab shows only video files (exclude Live Photos under 5 seconds)
        conditions.append("(lower(i.current_path) LIKE '%.mov' OR lower(i.current_path) LIKE '%.mp4' OR lower(i.current_path) LIKE '%.m4v')")
        conditions.append("(i.duration IS NULL OR i.duration >= 5)")
    else:
        conditions.append("i.interior_exterior = 'interior'")
        if room:
            # Use junction table to find images with this room
            join_clause = "JOIN image_rooms ir ON i.id = ir.image_id"
            conditions.append("ir.room = ?")
            params.append(room)

    if phase:
        conditions.append("i.construction_phase = ?")
        params.append(phase)

    if month:
        # Filter by month (format: YYYY-MM)
        conditions.append("strftime('%Y-%m', i.photo_taken_at) = ?")
        params.append(month)

    # Text search across filename, notes, linked material names, video transcripts, rooms, and view angles
    if search:
        search_pattern = f'%{search}%'
        # Search in filename, description, material_notes, linked material names, video transcripts, rooms, view angles
        extra_joins.append("LEFT JOIN image_materials im_search ON i.id = im_search.image_id")
        extra_joins.append("LEFT JOIN materials m_search ON im_search.material_id = m_search.id")
        extra_joins.append("LEFT JOIN video_transcriptions vt_search ON i.id = vt_search.image_id")
        extra_joins.append("LEFT JOIN image_rooms ir_search ON i.id = ir_search.image_id")
        extra_joins.append("LEFT JOIN image_view_angles iva_search ON i.id = iva_search.image_id")
        conditions.append("""(
            i.current_path LIKE ? OR
            i.description LIKE ? OR
            i.material_notes LIKE ? OR
            m_search.name LIKE ? OR
            m_search.manufacturer LIKE ? OR
            vt_search.transcription LIKE ? OR
            vt_search.summary LIKE ? OR
            ir_search.room LIKE ? OR
            iva_search.view_angle LIKE ?
        )""")
        params.extend([search_pattern] * 9)

    # Filter for images linked to a specific material category
    if has_material_category:
        conditions.append("""EXISTS (
            SELECT 1 FROM image_materials im_mat
            JOIN materials m_mat ON im_mat.material_id = m_mat.id
            WHERE im_mat.image_id = i.id AND m_mat.category = ?
        )""")
        params.append(has_material_category)

    # Filter by room (for Materials view)
    if room_filter:
        conditions.append("""(
            EXISTS (SELECT 1 FROM image_rooms ir WHERE ir.image_id = i.id AND ir.room = ?)
            OR EXISTS (SELECT 1 FROM video_segments vs WHERE vs.image_id = i.id AND vs.segment_type = 'room' AND vs.segment_value = ?)
        )""")
        params.extend([room_filter, room_filter])

    # Filter by specific material ID
    if material_id:
        conditions.append("EXISTS (SELECT 1 FROM image_materials im WHERE im.image_id = i.id AND im.material_id = ?)")
        params.append(material_id)

    # Combine all joins
    all_joins = join_clause
    if extra_joins:
        all_joins = join_clause + " " + " ".join(extra_joins) if join_clause else " ".join(extra_joins)

    where_clause = " AND ".join(conditions) if conditions else "1=1"
    query = f'''
        SELECT DISTINCT i.id, i.current_path, i.interior_exterior, i.construction_phase, i.hidden, i.description, i.material_notes, i.image_direction, i.duration, i.photo_taken_at, i.favorite
        FROM images i
        {all_joins}
        WHERE {where_clause}
        ORDER BY i.photo_taken_at, i.current_path
    '''
    cursor.execute(query, params)

    images = []
    for row in cursor.fetchall():
        filename = os.path.basename(row['current_path'])
        # Get all rooms for this image from junction table
        cursor.execute('SELECT room FROM image_rooms WHERE image_id = ?', (row['id'],))
        rooms = [r['room'] for r in cursor.fetchall()]
        # Get all view angles for this image from junction table
        cursor.execute('SELECT view_angle FROM image_view_angles WHERE image_id = ?', (row['id'],))
        view_angles = [r['view_angle'] for r in cursor.fetchall()]
        # Get all material categories for this image
        cursor.execute('''SELECT DISTINCT m.category FROM materials m
                          JOIN image_materials im ON m.id = im.material_id
                          WHERE im.image_id = ?''', (row['id'],))
        material_categories = [r['category'] for r in cursor.fetchall()]
        # Treat as video only if duration >= 5 seconds (excludes Live Photos)
        is_video_ext = filename.lower().endswith(('.mov', '.mp4', '.m4v'))
        duration = row['duration']
        is_video = is_video_ext and (duration is None or duration >= 5)
        images.append({
            'id': row['id'],
            'filename': filename,
            'rooms': rooms,  # Array of all rooms
            'interior_exterior': row['interior_exterior'],
            'view_angles': view_angles,  # Array of all view angles
            'material_categories': material_categories,  # Array of material categories
            'construction_phase': row['construction_phase'],
            'hidden': row['hidden'],
            'favorite': row['favorite'],
            'description': row['description'],
            'material_notes': row['material_notes'],
            'compass_direction': degrees_to_compass(row['image_direction']),
            'is_video': is_video,
            'duration': row['duration'] if is_video else None,
            'photo_taken_at': row['photo_taken_at']
        })

    conn.close()
    return jsonify({'images': images})


@app.route('/image/<int:image_id>')
def serve_image(image_id):
    """Serve image as JPEG. Uses pre-converted web-images if available, otherwise converts on-the-fly."""
    size = request.args.get('size', 'thumb')  # thumb or full

    # Try web-images directory first (production mode)
    if USE_WEB_IMAGES:
        subdir = 'thumb' if size == 'thumb' else 'full'
        web_image_path = os.path.join(WEB_IMAGES_DIR, subdir, f'{image_id}.jpg')
        if os.path.exists(web_image_path):
            return send_file(web_image_path, mimetype='image/jpeg')

    # Fall back to on-the-fly conversion (local dev on macOS)
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT current_path FROM images WHERE id = ?', (image_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        abort(404)

    source_path = os.path.join(PHOTOS_BASE_PATH, row['current_path'])
    if not os.path.exists(source_path):
        abort(404)

    # Check if it's a video - serve thumbnail
    is_video = source_path.lower().endswith(('.mov', '.mp4', '.m4v'))

    if is_video:
        # Try web-images thumb first, then legacy .cache/jpg-preview
        for thumb_path in [
            os.path.join(WEB_IMAGES_DIR, 'thumb', f'{image_id}.jpg'),
            os.path.join(PROJECT_ROOT, '.cache', 'jpg-preview', f'{image_id}.jpg')
        ]:
            if os.path.exists(thumb_path):
                return send_file(thumb_path, mimetype='image/jpeg')
        abort(404)

    # Generate cache key for images
    cache_key = hashlib.md5(f"{source_path}_{size}".encode()).hexdigest()
    cache_path = os.path.join(CACHE_DIR, f"{cache_key}.jpg")

    # Check if cached version exists
    if not os.path.exists(cache_path):
        is_heic = source_path.lower().endswith('.heic')

        # Size limits - local dev shows full resolution, production uses pre-converted
        THUMB_MAX = 300
        FULL_MAX = None if not READ_ONLY else 1600  # No limit locally, capped in production

        max_dim = THUMB_MAX if size == 'thumb' else FULL_MAX

        if is_heic:
            # Use sips for HEIC (ffmpeg can't decode full resolution)
            try:
                cmd = ['sips', '-s', 'format', 'jpeg']
                if max_dim:
                    cmd.extend(['-Z', str(max_dim)])
                cmd.extend([source_path, '--out', cache_path])
                subprocess.run(cmd, check=True, capture_output=True)
            except subprocess.CalledProcessError:
                abort(500)
        else:
            # Use ffmpeg for other formats (JPG, PNG, etc.)
            if max_dim:
                scale_filter = f"scale='min({max_dim},iw)':'min({max_dim},ih)':force_original_aspect_ratio=decrease"
            else:
                scale_filter = None

            try:
                cmd = ['ffmpeg', '-y', '-i', source_path]
                if scale_filter:
                    cmd.extend(['-vf', scale_filter])
                cmd.extend(['-q:v', '2', cache_path])  # High quality JPEG
                subprocess.run(cmd, check=True, capture_output=True)
            except subprocess.CalledProcessError:
                abort(500)

    return send_file(cache_path, mimetype='image/jpeg')


@app.route('/video/<int:image_id>')
def serve_video(image_id):
    """Serve video file for playback. Uses pre-converted web-images if available."""
    # Try web-images directory first (production mode - streaming-ready MP4)
    if USE_WEB_IMAGES:
        web_video_path = os.path.join(WEB_IMAGES_DIR, 'video', f'{image_id}.mp4')
        if os.path.exists(web_video_path):
            return send_file(web_video_path, mimetype='video/mp4')

    # Fall back to original video (local dev)
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT current_path FROM images WHERE id = ?', (image_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        abort(404)

    source_path = os.path.join(PHOTOS_BASE_PATH, row['current_path'])
    if not os.path.exists(source_path):
        abort(404)

    # Determine mimetype
    ext = os.path.splitext(source_path)[1].lower()
    mimetypes = {'.mov': 'video/quicktime', '.mp4': 'video/mp4', '.m4v': 'video/x-m4v'}
    mimetype = mimetypes.get(ext, 'video/mp4')

    return send_file(source_path, mimetype=mimetype)


@app.route('/api/images/<int:image_id>/room', methods=['POST'])
def update_room(image_id):
    """Update room classification for an image. Accepts single room or array of rooms."""
    if err := check_read_only(): return err
    data = request.get_json()
    rooms = data.get('rooms', [])

    # Support both single room and array of rooms
    if not rooms and data.get('room'):
        rooms = [data.get('room')]

    conn = get_db()
    cursor = conn.cursor()

    # Mark as human verified
    cursor.execute('''UPDATE images SET human_verified = 1, verified_at = datetime('now')
                      WHERE id = ?''', (image_id,))

    # Update image_rooms junction table with all rooms
    cursor.execute('DELETE FROM image_rooms WHERE image_id = ?', (image_id,))
    for room in rooms:
        cursor.execute('INSERT INTO image_rooms (image_id, room) VALUES (?, ?)', (image_id, room))

    conn.commit()
    conn.close()

    return jsonify({'success': True, 'rooms': rooms})


@app.route('/api/images/<int:image_id>/view_angles', methods=['POST'])
def update_view_angles(image_id):
    """Update view angle classification for an exterior image. Accepts array of view angles."""
    if err := check_read_only(): return err
    data = request.get_json()
    view_angles = data.get('view_angles', [])

    conn = get_db()
    cursor = conn.cursor()

    # Mark as human verified
    cursor.execute('''UPDATE images SET human_verified = 1, verified_at = datetime('now')
                      WHERE id = ?''', (image_id,))

    # Update image_view_angles junction table with all view angles
    cursor.execute('DELETE FROM image_view_angles WHERE image_id = ?', (image_id,))
    for angle in view_angles:
        cursor.execute('INSERT INTO image_view_angles (image_id, view_angle) VALUES (?, ?)', (image_id, angle))

    conn.commit()
    conn.close()

    return jsonify({'success': True, 'view_angles': view_angles})


@app.route('/api/all_rooms')
def get_all_rooms():
    """Get list of all valid room names from the database."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT DISTINCT room FROM image_rooms WHERE room IS NOT NULL ORDER BY room')
    rooms = [row['room'] for row in cursor.fetchall()]
    return jsonify({'rooms': rooms})


@app.route('/api/construction_phases')
def get_construction_phases():
    """Get list of construction phases with counts."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT construction_phase, COUNT(*) as count
        FROM images
        WHERE construction_phase IS NOT NULL AND construction_phase != ''
        GROUP BY construction_phase
        ORDER BY MIN(photo_taken_at)
    ''')
    phases = [{'name': row['construction_phase'], 'count': row['count']} for row in cursor.fetchall()]
    conn.close()
    return jsonify({'phases': phases})


@app.route('/api/months')
def get_months():
    """Get list of months with image counts."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT strftime('%Y-%m', photo_taken_at) as month, COUNT(*) as count
        FROM images
        WHERE photo_taken_at IS NOT NULL AND hidden = 0
        GROUP BY month
        ORDER BY month
    ''')
    month_names = {
        '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr',
        '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Aug',
        '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec'
    }
    months = []
    for row in cursor.fetchall():
        if row['month']:
            year, month_num = row['month'].split('-')
            short_year = year[2:]  # Get last 2 digits of year
            month_name = month_names.get(month_num, month_num)
            months.append({
                'value': row['month'],
                'name': f"{month_name} '{short_year}",
                'count': row['count']
            })
    conn.close()
    return jsonify({'months': months})


@app.route('/api/date_range')
def get_date_range():
    """Get min and max dates for photos."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT MIN(date(photo_taken_at)) as min_date, MAX(date(photo_taken_at)) as max_date
        FROM images
        WHERE photo_taken_at IS NOT NULL
    ''')
    row = cursor.fetchone()
    conn.close()
    return jsonify({
        'min_date': row['min_date'],
        'max_date': row['max_date']
    })


@app.route('/api/images/<int:image_id>/phase', methods=['POST'])
def update_phase(image_id):
    """Update construction phase for an image."""
    if err := check_read_only(): return err
    data = request.get_json()
    new_phase = data.get('phase')

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''UPDATE images SET construction_phase = ?, human_verified = 1, verified_at = datetime('now')
                      WHERE id = ?''', (new_phase, image_id))
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'phase': new_phase})


@app.route('/api/images/bulk', methods=['POST'])
def bulk_update():
    """Bulk update category, room, phase, view_angle, materials, and/or hidden for multiple images."""
    if err := check_read_only(): return err
    data = request.get_json()
    image_ids = data.get('ids', [])
    new_category = data.get('category')  # interior, exterior, or materials
    new_room = data.get('room')
    new_rooms = data.get('rooms', [])  # Support adding multiple rooms
    new_phase = data.get('phase')
    new_view_angle = data.get('view_angle')
    new_view_angles = data.get('view_angles', [])  # Support adding multiple view angles
    new_material_ids = data.get('material_ids', [])  # Support adding multiple materials
    set_hidden = data.get('hidden')  # True/False or None

    if not image_ids:
        return jsonify({'error': 'No images selected'}), 400

    conn = get_db()
    cursor = conn.cursor()

    updated = 0
    for image_id in image_ids:
        if new_category:
            cursor.execute('UPDATE images SET interior_exterior = ? WHERE id = ?', (new_category, image_id))
        if new_room:
            cursor.execute('UPDATE images SET room = ? WHERE id = ?', (new_room, image_id))
            cursor.execute('DELETE FROM image_rooms WHERE image_id = ?', (image_id,))
            cursor.execute('INSERT INTO image_rooms (image_id, room) VALUES (?, ?)', (image_id, new_room))
        if new_rooms:
            # Add rooms without removing existing ones
            for room in new_rooms:
                cursor.execute('INSERT OR IGNORE INTO image_rooms (image_id, room) VALUES (?, ?)', (image_id, room))
            # Update images.room to first room if not set
            cursor.execute('UPDATE images SET room = COALESCE(room, ?) WHERE id = ? AND (room IS NULL OR room = "")', (new_rooms[0], image_id))
        if new_phase:
            cursor.execute('UPDATE images SET construction_phase = ? WHERE id = ?', (new_phase, image_id))
        if new_view_angle:
            cursor.execute('DELETE FROM image_view_angles WHERE image_id = ?', (image_id,))
            cursor.execute('INSERT INTO image_view_angles (image_id, view_angle) VALUES (?, ?)', (image_id, new_view_angle))
        if new_view_angles:
            # Add view angles without removing existing ones
            for angle in new_view_angles:
                cursor.execute('INSERT OR IGNORE INTO image_view_angles (image_id, view_angle) VALUES (?, ?)', (image_id, angle))
        if new_material_ids:
            # Add materials without removing existing ones
            for material_id in new_material_ids:
                cursor.execute('INSERT OR IGNORE INTO image_materials (image_id, material_id) VALUES (?, ?)', (image_id, material_id))
        if set_hidden is not None:
            cursor.execute('UPDATE images SET hidden = ? WHERE id = ?', (1 if set_hidden else 0, image_id))
        # Mark as human verified
        cursor.execute('''UPDATE images SET human_verified = 1, verified_at = datetime('now')
                          WHERE id = ?''', (image_id,))
        updated += 1

    conn.commit()
    conn.close()

    return jsonify({'success': True, 'updated': updated})


@app.route('/api/view_angles')
def get_view_angles():
    """Get list of view angles with counts for exterior images."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT iva.view_angle, COUNT(*) as count
        FROM image_view_angles iva
        JOIN images i ON iva.image_id = i.id
        WHERE i.interior_exterior = 'exterior'
        GROUP BY iva.view_angle
        ORDER BY iva.view_angle
    ''')
    angles = [{'name': row['view_angle'], 'count': row['count']} for row in cursor.fetchall()]

    # Add unclassified count (exterior images with no view angles)
    cursor.execute('''
        SELECT COUNT(*) as count
        FROM images i
        WHERE i.interior_exterior = 'exterior'
        AND NOT EXISTS (SELECT 1 FROM image_view_angles iva WHERE iva.image_id = i.id)
    ''')
    unclassified_count = cursor.fetchone()['count']
    if unclassified_count > 0:
        angles.append({'name': 'unclassified', 'count': unclassified_count})

    conn.close()
    return jsonify({'view_angles': angles})


@app.route('/api/all_view_angles')
def get_all_view_angles():
    """Get list of all valid view angle names from the database."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT DISTINCT view_angle FROM image_view_angles WHERE view_angle IS NOT NULL ORDER BY view_angle')
    angles = [row['view_angle'] for row in cursor.fetchall()]
    return jsonify({'view_angles': angles})


@app.route('/api/material_categories')
def get_material_categories():
    """Get list of material categories with image counts (across all images with linked materials)."""
    conn = get_db()
    cursor = conn.cursor()

    # Get categories from materials table that have associated images
    cursor.execute('''
        SELECT m.category, COUNT(DISTINCT im.image_id) as count
        FROM materials m
        JOIN image_materials im ON m.id = im.material_id
        GROUP BY m.category
        ORDER BY m.category
    ''')
    categories = [{'name': row['category'], 'count': row['count']} for row in cursor.fetchall()]

    conn.close()
    return jsonify({'categories': categories})


@app.route('/api/all_material_categories')
def get_all_material_categories():
    """Get list of all material category names from the database."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT DISTINCT category FROM materials WHERE category IS NOT NULL ORDER BY CASE WHEN category = \'labels\' THEN 0 ELSE 1 END, category')
    categories = [row['category'] for row in cursor.fetchall()]
    return jsonify({'categories': categories})


@app.route('/api/all_materials')
def get_all_materials():
    """Get all materials grouped by category."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, category, name, manufacturer
        FROM materials
        ORDER BY CASE WHEN category = 'labels' THEN 0 ELSE 1 END, category, name
    ''')

    materials_by_category = {}
    for row in cursor.fetchall():
        cat = row['category'] or 'uncategorized'
        if cat not in materials_by_category:
            materials_by_category[cat] = []
        materials_by_category[cat].append({
            'id': row['id'],
            'name': row['name'],
            'manufacturer': row['manufacturer']
        })

    conn.close()
    return jsonify({'materials': materials_by_category})


@app.route('/api/images/<int:image_id>/view_angle', methods=['POST'])
def update_view_angle(image_id):
    """Update view angle(s) for an image. Accepts single view_angle or array of view_angles."""
    if err := check_read_only(): return err
    data = request.get_json()
    view_angles = data.get('view_angles', [])

    # Support both single view_angle and array of view_angles
    if not view_angles and data.get('view_angle'):
        view_angles = [data.get('view_angle')]

    conn = get_db()
    cursor = conn.cursor()

    # Mark as human verified
    cursor.execute('''UPDATE images SET human_verified = 1, verified_at = datetime('now')
                      WHERE id = ?''', (image_id,))

    # Update image_view_angles junction table with all view angles
    cursor.execute('DELETE FROM image_view_angles WHERE image_id = ?', (image_id,))
    for angle in view_angles:
        cursor.execute('INSERT INTO image_view_angles (image_id, view_angle) VALUES (?, ?)', (image_id, angle))

    conn.commit()
    conn.close()

    return jsonify({'success': True, 'view_angles': view_angles})


@app.route('/api/images/<int:image_id>/materials', methods=['POST'])
def update_image_materials(image_id):
    """Update materials for an image. Accepts material_ids (specific) or categories (all in category)."""
    if err := check_read_only(): return err
    data = request.get_json()
    material_ids = data.get('material_ids', [])
    categories = data.get('categories', [])

    conn = get_db()
    cursor = conn.cursor()

    # Delete existing material links for this image
    cursor.execute('DELETE FROM image_materials WHERE image_id = ?', (image_id,))

    # Add links for specific material IDs
    for mid in material_ids:
        cursor.execute('INSERT OR IGNORE INTO image_materials (image_id, material_id) VALUES (?, ?)',
                      (image_id, mid))

    # Add links based on categories (legacy support)
    for category in categories:
        cursor.execute('SELECT id FROM materials WHERE category = ?', (category,))
        for row in cursor.fetchall():
            cursor.execute('INSERT OR IGNORE INTO image_materials (image_id, material_id) VALUES (?, ?)',
                          (image_id, row['id']))

    # Mark as human verified
    cursor.execute('''UPDATE images SET human_verified = 1, verified_at = datetime('now')
                      WHERE id = ?''', (image_id,))

    conn.commit()
    conn.close()

    return jsonify({'success': True, 'material_ids': material_ids})


@app.route('/api/materials/<int:material_id>')
def get_material(material_id):
    """Get details for a single material."""
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('''
        SELECT m.id, m.category, m.name, m.manufacturer, m.model, m.color,
               m.specs, m.location, m.purchase_info, m.notes, m.url
        FROM materials m
        WHERE m.id = ?
    ''', (material_id,))
    row = cursor.fetchone()

    if not row:
        conn.close()
        return jsonify({'error': 'Material not found'}), 404

    # Count linked images
    cursor.execute('SELECT COUNT(*) as count FROM image_materials WHERE material_id = ?', (material_id,))
    image_count = cursor.fetchone()['count']

    material = {
        'id': row['id'],
        'category': row['category'],
        'name': row['name'],
        'manufacturer': row['manufacturer'],
        'model': row['model'],
        'color': row['color'],
        'location': row['location'],
        'notes': row['notes'],
        'url': row['url'],
        'image_count': image_count
    }
    # Parse specs JSON if present
    if row['specs']:
        try:
            import json
            material['specs'] = json.loads(row['specs'])
        except:
            material['specs'] = row['specs']
    # Parse purchase_info JSON if present
    if row['purchase_info']:
        try:
            import json
            material['purchase_info'] = json.loads(row['purchase_info'])
        except:
            material['purchase_info'] = row['purchase_info']

    conn.close()
    return jsonify({'material': material})


@app.route('/api/images/<int:image_id>/material_details')
def get_image_material_details(image_id):
    """Get full material details for materials linked to an image."""
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('''
        SELECT m.id, m.category, m.name, m.manufacturer, m.model, m.color,
               m.specs, m.location, m.purchase_info, m.notes, m.url
        FROM materials m
        JOIN image_materials im ON m.id = im.material_id
        WHERE im.image_id = ?
        ORDER BY m.category, m.name
    ''', (image_id,))

    materials = []
    for row in cursor.fetchall():
        material = {
            'id': row['id'],
            'category': row['category'],
            'name': row['name'],
            'manufacturer': row['manufacturer'],
            'model': row['model'],
            'color': row['color'],
            'location': row['location'],
            'notes': row['notes'],
            'url': row['url']
        }
        # Parse specs JSON if present
        if row['specs']:
            try:
                import json
                material['specs'] = json.loads(row['specs'])
            except:
                material['specs'] = row['specs']
        # Parse purchase_info JSON if present
        if row['purchase_info']:
            try:
                import json
                material['purchase_info'] = json.loads(row['purchase_info'])
            except:
                material['purchase_info'] = row['purchase_info']
        materials.append(material)

    conn.close()
    return jsonify({'materials': materials})


@app.route('/api/images/<int:image_id>/transcription')
def get_video_transcription(image_id):
    """Get transcription, summary, and segments for a video."""
    conn = get_db()
    cursor = conn.cursor()

    # Get transcription and summary
    cursor.execute('''
        SELECT transcription, summary, transcription_json
        FROM video_transcriptions WHERE image_id = ?
    ''', (image_id,))
    row = cursor.fetchone()

    # Get segments
    cursor.execute('''
        SELECT segment_type, segment_value, start_time, end_time, description, confidence
        FROM video_segments WHERE image_id = ?
        ORDER BY start_time
    ''', (image_id,))
    segments = [dict(row) for row in cursor.fetchall()]

    conn.close()

    if not row:
        return jsonify({'transcription': None, 'summary': None, 'segments': [], 'whisper_segments': []})

    # Parse whisper segments for search functionality
    whisper_segments = []
    if row['transcription_json']:
        import json
        try:
            data = json.loads(row['transcription_json'])
            whisper_segments = [
                {'start': s['start'], 'end': s['end'], 'text': s['text'].strip()}
                for s in data.get('segments', []) if s.get('text', '').strip()
            ]
        except:
            pass

    return jsonify({
        'transcription': row['transcription'],
        'summary': row['summary'],
        'has_timestamps': row['transcription_json'] is not None,
        'segments': segments,
        'whisper_segments': whisper_segments
    })


@app.route('/api/images/<int:image_id>/notes', methods=['POST'])
def update_image_notes(image_id):
    """Update description/notes for an image."""
    if err := check_read_only(): return err
    data = request.get_json()
    description = data.get('description')
    material_notes = data.get('material_notes')

    conn = get_db()
    cursor = conn.cursor()

    if description is not None:
        cursor.execute('UPDATE images SET description = ? WHERE id = ?', (description, image_id))
    if material_notes is not None:
        cursor.execute('UPDATE images SET material_notes = ? WHERE id = ?', (material_notes, image_id))

    cursor.execute('''UPDATE images SET human_verified = 1, verified_at = datetime('now')
                      WHERE id = ?''', (image_id,))
    conn.commit()
    conn.close()

    return jsonify({'success': True})


@app.route('/api/images/<int:image_id>/hidden', methods=['POST'])
def update_hidden(image_id):
    """Toggle hidden status for an image."""
    if err := check_read_only(): return err
    data = request.get_json()
    hidden = 1 if data.get('hidden') else 0

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('UPDATE images SET hidden = ? WHERE id = ?', (hidden, image_id))
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'hidden': hidden})


@app.route('/api/images/<int:image_id>/favorite', methods=['POST'])
def update_favorite(image_id):
    """Toggle favorite status for an image."""
    if err := check_read_only(): return err
    data = request.get_json()
    favorite = 1 if data.get('favorite') else 0

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('UPDATE images SET favorite = ? WHERE id = ?', (favorite, image_id))
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'favorite': favorite})


@app.route('/api/images/<int:image_id>/category', methods=['POST'])
def update_category(image_id):
    """Update category (interior/exterior) for an image."""
    if err := check_read_only(): return err
    data = request.get_json()
    new_category = data.get('category')

    if new_category not in ('interior', 'exterior'):
        return jsonify({'error': 'Invalid category'}), 400

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''UPDATE images SET interior_exterior = ?, human_verified = 1, verified_at = datetime('now')
                      WHERE id = ?''', (new_category, image_id))
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'category': new_category})


if __name__ == '__main__':
    print("Starting Photo Classification Web UI...")
    print(f"Database: {DB_PATH}")
    print("Open http://localhost:5001 in your browser")
    app.run(debug=True, port=5001)
