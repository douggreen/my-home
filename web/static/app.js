// Photo Classification Web UI - JavaScript

let currentImages = [];
let currentIndex = 0;

// Strip file extension from filename for display
function displayName(filename) {
    return filename ? filename.replace(/\.[^.]+$/, '') : '';
}

// Mobile filter toggle
function toggleFilters() {
    document.querySelector('.filter-bar').classList.toggle('filters-open');
}

function closeFiltersOnMobile() {
    if (window.innerWidth <= 768) {
        document.querySelector('.filter-bar').classList.remove('filters-open');
    }
}

let allPhases = [];
let allMaterials = {};  // Materials grouped by category
let allLocations = [];  // Hierarchical location tree
let currentMaterialId = null;
let currentMaterialName = null;
let currentLocationId = null;
let currentLocationName = 'All Locations';
let selectedIds = new Set();
let searchTimeout = null;

// Read-only mode state
let isReadOnly = false;
let showEditControlsInReadOnly = false;

// Check server read-only status
async function checkReadOnlyStatus() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();
        isReadOnly = data.read_only;

        if (isReadOnly) {
            // Show the toggle option
            document.getElementById('readonlyToggle').style.display = 'block';
            // Hide edit controls by default
            updateEditControlsVisibility();
        }
    } catch (error) {
        console.error('Error checking read-only status:', error);
    }
}

// Toggle edit controls visibility in read-only mode
function toggleEditControls() {
    const mode = document.getElementById('readonlyMode').value;
    showEditControlsInReadOnly = (mode === 'demo');
    updateEditControlsVisibility();
}

// Update visibility of edit controls based on read-only state
function updateEditControlsVisibility() {
    const shouldHide = isReadOnly && !showEditControlsInReadOnly;
    document.body.classList.toggle('readonly-mode', shouldHide);
}

// Show read-only message when attempting edits
function showReadOnlyMessage() {
    alert('This site is in read-only mode. Editing features are shown for demonstration purposes only. All changes are made locally and synced to the server.');
    return false;
}

// Wrapper for edit operations - returns true if operation should proceed
function canEdit() {
    if (!isReadOnly) return true;
    showReadOnlyMessage();
    return false;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    // Default to XS size on mobile if user hasn't selected
    if (window.innerWidth <= 768) {
        const sizeSelect = document.getElementById('sizeSelect');
        if (sizeSelect && sizeSelect.value === 'md') {  // 'md' is the default
            sizeSelect.value = 'xs';
            document.getElementById('imageGrid').classList.remove('size-md');
            document.getElementById('imageGrid').classList.add('size-xs');
        }
    }

    checkReadOnlyStatus();
    loadAllMaterials();
    loadLocations();  // Load hierarchical locations for filter
    loadConstructionPhases();
    loadMonths();
    loadImages();  // Initial load without location filter

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (document.getElementById('modal').classList.contains('active')) {
            if (e.key === 'Escape') closeModal();
            if (e.key === 'ArrowLeft') navigateImage(-1);
            if (e.key === 'ArrowRight') navigateImage(1);
        }
    });

    // Click outside modal to close
    document.getElementById('modal').addEventListener('click', (e) => {
        if (e.target.id === 'modal') closeModal();
    });

    // Click outside dropdowns to close them
    document.addEventListener('click', (e) => {
        const materialsDropdown = document.getElementById('materialsDropdown');

        // Check if click is outside the materials dropdown and its button
        if (materialsDropdown && materialsDropdown.classList.contains('active')) {
            const materialsContainer = materialsDropdown.closest('.multiselect-container');
            if (!materialsContainer || !materialsContainer.contains(e.target)) {
                materialsDropdown.classList.remove('active');
            }
        }
    });

});

// Format kebab-case names to human readable (e.g., "primary-bathroom" -> "Primary Bathroom")
function formatLabel(name) {
    if (!name) return '';
    return name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}


// Populate the materials filter dropdown with specific materials
function populateMaterialsFilterDropdown() {
    const container = document.getElementById('materialsFilterOptions');
    if (!container) return;

    let html = '<label class="filter-option" onclick="selectMaterialFilter(\'\', \'All Materials\')"><span>All Materials</span></label>';
    const sortedCategories = Object.keys(allMaterials).sort();

    for (const category of sortedCategories) {
        const materials = allMaterials[category];
        html += `<div class="multiselect-category">${category}</div>`;

        for (const mat of materials) {
            const displayName = `${mat.name} (${mat.count})`;
            html += `<label class="filter-option" onclick="selectMaterialFilter(${mat.id}, '${mat.name.replace(/'/g, "\\'")}')">
                <span>${displayName}</span>
            </label>`;
        }
    }
    container.innerHTML = html;
}

// Toggle filter dropdown in the filter bar
function toggleFilterDropdown(dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;

    const isActive = dropdown.classList.contains('active');

    // Close all filter dropdowns
    document.querySelectorAll('.filter-dropdown').forEach(d => d.classList.remove('active'));

    if (!isActive) {
        dropdown.classList.add('active');
        // Clear and focus search input
        const searchInput = dropdown.querySelector('.multiselect-search');
        if (searchInput) {
            searchInput.value = '';
            // Use appropriate filter function based on dropdown type
            if (dropdownId === 'locationFilterDropdown') {
                filterLocationsList('');
            } else {
                filterMaterialsList('', dropdownId.replace('Dropdown', 'Options'));
            }
            setTimeout(() => searchInput.focus(), 10);
        }
    }
}

// Select a material from the filter dropdown
function selectMaterialFilter(materialId, displayName) {
    currentMaterialId = materialId || null;
    currentMaterialName = displayName;

    // Update button text
    const btn = document.getElementById('materialsFilterBtn');
    if (btn) {
        btn.textContent = displayName;
    }

    // Close dropdown
    document.getElementById('materialsFilterDropdown').classList.remove('active');

    // Apply filters
    applyFilters();
}

// Close filter dropdowns when clicking outside
document.addEventListener('click', function(e) {
    if (!e.target.closest('.filter-dropdown-container')) {
        document.querySelectorAll('.filter-dropdown').forEach(d => d.classList.remove('active'));
    }
});

// Load hierarchical locations for filter dropdown
async function loadLocations() {
    try {
        const response = await fetch('/api/locations');
        const data = await response.json();
        allLocations = data.locations;
        populateLocationDropdown();
    } catch (error) {
        console.error('Error loading locations:', error);
    }
}

