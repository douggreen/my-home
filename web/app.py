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




@app.route('/api/images')
def get_images():
    """Get images, optionally filtered by location_id, construction_phase, date range, search text, material, or favorites."""
    location_id = request.args.get('location_id')
    phase = request.args.get('phase')
    month = request.args.get('month')  # Format: YYYY-MM
    show_hidden = request.args.get('show_hidden', 'false') == 'true'
    search = request.args.get('search', '').strip()
    videos_only = request.args.get('videos_only', 'false') == 'true'
    favorites_only = request.args.get('favorites_only', 'false') == 'true'
    material_id = request.args.get('material_id')

    conn = get_db()
    cursor = conn.cursor()

    # Build query dynamically
    conditions = []
    params = []
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

    # Filter to favorites only
    if favorites_only:
        conditions.append("i.favorite = 1")

    if phase:
        conditions.append("i.construction_phase = ?")
        params.append(phase)

    if month:
        # Filter by month (format: YYYY-MM)
        conditions.append("strftime('%Y-%m', i.photo_taken_at) = ?")
        params.append(month)

    # Text search across filename, notes, linked material names, video transcripts, and locations
    if search:
        search_pattern = f'%{search}%'
        extra_joins.append("LEFT JOIN image_materials im_search ON i.id = im_search.image_id")
        extra_joins.append("LEFT JOIN materials m_search ON im_search.material_id = m_search.id")
        extra_joins.append("LEFT JOIN video_transcriptions vt_search ON i.id = vt_search.image_id")
        extra_joins.append("LEFT JOIN image_locations il_search ON i.id = il_search.image_id")
        extra_joins.append("LEFT JOIN locations l_search ON il_search.location_id = l_search.id")
        conditions.append("""(
            i.current_path LIKE ? OR
            i.description LIKE ? OR
            i.material_notes LIKE ? OR
            m_search.name LIKE ? OR
            m_search.manufacturer LIKE ? OR
            vt_search.transcription LIKE ? OR
            vt_search.summary LIKE ? OR
            l_search.name LIKE ? OR
            l_search.full_path LIKE ?
        )""")
        params.extend([search_pattern] * 9)

    # Filter by specific material ID
    if material_id:
        conditions.append("EXISTS (SELECT 1 FROM image_materials im WHERE im.image_id = i.id AND im.material_id = ?)")
        params.append(material_id)

    # Filter by location_id (hierarchical location system)
    if location_id:
        # Get all descendant location IDs using recursive query
        cursor.execute('''
            WITH RECURSIVE descendants AS (
                SELECT id FROM locations WHERE id = ?
                UNION ALL
                SELECT l.id FROM locations l
                JOIN descendants d ON l.parent_id = d.id
            )
            SELECT id FROM descendants
        ''', (location_id,))
        location_ids = [row['id'] for row in cursor.fetchall()]

        if location_ids:
            placeholders = ','.join('?' * len(location_ids))
            conditions.append(f"EXISTS (SELECT 1 FROM image_locations il WHERE il.image_id = i.id AND il.location_id IN ({placeholders}))")
            params.extend(location_ids)

    # Build query
    joins = " ".join(extra_joins) if extra_joins else ""
    where_clause = " AND ".join(conditions) if conditions else "1=1"
    query = f'''
        SELECT DISTINCT i.id, i.current_path, i.construction_phase, i.hidden, i.description, i.material_notes, i.image_direction, i.duration, i.photo_taken_at, i.favorite
        FROM images i
        {joins}
        WHERE {where_clause}
        ORDER BY i.photo_taken_at DESC, i.current_path
    '''
    cursor.execute(query, params)

    images = []
    for row in cursor.fetchall():
        filename = os.path.basename(row['current_path'])
        # Get locations for this image
        cursor.execute('''SELECT l.name FROM locations l
                          JOIN image_locations il ON l.id = il.location_id
                          WHERE il.image_id = ?''', (row['id'],))
        locations = [r['name'] for r in cursor.fetchall()]
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
            'locations': locations,
            'material_categories': material_categories,
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