// Populate location filter dropdown with hierarchical structure
function populateLocationDropdown() {
    const container = document.getElementById('locationFilterOptions');
    if (!container) return;

    let html = '<div class="location-item level-0" onclick="selectLocation(null, \'All Locations\')">All Locations</div>';

    function renderLocation(loc, level) {
        const count = loc.cumulative_count || loc.count || 0;
        html += `<div class="location-item level-${level}" onclick="selectLocation(${loc.id}, '${loc.full_path.replace(/'/g, "\\'")}')">
            ${loc.name}<span class="location-count">(${count})</span>
        </div>`;
        if (loc.children && loc.children.length > 0) {
            loc.children.forEach(child => renderLocation(child, level + 1));
        }
    }

    allLocations.forEach(loc => renderLocation(loc, 0));
    container.innerHTML = html;
}

// Filter locations list by search term
function filterLocationsList(searchTerm) {
    const container = document.getElementById('locationFilterOptions');
    if (!container) return;

    const items = container.querySelectorAll('.location-item');
    const term = searchTerm.toLowerCase();

    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(term) ? '' : 'none';
    });
}

// Select a location from the filter dropdown
function selectLocation(locationId, displayName) {
    currentLocationId = locationId;
    currentLocationName = displayName;

    // Update button text - show short name for display
    const btn = document.getElementById('locationFilterBtn');
    if (btn) {
        // Show just the last part of the path for the button
        const shortName = displayName.includes('/') ? displayName.split('/').pop() : displayName;
        btn.textContent = shortName;
    }

    // Update header
    document.getElementById('currentLocationHeader').textContent = displayName.includes('/') ? displayName.split('/').pop() : displayName;

    // Close dropdown
    document.getElementById('locationFilterDropdown').classList.remove('active');

    // Apply filters
    applyFilters();
}

// Toggle bulk phase dropdown
function toggleBulkPhaseDropdown() {
    const dropdown = document.getElementById('bulkPhaseDropdown');
    const isOpening = !dropdown.classList.contains('active');

    // Close other dropdowns
    document.getElementById('bulkLocationsDropdown')?.classList.remove('active');
    document.getElementById('bulkMaterialsDropdown')?.classList.remove('active');

    // Populate phases if opening
    if (isOpening) {
        const options = document.getElementById('bulkPhaseOptions');
        let html = '<label><input type="radio" name="bulkPhase" value=""> <span>(None)</span></label>';
        allPhases.forEach(phase => {
            html += `<label><input type="radio" name="bulkPhase" value="${phase.name}"> <span>${formatLabel(phase.name)}</span></label>`;
        });
        options.innerHTML = html;
    }

    dropdown.classList.toggle('active');
}

// Toggle bulk materials dropdown visibility
function toggleBulkMaterialsDropdown() {
    const dropdown = document.getElementById('bulkMaterialsDropdown');
    const isOpening = !dropdown.classList.contains('active');

    // Close other dropdowns
    document.getElementById('bulkLocationsDropdown')?.classList.remove('active');
    document.getElementById('bulkPhaseDropdown')?.classList.remove('active');

    // Populate materials if opening
    if (isOpening) {
        const options = document.getElementById('bulkMaterialsOptions');
        let html = '';
        const sortedCategories = Object.keys(allMaterials).sort();
        for (const category of sortedCategories) {
            html += `<div class="multiselect-category">${category}</div>`;
            for (const mat of allMaterials[category]) {
                html += `<label><input type="checkbox" value="${mat.id}"> <span>${mat.name}</span></label>`;
            }
        }
        options.innerHTML = html;

        // Clear and focus search input
        const searchInput = document.getElementById('bulkMaterialsSearch');
        if (searchInput) {
            searchInput.value = '';
            setTimeout(() => searchInput.focus(), 10);
        }
    }

    dropdown.classList.toggle('active');
}

// Close dropdowns when clicking outside
document.addEventListener('click', function(e) {
    if (!e.target.closest('.multiselect-container')) {
        document.getElementById('bulkLocationsDropdown')?.classList.remove('active');
        document.getElementById('bulkMaterialsDropdown')?.classList.remove('active');
            document.getElementById('bulkPhaseDropdown')?.classList.remove('active');
    }
});



// Load construction phases
async function loadConstructionPhases() {
    try {
        const response = await fetch('/api/construction_phases');
        const data = await response.json();
        allPhases = data.phases;

        // Update filter dropdown
        const filterSelect = document.getElementById('phaseFilter');
        filterSelect.innerHTML = '<option value="">All Phases</option>' +
            allPhases.map(p => `<option value="${p.name}">${p.name} (${p.count})</option>`).join('');
    } catch (error) {
        console.error('Error loading phases:', error);
    }
}

async function loadMonths() {
    try {
        const response = await fetch('/api/months');
        const data = await response.json();

        const filterSelect = document.getElementById('monthFilter');
        filterSelect.innerHTML = '<option value="">All Dates</option>' +
            data.months.map(m => `<option value="${m.value}">${m.name} (${m.count})</option>`).join('');
    } catch (error) {
        console.error('Error loading months:', error);
    }
}



// Debounce search input to avoid too many requests
function debounceSearch() {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        applyFilters();
    }, 300);
}

// Apply filters and load images
function applyFilters() {
    const phase = document.getElementById('phaseFilter').value;
    const month = document.getElementById('monthFilter').value;
    const showHidden = document.getElementById('showHidden').checked;
    const search = document.getElementById('searchInput').value;
    const videosOnly = document.getElementById('videosOnly').checked;
    const favoritesOnly = document.getElementById('favoritesOnly')?.checked || false;

    loadImages(phase, month, showHidden, search, videosOnly, currentMaterialId, currentLocationId, favoritesOnly);
    closeFiltersOnMobile();
}

// Clear all filters
function clearFilters() {
    document.getElementById('searchInput').value = '';
    document.getElementById('phaseFilter').value = '';
    document.getElementById('monthFilter').value = '';
    document.getElementById('showHidden').checked = false;
    document.getElementById('videosOnly').checked = false;
    if (document.getElementById('favoritesOnly')) {
        document.getElementById('favoritesOnly').checked = false;
    }
    currentMaterialId = null;
    currentMaterialName = null;
    currentLocationId = null;
    currentLocationName = 'All Locations';
    // Reset materials filter button text
    const materialsFilterBtn = document.getElementById('materialsFilterBtn');
    if (materialsFilterBtn) {
        materialsFilterBtn.textContent = 'All Materials';
    }
    // Reset location filter button text
    const locationFilterBtn = document.getElementById('locationFilterBtn');
    if (locationFilterBtn) {
        locationFilterBtn.textContent = 'All Locations';
    }
    document.getElementById('currentLocationHeader').textContent = 'All Locations';
    applyFilters();
}

// Toggle filter visibility based on current view
function updateFilterVisibility() {
    // With the new location filter, we always show the materials filter
    const materialsFilterGroup = document.getElementById('materialsFilterGroup');
    if (materialsFilterGroup) {
        materialsFilterGroup.style.display = 'flex';
    }
}

// Load images with filters
async function loadImages(phase = '', month = '', showHidden = false, search = '', videosOnly = false, materialId = null, locationId = null, favoritesOnly = false) {
    const grid = document.getElementById('imageGrid');
    grid.innerHTML = '<div class="loading">Loading images...</div>';

    // Clear selection when loading new images
    selectedIds.clear();
    updateSelectionToolbar();

    // Update filter visibility based on location
    updateFilterVisibility();

    try {
        let url = '/api/images?';
        const params = [];

        if (locationId) params.push(`location_id=${locationId}`);
        if (phase) params.push(`phase=${encodeURIComponent(phase)}`);
        if (month) params.push(`month=${encodeURIComponent(month)}`);
        if (showHidden) params.push('show_hidden=true');
        if (search) params.push(`search=${encodeURIComponent(search)}`);
        if (videosOnly) params.push('videos_only=true');
        if (materialId) params.push(`material_id=${materialId}`);
        if (favoritesOnly) params.push('favorites_only=true');

        url += params.join('&');

        const response = await fetch(url);
        const data = await response.json();

        currentImages = data.images;
        document.getElementById('imageCount').textContent = `${currentImages.length} images`;

        if (currentImages.length === 0) {
            grid.innerHTML = '<div class="loading">No images found</div>';
            return;
        }

        grid.innerHTML = currentImages.map((img, index) => {
            // Display locations
            const locations = img.locations || [];
            const displayLabel = locations.length > 0 ? locations.map(formatLabel).join(', ') : '';
            // Format duration for videos
            let durationLabel = '';
            if (img.is_video && img.duration) {
                const mins = Math.floor(img.duration / 60);
                const secs = Math.floor(img.duration % 60);
                durationLabel = `${mins}:${secs.toString().padStart(2, '0')}`;
            }
            return `
            <div class="image-card" data-id="${img.id}" data-index="${index}">
                <div class="image-checkbox" onclick="toggleSelect(event, ${img.id})"></div>
                <div class="image-favorite ${img.favorite ? 'active' : ''}" onclick="toggleFavorite(event, ${img.id})" title="Favorite">♥</div>
                <div class="image-wrapper" onclick="openModal(${index})">
                    <img src="/image/${img.id}?size=thumb" alt="${displayName(img.filename)}" loading="lazy">
                    ${img.is_video ? `<div class="video-overlay"><span class="play-icon">▶</span>${durationLabel ? `<span class="video-duration">${durationLabel}</span>` : ''}</div>` : ''}
                </div>
                <div class="image-info" onclick="openModal(${index})">
                    <div class="image-filename">${displayName(img.filename)}</div>
                    <div class="image-location">${displayLabel}</div>
                    ${img.construction_phase ? `<div class="image-phase">${img.construction_phase}</div>` : ''}
                </div>
            </div>
        `}).join('');
    } catch (error) {
        console.error('Error loading images:', error);
        grid.innerHTML = '<div class="loading">Error loading images</div>';
    }
}

// Toggle image selection
function toggleSelect(event, imageId) {
    event.stopPropagation();
    const card = document.querySelector(`.image-card[data-id="${imageId}"]`);
    const checkbox = card.querySelector('.image-checkbox');

    if (selectedIds.has(imageId)) {
        selectedIds.delete(imageId);
        card.classList.remove('selected');
        checkbox.classList.remove('selected');
        checkbox.textContent = '';
    } else {
        selectedIds.add(imageId);
        card.classList.add('selected');
        checkbox.classList.add('selected');
        checkbox.textContent = '✓';
    }

    updateSelectionToolbar();
}