@app.route('/api/locations')
def get_locations():
    """Get hierarchical location tree with image counts."""
    conn = get_db()
    cursor = conn.cursor()

    # Get all locations with their image counts
    cursor.execute('''
        SELECT l.id, l.name, l.parent_id, l.full_path, l.sort_order,
               COUNT(il.image_id) as image_count
        FROM locations l
        LEFT JOIN image_locations il ON l.id = il.location_id
        GROUP BY l.id
        ORDER BY l.sort_order, l.name
    ''')

    locations = {}
    for row in cursor.fetchall():
        locations[row['id']] = {
            'id': row['id'],
            'name': row['name'],
            'parent_id': row['parent_id'],
            'full_path': row['full_path'],
            'count': row['image_count'],
            'children': []
        }

    # Build tree structure
    root_locations = []
    for loc_id, loc in locations.items():
        parent_id = loc['parent_id']
        if parent_id is None:
            root_locations.append(loc)
        elif parent_id in locations:
            locations[parent_id]['children'].append(loc)

    # Calculate cumulative counts (include children's counts in parent)
    def calc_cumulative_count(loc):
        total = loc['count']
        for child in loc['children']:
            total += calc_cumulative_count(child)
        loc['cumulative_count'] = total
        return total

    for root in root_locations:
        calc_cumulative_count(root)

    conn.close()
    return jsonify({'locations': root_locations})


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
    """Bulk update phase, locations, materials, and/or hidden for multiple images."""
    if err := check_read_only(): return err
    data = request.get_json()
    image_ids = data.get('ids', [])
    new_phase = data.get('phase')
    new_location_ids = data.get('location_ids', [])
    new_material_ids = data.get('material_ids', [])
    set_hidden = data.get('hidden')

    if not image_ids:
        return jsonify({'error': 'No images selected'}), 400

    conn = get_db()
    cursor = conn.cursor()

    updated = 0
    for image_id in image_ids:
        if new_phase:
            cursor.execute('UPDATE images SET construction_phase = ? WHERE id = ?', (new_phase, image_id))
        if new_location_ids:
            # Add locations without removing existing ones
            for loc_id in new_location_ids:
                cursor.execute('INSERT OR IGNORE INTO image_locations (image_id, location_id) VALUES (?, ?)', (image_id, loc_id))
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




@app.route('/api/all_materials')
def get_all_materials():
    """Get all materials grouped by category, with image counts. Only returns materials with at least one linked image."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT m.id, m.category, m.name, m.manufacturer, COUNT(im.image_id) as image_count
        FROM materials m
        JOIN image_materials im ON m.id = im.material_id
        GROUP BY m.id
        HAVING image_count > 0
        ORDER BY CASE WHEN m.category = 'labels' THEN 0 ELSE 1 END, m.category, m.name
    ''')

    materials_by_category = {}
    for row in cursor.fetchall():
        cat = row['category'] or 'uncategorized'
        if cat not in materials_by_category:
            materials_by_category[cat] = []
        materials_by_category[cat].append({
            'id': row['id'],
            'name': row['name'],
            'manufacturer': row['manufacturer'],
            'count': row['image_count']
        })

    conn.close()
    return jsonify({'materials': materials_by_category})




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

    # Get segments (join with locations for location segments)
    cursor.execute('''
        SELECT vs.segment_type,
               CASE WHEN vs.segment_type = 'location' THEN l.name ELSE vs.segment_value END as segment_value,
               vs.start_time, vs.end_time, vs.description, vs.confidence, vs.location_id,
               l.full_path as location_path
        FROM video_segments vs
        LEFT JOIN locations l ON vs.location_id = l.id
        WHERE vs.image_id = ?
        ORDER BY vs.start_time
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




@app.route('/api/images/<int:image_id>/locations', methods=['GET'])
def get_image_locations(image_id):
    """Get location IDs for an image."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT location_id FROM image_locations WHERE image_id = ?', (image_id,))
    location_ids = [row['location_id'] for row in cursor.fetchall()]
    conn.close()
    return jsonify({'location_ids': location_ids})


@app.route('/api/images/<int:image_id>/locations', methods=['POST'])
def update_image_locations(image_id):
    """Update locations for an image."""
    if err := check_read_only(): return err
    data = request.get_json()
    location_ids = data.get('location_ids', [])

    conn = get_db()
    cursor = conn.cursor()

    # Delete existing location links for this image
    cursor.execute('DELETE FROM image_locations WHERE image_id = ?', (image_id,))

    # Add new location links
    for loc_id in location_ids:
        cursor.execute('INSERT OR IGNORE INTO image_locations (image_id, location_id) VALUES (?, ?)',
                      (image_id, loc_id))

    # Mark as human verified
    cursor.execute('''UPDATE images SET human_verified = 1, verified_at = datetime('now')
                      WHERE id = ?''', (image_id,))

    conn.commit()
    conn.close()

    return jsonify({'success': True, 'location_ids': location_ids})


if __name__ == '__main__':
    print("Starting Photo Classification Web UI...")
    print(f"Database: {DB_PATH}")
    print("Open http://localhost:5001 in your browser")
    app.run(debug=True, port=5001)