// Toggle favorite status
async function toggleFavorite(event, imageId) {
    event.stopPropagation();
    if (!canEdit()) return;

    const card = document.querySelector(`.image-card[data-id="${imageId}"]`);
    const heartEl = card.querySelector('.image-favorite');
    const isCurrentlyFavorite = heartEl.classList.contains('active');
    const newFavorite = !isCurrentlyFavorite;

    try {
        const response = await fetch(`/api/images/${imageId}/favorite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ favorite: newFavorite })
        });

        if (response.ok) {
            if (newFavorite) {
                heartEl.classList.add('active');
            } else {
                heartEl.classList.remove('active');
            }
            // Update the image in currentImages
            const img = currentImages.find(i => i.id === imageId);
            if (img) img.favorite = newFavorite;
        }
    } catch (error) {
        console.error('Error updating favorite:', error);
    }
}

// Update selection toolbar visibility and count
function updateSelectionToolbar() {
    const toolbar = document.getElementById('selectionToolbar');
    const count = document.getElementById('selectedCount');
    const hideBtn = document.getElementById('hideBtn');
    const unhideBtn = document.getElementById('unhideBtn');
    count.textContent = selectedIds.size;

    if (selectedIds.size > 0) {
        toolbar.classList.add('active');

        // Check if any selected images are hidden or not hidden
        let hasHidden = false;
        let hasVisible = false;
        selectedIds.forEach(id => {
            const img = currentImages.find(i => i.id === id);
            if (img) {
                if (img.hidden) {
                    hasHidden = true;
                } else {
                    hasVisible = true;
                }
            }
        });

        // Show Hide button if any selected image is visible
        hideBtn.style.display = hasVisible ? 'inline-block' : 'none';
        // Show Unhide button if any selected image is hidden
        unhideBtn.style.display = hasHidden ? 'inline-block' : 'none';
    } else {
        toolbar.classList.remove('active');
        hideBtn.style.display = 'none';
        unhideBtn.style.display = 'none';
    }
}

// Select all visible images
function selectAll() {
    currentImages.forEach(img => {
        if (!selectedIds.has(img.id)) {
            selectedIds.add(img.id);
            const card = document.querySelector(`.image-card[data-id="${img.id}"]`);
            if (card) {
                card.classList.add('selected');
                const checkbox = card.querySelector('.image-checkbox');
                checkbox.classList.add('selected');
                checkbox.textContent = '✓';
            }
        }
    });
    updateSelectionToolbar();
}

// Clear selection
function clearSelection() {
    selectedIds.forEach(id => {
        const card = document.querySelector(`.image-card[data-id="${id}"]`);
        if (card) {
            card.classList.remove('selected');
            const checkbox = card.querySelector('.image-checkbox');
            checkbox.classList.remove('selected');
            checkbox.textContent = '';
        }
    });
    selectedIds.clear();
    updateSelectionToolbar();
}

// Apply bulk update
async function applyBulkUpdate() {
    if (!canEdit()) return;

    // Get selected phase from radio button
    const phaseRadio = document.querySelector('#bulkPhaseDropdown input[type="radio"]:checked');
    const newPhase = phaseRadio ? phaseRadio.value : '';

    // Get checked locations from dropdown
    const checkedLocations = [];
    document.querySelectorAll('#bulkLocationsDropdown input[type="checkbox"]:checked').forEach(cb => {
        checkedLocations.push(parseInt(cb.value));
    });

    // Get checked materials from dropdown
    const checkedMaterials = [];
    document.querySelectorAll('#bulkMaterialsDropdown input[type="checkbox"]:checked').forEach(cb => {
        checkedMaterials.push(parseInt(cb.value));
    });

    if (checkedLocations.length === 0 && checkedMaterials.length === 0 && !newPhase) {
        alert('Please select location(s), material(s), or phase to apply');
        return;
    }

    if (selectedIds.size === 0) {
        alert('No images selected');
        return;
    }

    const ids = Array.from(selectedIds);

    try {
        const response = await fetch('/api/images/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ids,
                location_ids: checkedLocations.length > 0 ? checkedLocations : undefined,
                material_ids: checkedMaterials.length > 0 ? checkedMaterials : undefined,
                phase: newPhase || undefined
            })
        });

        if (response.ok) {
            // Reset and close dropdowns
            document.querySelectorAll('#bulkPhaseDropdown input[type="radio"]').forEach(r => r.checked = false);
            document.querySelectorAll('#bulkLocationsDropdown input[type="checkbox"]').forEach(cb => cb.checked = false);
            document.querySelectorAll('#bulkMaterialsDropdown input[type="checkbox"]').forEach(cb => cb.checked = false);
            document.getElementById('bulkPhaseDropdown')?.classList.remove('active');
            document.getElementById('bulkLocationsDropdown')?.classList.remove('active');
            document.getElementById('bulkMaterialsDropdown')?.classList.remove('active');

            // Clear selection and reload
            clearSelection();
            applyFilters();
            loadLocations();
            loadConstructionPhases();
        } else {
            console.error('Error updating images');
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// Hide selected images
async function hideSelected() {
    if (!canEdit()) return;
    if (selectedIds.size === 0) {
        return;
    }

    const ids = Array.from(selectedIds);

    try {
        const response = await fetch('/api/images/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ids,
                hidden: true
            })
        });

        if (response.ok) {
            clearSelection();
            applyFilters();
        } else {
            console.error('Error hiding images');
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// Unhide selected images
async function unhideSelected() {
    if (!canEdit()) return;
    if (selectedIds.size === 0) {
        return;
    }

    const ids = Array.from(selectedIds);

    try {
        const response = await fetch('/api/images/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ids,
                hidden: false
            })
        });

        if (response.ok) {
            clearSelection();
            applyFilters();
        } else {
            console.error('Error unhiding images');
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// Open modal with image or video
function openModal(index) {
    currentIndex = index;
    const img = currentImages[index];

    // Clear selection and hide toolbar when opening modal
    clearSelection();

    // Reset zoom when opening new image
    resetZoom();

    const modalImage = document.getElementById('modalImage');
    const modalVideo = document.getElementById('modalVideo');

    const imageContainer = document.getElementById('imageContainer');
    const zoomControls = document.getElementById('zoomControls');

    if (img.is_video) {
        // Show video player, hide image and zoom controls
        imageContainer.style.display = 'none';
        zoomControls.style.display = 'none';
        modalVideo.style.display = 'block';
        modalVideo.src = `/video/${img.id}`;
        modalVideo.load();
    } else {
        // Show image and zoom controls, hide video
        imageContainer.style.display = 'block';
        zoomControls.style.display = 'flex';
        modalVideo.style.display = 'none';
        modalVideo.pause();
        modalVideo.src = '';
        modalImage.src = `/image/${img.id}?size=full`;
    }

    // Set filename
    document.getElementById('modalFilename').textContent = displayName(img.filename);
    document.getElementById('modalCompass').textContent = img.compass_direction ? `Facing ${img.compass_direction}` : '';

    // Build meta info line (date and duration for videos)
    let metaParts = [];
    if (img.photo_taken_at) {
        const date = new Date(img.photo_taken_at);
        metaParts.push(date.toLocaleDateString('en-US', {
            weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit'
        }));
    }
    if (img.is_video && img.duration) {
        const mins = Math.floor(img.duration / 60);
        const secs = Math.floor(img.duration % 60);
        metaParts.push(`Duration: ${mins}:${secs.toString().padStart(2, '0')}`);
    }
    document.getElementById('modalMeta').textContent = metaParts.join(' • ');
    document.getElementById('saveStatus').textContent = '';

    // Load and show locations from new system
    loadModalLocations(img.id);

    // Show construction phase
    document.getElementById('modalPhase').textContent = img.construction_phase ? formatLabel(img.construction_phase) : '';

    // Set notes - combine description and material_notes
    const notes = img.material_notes || img.description || '';
    document.getElementById('imageNotes').value = notes;

    // Update navigation button states
    updateNavButtons();

    // Load material details if available
    loadMaterialDetails(img.id);

    // Load transcription for videos
    if (img.is_video) {
        loadTranscription(img.id, currentLocationId);
    } else {
        document.getElementById('transcriptionPanel').style.display = 'none';
        document.getElementById('videoSegmentsPanel').style.display = 'none';
    }

    document.getElementById('modal').classList.add('active');
}

// Load and display material details for an image
async function loadMaterialDetails(imageId) {
    const panel = document.getElementById('materialDetailsPanel');
    const list = document.getElementById('materialDetailsList');

    try {
        const response = await fetch(`/api/images/${imageId}/material_details`);
        const data = await response.json();

        if (data.materials && data.materials.length > 0) {
            list.innerHTML = data.materials.map(m => {
                let html = `<div class="material-item">
                    <div class="material-header">
                        <span class="material-name">${m.name || 'Unnamed'}</span>
                        <span class="material-category">${m.category || 'uncategorized'}</span>
                        <a href="#" class="view-all-link" onclick="viewMaterialImages(${m.id}, '${(m.name || 'Material').replace(/'/g, "\\'")}'); return false;">view all</a>
                    </div>
                    <div class="material-info">`;

                if (m.manufacturer) html += `<p><strong>Manufacturer:</strong> ${m.manufacturer}</p>`;
                if (m.model) html += `<p><strong>Model:</strong> ${m.model}</p>`;
                if (m.color) html += `<p><strong>Color:</strong> ${m.color}</p>`;
                if (m.location) html += `<p><strong>Location:</strong> ${m.location}</p>`;

                // Display URL if available
                if (m.url) {
                    html += `<p><strong>Product Page:</strong> <a href="${m.url}" target="_blank" rel="noopener" style="color: #c73e5a;">View on manufacturer site</a></p>`;
                }

                // Display specs if available
                if (m.specs && typeof m.specs === 'object') {
                    html += `<div class="material-specs"><div class="specs-grid">`;
                    for (const [key, value] of Object.entries(m.specs)) {
                        if (value && typeof value !== 'object') {
                            const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                            html += `<span><strong>${label}:</strong> ${value}</span>`;
                        }
                    }
                    html += `</div></div>`;
                }

                // Display purchase info if available
                if (m.purchase_info && typeof m.purchase_info === 'object') {
                    if (m.purchase_info.total_price) {
                        html += `<p><strong>Price:</strong> $${Number(m.purchase_info.total_price).toLocaleString()}</p>`;
                    }
                    if (m.purchase_info.vendor) {
                        html += `<p><strong>Vendor:</strong> ${m.purchase_info.vendor}</p>`;
                    }
                }

                if (m.notes) html += `<p><strong>Notes:</strong> ${m.notes}</p>`;

                html += `</div></div>`;
                return html;
            }).join('');

            panel.style.display = 'block';
        } else {
            panel.style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading material details:', error);
        panel.style.display = 'none';
    }
}

// View all images for a specific material
function viewMaterialImages(materialId, materialName) {
    // Set filters BEFORE closeModal (which calls applyFilters)
    currentMaterialId = materialId;
    currentMaterialName = materialName;
    currentLocationId = null;
    currentLocationName = 'All Locations';

    // Update header
    document.getElementById('currentLocationHeader').textContent = materialName;

    // Reset location filter button
    const locationFilterBtn = document.getElementById('locationFilterBtn');
    if (locationFilterBtn) {
        locationFilterBtn.textContent = 'All Locations';
    }

    // Close modal (this calls applyFilters with the correct filter state)
    closeModal();
}

// Toggle transcript visibility
function toggleTranscript() {
    const content = document.getElementById('transcriptContent');
    const btn = document.getElementById('showTranscriptBtn');
    if (content.style.display === 'none') {
        content.style.display = 'block';
        btn.style.display = 'none';
    } else {
        content.style.display = 'none';
        btn.style.display = 'inline-block';
    }
}

// Zoom and pan functionality
let currentZoom = 1;
let panX = 0;
let panY = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;

function zoomIn() {
    currentZoom = Math.min(currentZoom + 0.25, 5);
    applyZoom();
}

function zoomOut() {
    currentZoom = Math.max(currentZoom - 0.25, 0.5);
    if (currentZoom <= 1) {
        panX = 0;
        panY = 0;
    }
    applyZoom();
}

function resetZoom() {
    currentZoom = 1;
    panX = 0;
    panY = 0;
    applyZoom();
}

function applyZoom() {
    const img = document.getElementById('modalImage');
    img.style.transform = `scale(${currentZoom}) translate(${panX}px, ${panY}px)`;
    document.getElementById('zoomLevel').textContent = Math.round(currentZoom * 100) + '%';

    // Update cursor based on zoom level
    const container = document.getElementById('imageContainer');
    container.style.cursor = currentZoom > 1 ? 'grab' : 'default';
}

// Initialize pan/drag on image container
document.addEventListener('DOMContentLoaded', function() {
    const container = document.getElementById('imageContainer');
    const img = document.getElementById('modalImage');

    container.addEventListener('mousedown', function(e) {
        if (currentZoom > 1) {
            isDragging = true;
            dragStartX = e.clientX - panX;
            dragStartY = e.clientY - panY;
            container.classList.add('dragging');
            e.preventDefault();
        }
    });

    document.addEventListener('mousemove', function(e) {
        if (isDragging && currentZoom > 1) {
            panX = e.clientX - dragStartX;
            panY = e.clientY - dragStartY;
            img.style.transform = `scale(${currentZoom}) translate(${panX}px, ${panY}px)`;
        }
    });

    document.addEventListener('mouseup', function() {
        isDragging = false;
        container.classList.remove('dragging');
    });

    // Mouse wheel zoom
    container.addEventListener('wheel', function(e) {
        e.preventDefault();
        if (e.deltaY < 0) {
            zoomIn();
        } else {
            zoomOut();
        }
    });
});

// Format seconds as M:SS
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Seek video to specific time and auto-stop at end time
let videoStopTime = null;
let videoTimeUpdateHandler = null;

function seekVideo(startTime, endTime) {
    const video = document.getElementById('modalVideo');
    if (video) {
        // Remove any existing time update handler
        if (videoTimeUpdateHandler) {
            video.removeEventListener('timeupdate', videoTimeUpdateHandler);
        }

        // Set up auto-stop at end time
        if (endTime) {
            videoStopTime = endTime;
            videoTimeUpdateHandler = function() {
                if (video.currentTime >= videoStopTime) {
                    video.pause();
                    video.removeEventListener('timeupdate', videoTimeUpdateHandler);
                    videoTimeUpdateHandler = null;
                }
            };
            video.addEventListener('timeupdate', videoTimeUpdateHandler);
        }

        video.currentTime = startTime;
        video.play();
    }
}

// Store whisper segments for search
let currentWhisperSegments = [];

// Search transcript and show results
function searchTranscript() {
    const query = document.getElementById('transcriptSearch').value.toLowerCase().trim();
    const resultsDiv = document.getElementById('transcriptSearchResults');

    if (!query || currentWhisperSegments.length === 0) {
        resultsDiv.style.display = 'none';
        return;
    }

    const matches = currentWhisperSegments.filter(s =>
        s.text.toLowerCase().includes(query)
    );

    if (matches.length === 0) {
        resultsDiv.innerHTML = '<span style="color: #666;">No matches found</span>';
        resultsDiv.style.display = 'block';
        return;
    }

    resultsDiv.innerHTML = `<strong>${matches.length} match${matches.length > 1 ? 'es' : ''}:</strong><br>` +
        matches.map(s => {
            const startTime = Math.max(0, s.start - 2); // Start 2 seconds before
            return `<a href="#" onclick="seekVideo(${startTime}); return false;"
                       style="color: #2d4a6d; text-decoration: none; display: inline-block; margin: 4px 0;">
                ▶ ${formatTime(s.start)} - "${s.text.substring(0, 60)}${s.text.length > 60 ? '...' : ''}"
            </a>`;
        }).join('<br>');
    resultsDiv.style.display = 'block';
}

// Handle Enter key in search box
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('transcriptSearch');
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchTranscript();
        });
    }
});

// Load and display transcription and segments for a video
async function loadTranscription(imageId, filterLocationId) {
    const transcriptionPanel = document.getElementById('transcriptionPanel');
    const transcriptionText = document.getElementById('transcriptionText');
    const segmentsPanel = document.getElementById('videoSegmentsPanel');
    const summaryText = document.getElementById('summaryText');
    const locationSegmentsList = document.getElementById('locationSegmentsList');
    const materialSegmentsList = document.getElementById('materialSegmentsList');

    // Clear previous search and reset transcript visibility
    document.getElementById('transcriptSearch').value = '';
    document.getElementById('transcriptSearchResults').style.display = 'none';
    document.getElementById('transcriptContent').style.display = 'none';
    document.getElementById('showTranscriptBtn').style.display = 'inline-block';
    currentWhisperSegments = [];

    try {
        const response = await fetch(`/api/images/${imageId}/transcription`);
        const data = await response.json();

        // Store whisper segments for search
        currentWhisperSegments = data.whisper_segments || [];

        // Show transcription
        if (data.transcription) {
            transcriptionText.textContent = data.transcription;
            transcriptionPanel.style.display = 'block';
        } else {
            transcriptionText.textContent = 'No transcription available yet.';
            transcriptionPanel.style.display = 'block';
        }

        // Show summary and segments
        if (data.summary || (data.segments && data.segments.length > 0)) {
            segmentsPanel.style.display = 'block';

            // Summary
            if (data.summary) {
                summaryText.textContent = data.summary;
                document.getElementById('summaryPanel').style.display = 'block';
            } else {
                document.getElementById('summaryPanel').style.display = 'none';
            }

            // Location segments
            const locationSegments = data.segments.filter(s => s.segment_type === 'location');
            if (locationSegments.length > 0) {
                locationSegmentsList.innerHTML = locationSegments.map(s => `
                    <div style="margin-bottom: 6px; display: flex; align-items: baseline; gap: 8px;">
                        <a href="#" onclick="seekVideo(${s.start_time}, ${s.end_time}); return false;"
                           style="color: #2d4a6d; text-decoration: none; font-weight: 500; white-space: nowrap;">
                            ▶ ${formatTime(s.start_time)}-${formatTime(s.end_time)}
                        </a>
                        <span style="font-weight: 500;">${formatLabel(s.segment_value)}</span>
                        <span style="color: #666; font-size: 0.8rem;">${s.description || ''}</span>
                    </div>
                `).join('');
                document.getElementById('locationSegmentsPanel').style.display = 'block';

                // Auto-seek to filtered location if provided
                if (filterLocationId) {
                    const matchingSegment = locationSegments.find(s => s.location_id === filterLocationId);
                    if (matchingSegment) {
                        // Small delay to allow video to load
                        setTimeout(() => {
                            seekVideo(matchingSegment.start_time, matchingSegment.end_time);
                        }, 500);
                    }
                }
            } else {
                document.getElementById('locationSegmentsPanel').style.display = 'none';
            }

            // Material segments
            const materialSegments = data.segments.filter(s => s.segment_type === 'material');
            if (materialSegments.length > 0) {
                materialSegmentsList.innerHTML = materialSegments.map(s => `
                    <div style="margin-bottom: 6px; display: flex; align-items: baseline; gap: 8px;">
                        <a href="#" onclick="seekVideo(${s.start_time}, ${s.end_time}); return false;"
                           style="color: #6d4a2d; text-decoration: none; font-weight: 500; white-space: nowrap;">
                            ▶ ${formatTime(s.start_time)}-${formatTime(s.end_time)}
                        </a>
                        <span style="font-weight: 500;">${formatLabel(s.segment_value)}</span>
                        <span style="color: #666; font-size: 0.8rem;">${s.description || ''}</span>
                    </div>
                `).join('');
                document.getElementById('materialSegmentsPanel').style.display = 'block';
            } else {
                document.getElementById('materialSegmentsPanel').style.display = 'none';
            }
        } else {
            segmentsPanel.style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading transcription:', error);
        transcriptionPanel.style.display = 'none';
        segmentsPanel.style.display = 'none';
    }
}

// Update navigation button enabled/disabled state
function updateNavButtons() {
    const prevBtn = document.querySelector('.prev-btn');
    const nextBtn = document.querySelector('.next-btn');

    prevBtn.disabled = currentIndex <= 0;
    nextBtn.disabled = currentIndex >= currentImages.length - 1;
}
// Close modal
function closeModal() {
    // Pause any playing video
    const video = document.getElementById('modalVideo');
    if (video) {
        video.pause();
        video.src = '';
    }
    document.getElementById('modal').classList.remove('active');

    // Refresh the view and dropdown lists to reflect any edits made
    applyFilters();
    loadLocations();
}

// Navigate between images
function navigateImage(direction) {
    const newIndex = currentIndex + direction;
    if (newIndex >= 0 && newIndex < currentImages.length) {
        openModal(newIndex);
    }
    updateNavButtons();
}


// Update construction phase
async function updatePhase() {
    const img = currentImages[currentIndex];
    const newPhase = document.getElementById('phaseSelect').value;
    const status = document.getElementById('saveStatus');

    status.textContent = 'Saving...';

    try {
        const response = await fetch(`/api/images/${img.id}/phase`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phase: newPhase })
        });

        if (response.ok) {
            status.textContent = 'Saved!';
            img.construction_phase = newPhase;

            // Update the card in the grid
            const cards = document.querySelectorAll('.image-card');
            if (cards[currentIndex]) {
                const phaseEl = cards[currentIndex].querySelector('.image-phase');
                if (phaseEl) {
                    phaseEl.textContent = newPhase;
                } else if (newPhase) {
                    const infoEl = cards[currentIndex].querySelector('.image-info');
                    infoEl.innerHTML += `<div class="image-phase">${newPhase}</div>`;
                }
            }

            // Refresh phase counts
            loadConstructionPhases();

            setTimeout(() => { status.textContent = ''; }, 2000);
        } else {
            status.textContent = 'Error saving';
        }
    } catch (error) {
        console.error('Error updating phase:', error);
        status.textContent = 'Error saving';
    }
}


// Change image size
function changeImageSize() {
    const size = document.getElementById('sizeSelect').value;
    const grid = document.getElementById('imageGrid');

    // Remove all size classes
    grid.classList.remove('size-xs', 'size-sm', 'size-md', 'size-lg', 'size-xl');

    // Add the selected size class
    grid.classList.add('size-' + size);
}

// Update notes for an image
async function updateNotes() {
    const img = currentImages[currentIndex];
    const status = document.getElementById('saveStatus');
    const notes = document.getElementById('imageNotes').value;

    status.textContent = 'Saving...';

    try {
        const response = await fetch(`/api/images/${img.id}/notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ material_notes: notes })
        });

        if (response.ok) {
            status.textContent = 'Saved!';
            img.material_notes = notes;
            setTimeout(() => { status.textContent = ''; }, 2000);
        } else {
            status.textContent = 'Error saving';
        }
    } catch (error) {
        console.error('Error updating notes:', error);
        status.textContent = 'Error saving';
    }
}

// Load all materials grouped by category
async function loadAllMaterials() {
    try {
        const response = await fetch('/api/all_materials');
        const data = await response.json();
        allMaterials = data.materials;
        // Populate the materials filter dropdown now that we have the data
        populateMaterialsFilterDropdown();
    } catch (error) {
        console.error('Error loading materials:', error);
    }
}

// Toggle dropdown visibility
function toggleDropdown(dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;
    const isActive = dropdown.classList.contains('active');

    // Close all dropdowns first
    document.querySelectorAll('.multiselect-dropdown').forEach(d => d.classList.remove('active'));

    if (!isActive) {
        // Populate and show this dropdown
        if (dropdownId === 'locationsDropdown') {
            populateLocationsDropdown();
            // Clear search input when opening and focus
            const locationsSearchInput = document.getElementById('locationsSearch');
            if (locationsSearchInput) {
                locationsSearchInput.value = '';
                setTimeout(() => locationsSearchInput.focus(), 10);
            }
        } else if (dropdownId === 'materialsDropdown') {
            populateMaterialsDropdown();
            // Clear search input when opening and focus
            const searchInput = document.getElementById('materialsSearch');
            if (searchInput) {
                searchInput.value = '';
                setTimeout(() => searchInput.focus(), 10);
            }
        } else if (dropdownId === 'phaseDropdown') {
            populatePhaseDropdown();
        }
        dropdown.classList.add('active');
    }
}


// Populate materials dropdown
async function populateMaterialsDropdown() {
    const img = currentImages[currentIndex];
    const container = document.getElementById('materialsOptions');

    // Get currently linked materials
    let linkedMaterialIds = new Set();
    try {
        const response = await fetch(`/api/images/${img.id}/material_details`);
        const data = await response.json();
        data.materials.forEach(m => linkedMaterialIds.add(m.id));
    } catch (error) {
        console.error('Error loading linked materials:', error);
    }

    // Build checkboxes grouped by category
    let html = '';
    const sortedCategories = Object.keys(allMaterials).sort();

    for (const category of sortedCategories) {
        const materials = allMaterials[category];
        html += `<div class="multiselect-category">${category}</div>`;

        for (const mat of materials) {
            const checked = linkedMaterialIds.has(mat.id) ? 'checked' : '';
            html += `<label>
                <input type="checkbox" value="${mat.id}" ${checked}>
                <span>${mat.name}</span>
            </label>`;
        }
    }
    container.innerHTML = html;
}

// Filter materials list based on search input
function filterMaterialsList(searchText, containerId) {
    const container = document.getElementById(containerId);
    const searchLower = searchText.toLowerCase().trim();

    // Get all labels and category headers
    const labels = container.querySelectorAll('label');
    const categories = container.querySelectorAll('.multiselect-category');

    // Track which categories have visible items
    const categoryVisibility = new Map();

    // First, filter labels
    labels.forEach(label => {
        const text = label.textContent.toLowerCase();
        const matches = searchLower === '' || text.includes(searchLower);
        label.style.display = matches ? 'flex' : 'none';

        // Find the category this label belongs to (previous sibling category)
        let prevSibling = label.previousElementSibling;
        while (prevSibling && !prevSibling.classList.contains('multiselect-category')) {
            prevSibling = prevSibling.previousElementSibling;
        }
        if (prevSibling && matches) {
            categoryVisibility.set(prevSibling, true);
        }
    });

    // Then, show/hide categories based on whether they have visible items
    categories.forEach(cat => {
        cat.style.display = categoryVisibility.has(cat) ? 'block' : 'none';
    });
}


// Save materials from dropdown
async function saveMaterialsFromDropdown() {
    if (!canEdit()) return;
    const img = currentImages[currentIndex];
    const status = document.getElementById('saveStatus');

    const selectedIds = [];
    document.querySelectorAll('#materialsOptions input[type="checkbox"]:checked').forEach(cb => {
        selectedIds.push(parseInt(cb.value));
    });

    status.textContent = 'Saving...';

    try {
        const response = await fetch(`/api/images/${img.id}/materials`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ material_ids: selectedIds })
        });

        if (response.ok) {
            status.textContent = 'Saved!';

            document.getElementById('materialsDropdown').classList.remove('active');
            loadMaterialDetails(img.id);
            setTimeout(() => { status.textContent = ''; }, 2000);
        } else {
            status.textContent = 'Error saving';
        }
    } catch (error) {
        console.error('Error saving materials:', error);
        status.textContent = 'Error saving';
    }
}


// Populate phase dropdown
function populatePhaseDropdown() {
    const img = currentImages[currentIndex];
    const container = document.getElementById('phaseOptions');
    const currentPhase = img.construction_phase || '';

    let html = '<label><input type="radio" name="phaseRadio" value=""> <span>(None)</span></label>';
    for (const phase of allPhases) {
        const checked = phase.name === currentPhase ? 'checked' : '';
        html += `<label>
            <input type="radio" name="phaseRadio" value="${phase.name}" ${checked}>
            <span>${formatLabel(phase.name)}</span>
        </label>`;
    }
    container.innerHTML = html;
}

// Save phase from dropdown
async function savePhaseFromDropdown() {
    if (!canEdit()) return;
    const img = currentImages[currentIndex];
    const status = document.getElementById('saveStatus');

    const selectedRadio = document.querySelector('#phaseOptions input[type="radio"]:checked');
    const newPhase = selectedRadio ? selectedRadio.value : '';

    status.textContent = 'Saving...';

    try {
        const response = await fetch(`/api/images/${img.id}/phase`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phase: newPhase })
        });

        if (response.ok) {
            status.textContent = 'Saved!';
            img.construction_phase = newPhase;

            document.getElementById('phaseDropdown').classList.remove('active');
            loadConstructionPhases();
            setTimeout(() => { status.textContent = ''; }, 2000);
        } else {
            status.textContent = 'Error saving';
        }
    } catch (error) {
        console.error('Error saving phase:', error);
        status.textContent = 'Error saving';
    }
}

// Load and display locations for modal
async function loadModalLocations(imageId) {
    const locationEl = document.getElementById('modalLocation');
    try {
        const response = await fetch(`/api/images/${imageId}/locations`);
        const data = await response.json();
        const locationNames = [];
        data.location_ids.forEach(id => {
            const loc = findLocationById(id);
            if (loc) locationNames.push(loc.name);
        });
        locationEl.textContent = locationNames.join(', ') || '';
    } catch (error) {
        console.error('Error loading modal locations:', error);
        locationEl.textContent = '';
    }
}

// Populate locations dropdown for editing
async function populateLocationsDropdown() {
    const img = currentImages[currentIndex];
    const container = document.getElementById('locationsOptions');
    if (!container) return;

    // Get currently linked location IDs for this image
    let linkedLocationIds = new Set();
    try {
        const response = await fetch(`/api/images/${img.id}/locations`);
        const data = await response.json();
        data.location_ids.forEach(id => linkedLocationIds.add(id));
    } catch (error) {
        console.error('Error loading linked locations:', error);
    }

    // Build checkboxes with hierarchy
    let html = '';
    function renderLocation(loc, level) {
        const checked = linkedLocationIds.has(loc.id) ? 'checked' : '';
        const indent = '&nbsp;'.repeat(level * 4);
        html += `<label style="padding-left: ${level * 12}px;">
            <input type="checkbox" value="${loc.id}" ${checked}>
            <span>${loc.name}</span>
        </label>`;
        if (loc.children && loc.children.length > 0) {
            loc.children.forEach(child => renderLocation(child, level + 1));
        }
    }
    allLocations.forEach(loc => renderLocation(loc, 0));
    container.innerHTML = html;
}

// Filter locations list in edit dropdown
function filterLocationsEditList(searchText) {
    const container = document.getElementById('locationsOptions');
    if (!container) return;
    const searchLower = searchText.toLowerCase().trim();
    const labels = container.querySelectorAll('label');

    labels.forEach(label => {
        const text = label.textContent.toLowerCase();
        const matches = searchLower === '' || text.includes(searchLower);
        label.style.display = matches ? 'flex' : 'none';
    });
}

// Save locations from dropdown
async function saveLocationsFromDropdown() {
    if (!canEdit()) return;
    const img = currentImages[currentIndex];
    const status = document.getElementById('saveStatus');

    const selectedLocationIds = [];
    document.querySelectorAll('#locationsOptions input[type="checkbox"]:checked').forEach(cb => {
        selectedLocationIds.push(parseInt(cb.value));
    });

    status.textContent = 'Saving...';

    try {
        const response = await fetch(`/api/images/${img.id}/locations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ location_ids: selectedLocationIds })
        });

        if (response.ok) {
            status.textContent = 'Saved!';

            // Update displayed locations
            const locationNames = [];
            selectedLocationIds.forEach(id => {
                const loc = findLocationById(id);
                if (loc) locationNames.push(loc.name);
            });
            document.getElementById('modalLocation').textContent = locationNames.join(', ');

            document.getElementById('locationsDropdown').classList.remove('active');
            loadLocations();
            setTimeout(() => { status.textContent = ''; }, 2000);
        } else {
            status.textContent = 'Error saving';
        }
    } catch (error) {
        console.error('Error saving locations:', error);
        status.textContent = 'Error saving';
    }
}

// Find location by ID in the hierarchical tree
function findLocationById(id) {
    function search(locations) {
        for (const loc of locations) {
            if (loc.id === id) return loc;
            if (loc.children && loc.children.length > 0) {
                const found = search(loc.children);
                if (found) return found;
            }
        }
        return null;
    }
    return search(allLocations);
}

// Toggle bulk locations dropdown
function toggleBulkLocationsDropdown() {
    const dropdown = document.getElementById('bulkLocationsDropdown');
    const isOpening = !dropdown.classList.contains('active');

    // Close other dropdowns
    document.getElementById('bulkMaterialsDropdown')?.classList.remove('active');
    document.getElementById('bulkPhaseDropdown')?.classList.remove('active');

    if (isOpening) {
        const options = document.getElementById('bulkLocationsOptions');
        let html = '';
        function renderLocation(loc, level) {
            html += `<label style="padding-left: ${level * 12}px;">
                <input type="checkbox" value="${loc.id}">
                <span>${loc.name}</span>
            </label>`;
            if (loc.children && loc.children.length > 0) {
                loc.children.forEach(child => renderLocation(child, level + 1));
            }
        }
        allLocations.forEach(loc => renderLocation(loc, 0));
        options.innerHTML = html;

        // Clear and focus search input
        const searchInput = document.getElementById('bulkLocationsSearch');
        if (searchInput) {
            searchInput.value = '';
            setTimeout(() => searchInput.focus(), 10);
        }
    }

    dropdown.classList.toggle('active');
}

// Filter bulk locations list
function filterBulkLocationsList(searchText) {
    const container = document.getElementById('bulkLocationsOptions');
    if (!container) return;
    const searchLower = searchText.toLowerCase().trim();
    const labels = container.querySelectorAll('label');

    labels.forEach(label => {
        const text = label.textContent.toLowerCase();
        const matches = searchLower === '' || text.includes(searchLower);
        label.style.display = matches ? 'flex' : 'none';
    });
}
