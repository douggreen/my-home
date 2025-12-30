// Photo Classification Web UI - JavaScript

let currentImages = [];
let currentIndex = 0;

// Strip file extension from filename for display
function displayName(filename) {
    return filename ? filename.replace(/\.[^.]+$/, '') : '';
}

// Mobile sidebar toggle
function toggleSidebar() {
    document.querySelector('.sidebar').classList.toggle('open');
    document.querySelector('.sidebar-overlay').classList.toggle('open');
}

function closeSidebarOnMobile() {
    if (window.innerWidth <= 768) {
        document.querySelector('.sidebar').classList.remove('open');
        document.querySelector('.sidebar-overlay').classList.remove('open');
    }
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

let allRooms = [];
let allPhases = [];
let allViewAngles = [];
let allMaterialCategories = [];
let allMaterials = {};  // Materials grouped by category
let currentRoom = null;
let currentViewAngle = null;
let currentMaterialCategory = null;
let currentMaterialId = null;
let currentMaterialName = null;
let currentLocation = 'interior';
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
    loadRooms();
    loadAllRoomNames();
    loadViewAngles();
    loadAllViewAngles();
    loadAllMaterialCategories();
    loadAllMaterials();
    loadConstructionPhases();
    loadMonths();
    loadImages();

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
        const roomsDropdown = document.getElementById('roomsDropdown');
        const materialsDropdown = document.getElementById('materialsDropdown');

        // Check if click is outside the rooms dropdown and its button
        if (roomsDropdown && roomsDropdown.classList.contains('active')) {
            const roomsContainer = roomsDropdown.closest('.multiselect-container');
            if (!roomsContainer || !roomsContainer.contains(e.target)) {
                roomsDropdown.classList.remove('active');
            }
        }

        // Check if click is outside the materials dropdown and its button
        if (materialsDropdown && materialsDropdown.classList.contains('active')) {
            const materialsContainer = materialsDropdown.closest('.multiselect-container');
            if (!materialsContainer || !materialsContainer.contains(e.target)) {
                materialsDropdown.classList.remove('active');
            }
        }
    });

    // Accordion behavior for sidebar details + load "All" view when clicking header
    document.querySelectorAll('.sidebar details').forEach(details => {
        details.addEventListener('toggle', () => {
            if (details.open) {
                document.querySelectorAll('.sidebar details').forEach(other => {
                    if (other !== details) other.open = false;
                });
            }
        });

        // Click on summary loads the "All" view for that section
        const summary = details.querySelector('summary');
        if (summary) {
            summary.addEventListener('click', () => {
                const text = summary.textContent.trim().toLowerCase();
                if (text.includes('interior')) {
                    currentRoom = null;
                    currentViewAngle = null;
                    currentLocation = 'interior';
                    document.getElementById('currentRoom').textContent = 'All Interior';
                    setActiveRoom(null);
                    toggleBulkControls('interior');
                    applyFilters();
                } else if (text.includes('exterior')) {
                    currentRoom = null;
                    currentViewAngle = null;
                    currentLocation = 'exterior';
                    document.getElementById('currentRoom').textContent = 'All Exterior';
                    setActiveRoom(null, 'exterior');
                    toggleBulkControls('exterior');
                    applyFilters();
                } else if (text.includes('materials')) {
                    currentRoom = null;
                    currentViewAngle = null;
                    currentMaterialCategory = null;
                    currentLocation = 'materials';
                    document.getElementById('currentRoom').textContent = 'All Materials';
                    setActiveRoom(null, 'materials');
                    toggleBulkControls('materials');
                    applyFilters();
                }
            });
        }
    });

    // Exterior link - will be set up by loadViewAngles
});

// Format kebab-case names to human readable (e.g., "primary-bathroom" -> "Primary Bathroom")
function formatLabel(name) {
    if (!name) return '';
    return name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Load room list with counts
async function loadRooms() {
    try {
        const response = await fetch('/api/rooms');
        const data = await response.json();

        const roomList = document.getElementById('roomList');
        roomList.innerHTML = '';

        // Add "All Interior" option
        const allItem = document.createElement('li');
        allItem.className = 'room-item active';
        allItem.innerHTML = `
            <span>All Interior</span>
            <span class="room-count">${data.total_interior}</span>
        `;
        allItem.addEventListener('click', () => {
            currentRoom = null;
            currentViewAngle = null;
            currentLocation = 'interior';
            document.getElementById('currentRoom').textContent = 'All Interior';
            setActiveRoom(null);
            toggleBulkControls('interior');
            applyFilters();
        });
        roomList.appendChild(allItem);

        // Define room hierarchies
        const roomGroups = [
            {
                name: 'Basement',
                parentRoom: 'basement',
                children: ['basement-suite', 'stairs'],
                stripPrefix: 'basement-'  // Show "Suite" instead of "Basement Suite"
            },
            {
                name: 'Great Room',
                parentRoom: 'great-room',
                children: ['dining-room', 'entry', 'kitchen', 'family-room'],
                stripPrefix: null
            },
            {
                name: 'Primary Suite',
                parentRoom: null,  // No parent room to filter on (just a label)
                children: ['primary-bathroom', 'primary-bedroom', 'primary-closet'],
                stripPrefix: 'primary-'  // Show "Bathroom" instead of "Primary Bathroom"
            },
            {
                name: 'Guest',
                parentRoom: null,  // No parent room to filter on (just a label)
                children: ['guest-bathroom', 'guest-bedroom', 'guest-hallway'],
                stripPrefix: 'guest-'
            },
            {
                name: 'Outdoor Living',
                parentRoom: null,  // Just a label
                children: ['front-porch', 'screened-patio'],
                stripPrefix: null
            }
        ];

        // Collect all grouped room names
        const groupedRoomNames = new Set();
        roomGroups.forEach(g => {
            if (g.parentRoom) groupedRoomNames.add(g.parentRoom);
            g.children.forEach(c => groupedRoomNames.add(c));
        });

        // Separate rooms by group
        const roomsByGroup = {};
        const parentRoomData = {};
        const otherRooms = [];

        data.rooms.forEach(room => {
            let found = false;
            for (const group of roomGroups) {
                if (room.name === group.parentRoom) {
                    parentRoomData[group.name] = room;
                    found = true;
                    break;
                } else if (group.children.includes(room.name)) {
                    if (!roomsByGroup[group.name]) roomsByGroup[group.name] = [];
                    roomsByGroup[group.name].push(room);
                    found = true;
                    break;
                }
            }
            if (!found) {
                otherRooms.push(room);
            }
        });

        // Helper to create room item
        function createRoomItem(room, isChild = false, displayName = null) {
            const li = document.createElement('li');
            li.className = 'room-item' + (isChild ? ' room-child' : '');
            li.dataset.room = room.name;
            li.innerHTML = `
                <span>${displayName || formatLabel(room.name)}</span>
                <span class="room-count">${room.count}</span>
            `;
            li.addEventListener('click', (e) => {
                e.stopPropagation();
                currentRoom = room.name;
                currentViewAngle = null;
                currentLocation = 'interior';
                document.getElementById('currentRoom').textContent = formatLabel(room.name);
                setActiveRoom(room.name);
                toggleBulkControls('interior');
                applyFilters();
            });
            return li;
        }

        // Helper to create room group (all non-collapsible)
        function createRoomGroup(group) {
            const groupRooms = roomsByGroup[group.name] || [];
            const parentData = parentRoomData[group.name];

            if (!parentData && groupRooms.length === 0) return null;

            const container = document.createElement('div');
            container.className = 'room-group-inline';

            // Add header - either clickable room or just a label
            if (parentData) {
                // Clickable room (like Great Room)
                container.appendChild(createRoomItem(parentData, false, group.name));
            } else {
                // Just a label header (like Primary Suite, Guest)
                const label = document.createElement('div');
                label.className = 'room-group-label';
                label.textContent = group.name + ' *';
                container.appendChild(label);
            }

            // Add children in indented list
            if (groupRooms.length > 0) {
                const childList = document.createElement('ul');
                childList.className = 'room-list room-children';
                groupRooms.forEach(room => {
                    let displayName = null;
                    if (group.stripPrefix && room.name.startsWith(group.stripPrefix)) {
                        displayName = formatLabel(room.name.substring(group.stripPrefix.length));
                    }
                    childList.appendChild(createRoomItem(room, true, displayName));
                });
                container.appendChild(childList);
            }

            return container;
        }

        // Collect all items for sorting
        const allItems = [];

        // Add all room groups
        roomGroups.forEach(group => {
            const container = createRoomGroup(group);
            if (container) {
                // Sort by parent room name, or group name for label-only groups
                const sortKey = group.parentRoom || group.name.toLowerCase().replace(/ /g, '-');
                allItems.push({ sortKey: sortKey, element: container });
            }
        });

        // Add other rooms
        otherRooms.forEach(room => {
            allItems.push({ sortKey: room.name, element: createRoomItem(room), isGroup: false });
        });

        // Sort alphabetically and append
        allItems.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
        allItems.forEach(item => {
            roomList.appendChild(item.element);
        });

        // Update exterior count
        document.getElementById('exteriorCount').textContent = data.total_exterior;

        // Update videos count
        document.getElementById('videosCount').textContent = data.total_videos;

        // Set up videos click handler
        const videosItem = document.querySelector('[data-location="videos"]');
        const selectVideos = () => {
            currentRoom = null;
            currentViewAngle = null;
            currentMaterialCategory = null;
            currentLocation = 'videos';
            document.getElementById('currentRoom').textContent = 'All Videos';
            setActiveRoom(null, 'videos');
            toggleBulkControls('videos');
            applyFilters();
        };
        if (videosItem && !videosItem.hasAttribute('data-initialized')) {
            videosItem.setAttribute('data-initialized', 'true');
            videosItem.addEventListener('click', selectVideos);

            // Also select videos when clicking the summary
            const videosSummary = videosItem.closest('details')?.querySelector('summary');
            if (videosSummary) {
                videosSummary.addEventListener('click', (e) => {
                    // Small delay to let details toggle first
                    setTimeout(selectVideos, 0);
                });
            }
        }

        // Update favorites count
        document.getElementById('favoritesCount').textContent = data.total_favorites;

        // Set up favorites click handler
        const favoritesItem = document.querySelector('[data-location="favorites"]');
        const selectFavorites = () => {
            currentRoom = null;
            currentViewAngle = null;
            currentMaterialCategory = null;
            currentMaterialId = null;
            currentLocation = 'favorites';
            document.getElementById('currentRoom').textContent = 'Favorites';
            setActiveRoom(null, 'favorites');
            toggleBulkControls('favorites');
            applyFilters();
        };
        if (favoritesItem && !favoritesItem.hasAttribute('data-initialized')) {
            favoritesItem.setAttribute('data-initialized', 'true');
            favoritesItem.addEventListener('click', selectFavorites);
        }
    } catch (error) {
        console.error('Error loading rooms:', error);
    }
}


// Load all material category names for checkboxes
async function loadAllMaterialCategories() {
    try {
        const response = await fetch('/api/all_material_categories');
        const data = await response.json();
        allMaterialCategories = data.categories;

        // Generate material category checkboxes in modal (if element exists)
        const container = document.getElementById('materialCategoryCheckboxes');
        if (container) {
            container.innerHTML = allMaterialCategories.map(cat =>
                `<label><input type="checkbox" value="${cat}" onchange="updateMaterialCategories()"> ${cat.replace(/-/g, ' ')}</label>`
            ).join('');
        }

    } catch (error) {
        console.error('Error loading material categories:', error);
    }
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
            filterMaterialsList('', dropdownId.replace('Dropdown', 'Options'));
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

// Load all room names for checkboxes
async function loadAllRoomNames() {
    try {
        const response = await fetch('/api/all_rooms');
        const data = await response.json();
        allRooms = data.rooms;

        // Populate room filter dropdown
        const roomFilter = document.getElementById('roomFilter');
        if (roomFilter) {
            roomFilter.innerHTML = '<option value="">All Rooms</option>' +
                allRooms.map(room => `<option value="${room}">${room.replace(/-/g, ' ')}</option>`).join('');
        }
    } catch (error) {
        console.error('Error loading room names:', error);
    }
}

// Toggle bulk category dropdown
function toggleBulkCategoryDropdown() {
    const dropdown = document.getElementById('bulkCategoryDropdown');
    const isOpening = !dropdown.classList.contains('active');

    // Close other dropdowns
    document.getElementById('bulkRoomDropdown')?.classList.remove('active');
    document.getElementById('bulkMaterialsDropdown')?.classList.remove('active');
    document.getElementById('bulkViewAngleDropdown')?.classList.remove('active');
    document.getElementById('bulkPhaseDropdown')?.classList.remove('active');

    // Pre-select based on current view
    if (isOpening) {
        const currentLocation = new URLSearchParams(window.location.search).get('location') || '';
        const presetValue = currentLocation === 'exterior' ? 'exterior' : 'interior';
        document.querySelectorAll('#bulkCategoryDropdown input[type="radio"]').forEach(radio => {
            radio.checked = (radio.value === presetValue);
        });
    }

    dropdown.classList.toggle('active');
}

// Toggle bulk phase dropdown
function toggleBulkPhaseDropdown() {
    const dropdown = document.getElementById('bulkPhaseDropdown');
    const isOpening = !dropdown.classList.contains('active');

    // Close other dropdowns
    document.getElementById('bulkRoomDropdown')?.classList.remove('active');
    document.getElementById('bulkMaterialsDropdown')?.classList.remove('active');
    document.getElementById('bulkViewAngleDropdown')?.classList.remove('active');
    document.getElementById('bulkCategoryDropdown')?.classList.remove('active');

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

function toggleRoomDropdown() {
    const dropdown = document.getElementById('bulkRoomDropdown');
    const isOpening = !dropdown.classList.contains('active');

    // Close other dropdowns
    document.getElementById('bulkMaterialsDropdown')?.classList.remove('active');
    document.getElementById('bulkViewAngleDropdown')?.classList.remove('active');
    document.getElementById('bulkCategoryDropdown')?.classList.remove('active');
    document.getElementById('bulkPhaseDropdown')?.classList.remove('active');

    // If opening, populate and set checkboxes based on selected images' current rooms
    if (isOpening) {
        const options = document.getElementById('bulkRoomOptions');
        const selectedRooms = new Set();
        selectedIds.forEach(id => {
            const img = currentImages.find(i => i.id === id);
            if (img && img.rooms) {
                img.rooms.forEach(room => selectedRooms.add(room));
            }
        });

        let html = '';
        allRooms.forEach(room => {
            const checked = selectedRooms.has(room) ? 'checked' : '';
            html += `<label><input type="checkbox" value="${room}" ${checked}> <span>${formatLabel(room)}</span></label>`;
        });
        options.innerHTML = html;

        // Clear and focus search input
        const searchInput = document.getElementById('bulkRoomSearch');
        if (searchInput) {
            searchInput.value = '';
            setTimeout(() => searchInput.focus(), 10);
        }
    }

    dropdown.classList.toggle('active');
}

// Toggle bulk materials dropdown visibility
function toggleBulkMaterialsDropdown() {
    const dropdown = document.getElementById('bulkMaterialsDropdown');
    const isOpening = !dropdown.classList.contains('active');

    // Close other dropdowns
    document.getElementById('bulkRoomDropdown')?.classList.remove('active');
    document.getElementById('bulkViewAngleDropdown')?.classList.remove('active');
    document.getElementById('bulkCategoryDropdown')?.classList.remove('active');
    document.getElementById('bulkPhaseDropdown')?.classList.remove('active');

    // Populate materials if opening
    if (isOpening) {
        const options = document.getElementById('bulkMaterialsOptions');
        let html = '';
        const sortedCategories = Object.keys(allMaterials).sort();
        for (const category of sortedCategories) {
            html += `<div class="multiselect-category">${category}</div>`;
            for (const mat of allMaterials[category]) {
                const displayName = mat.manufacturer ? `${mat.name} (${mat.manufacturer})` : mat.name;
                html += `<label><input type="checkbox" value="${mat.id}"> <span>${displayName}</span></label>`;
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

// Toggle view angle dropdown visibility
function toggleViewAngleDropdown() {
    const dropdown = document.getElementById('bulkViewAngleDropdown');
    const isOpening = !dropdown.classList.contains('active');

    // Close other dropdowns
    document.getElementById('bulkRoomDropdown')?.classList.remove('active');
    document.getElementById('bulkMaterialsDropdown')?.classList.remove('active');
    document.getElementById('bulkCategoryDropdown')?.classList.remove('active');
    document.getElementById('bulkPhaseDropdown')?.classList.remove('active');

    // If opening, populate and set checkboxes based on selected images' current view angles
    if (isOpening) {
        const options = document.getElementById('bulkViewAngleOptions');
        const selectedAngles = new Set();
        selectedIds.forEach(id => {
            const img = currentImages.find(i => i.id === id);
            if (img && img.view_angles) {
                img.view_angles.forEach(angle => selectedAngles.add(angle));
            }
        });

        let html = '';
        (allViewAngles || []).forEach(angle => {
            const checked = selectedAngles.has(angle) ? 'checked' : '';
            html += `<label><input type="checkbox" value="${angle}" ${checked}> <span>${formatLabel(angle)}</span></label>`;
        });
        if (options) options.innerHTML = html;
    }

    dropdown.classList.toggle('active');
}

// Close dropdowns when clicking outside
document.addEventListener('click', function(e) {
    if (!e.target.closest('.multiselect-container')) {
        document.getElementById('bulkRoomDropdown')?.classList.remove('active');
        document.getElementById('bulkViewAngleDropdown')?.classList.remove('active');
        document.getElementById('bulkMaterialsDropdown')?.classList.remove('active');
        document.getElementById('bulkCategoryDropdown')?.classList.remove('active');
        document.getElementById('bulkPhaseDropdown')?.classList.remove('active');
    }
});

// Load view angles for exterior sidebar
async function loadViewAngles() {
    try {
        const response = await fetch('/api/view_angles');
        const data = await response.json();

        const roomsResponse = await fetch('/api/rooms');
        const roomsData = await roomsResponse.json();

        const viewList = document.getElementById('viewAngleList');
        viewList.innerHTML = '';

        // Add "All Exterior" option
        const allItem = document.createElement('li');
        allItem.className = 'room-item';
        allItem.dataset.location = 'exterior';
        allItem.innerHTML = `
            <span>All Exterior</span>
            <span class="room-count" id="exteriorCount">${roomsData.total_exterior}</span>
        `;
        allItem.addEventListener('click', () => {
            currentRoom = null;
            currentViewAngle = null;
            currentLocation = 'exterior';
            document.getElementById('currentRoom').textContent = 'All Exterior';
            setActiveRoom(null, 'exterior');
            toggleBulkControls('exterior');
            applyFilters();
        });
        viewList.appendChild(allItem);

        // Define view angle groups (similar to interior room groups)
        const viewGroups = [
            {
                name: 'Garage',
                children: ['garage-front', 'garage-back'],
                stripPrefix: 'garage-'
            },
            {
                name: 'House Exterior',
                children: ['front', 'back', 'left', 'right', 'side-garage', 'side-guest', 'side-office', 'side-primary'],
                stripPrefix: null  // Keep full names for clarity
            },
            {
                name: 'Outdoor Living',
                children: ['back-deck', 'front-porch'],
                stripPrefix: null
            },
            {
                name: 'Yard',
                children: ['cul-de-sac', 'driveway', 'garage-side-yard', 'back-road', 'rear-clifton-road', 'rear-field'],
                stripPrefix: null
            }
        ];

        // Build lookup from view_angles data
        const viewDataByName = {};
        data.view_angles.forEach(angle => {
            viewDataByName[angle.name] = angle;
        });

        // Collect all grouped view names
        const groupedViewNames = new Set();
        viewGroups.forEach(g => {
            g.children.forEach(c => groupedViewNames.add(c));
        });

        // Helper to create view item
        function createViewItem(angle, isChild = false, displayName = null) {
            const li = document.createElement('li');
            li.className = 'room-item' + (isChild ? ' room-child' : '');
            li.dataset.viewAngle = angle.name;
            li.innerHTML = `
                <span>${displayName || formatLabel(angle.name)}</span>
                <span class="room-count">${angle.count}</span>
            `;
            li.addEventListener('click', (e) => {
                e.stopPropagation();
                currentRoom = null;
                currentViewAngle = angle.name;
                currentLocation = 'exterior';
                document.getElementById('currentRoom').textContent = formatLabel(angle.name);
                setActiveRoom(angle.name, 'exterior');
                toggleBulkControls('exterior');
                applyFilters();
            });
            return li;
        }

        // Helper to create view group
        function createViewGroup(group) {
            const groupViews = group.children
                .map(name => viewDataByName[name])
                .filter(v => v);  // Filter out undefined

            if (groupViews.length === 0) return null;

            const container = document.createElement('div');
            container.className = 'room-group-inline';

            // Add label header
            const label = document.createElement('div');
            label.className = 'room-group-label';
            label.textContent = group.name;
            container.appendChild(label);

            // Add children in indented list
            const childList = document.createElement('ul');
            childList.className = 'room-list room-children';
            groupViews.forEach(angle => {
                let displayName = null;
                // For "House" group, strip "side-" prefix but keep front/back as-is
                if (group.stripPrefix && angle.name.startsWith(group.stripPrefix)) {
                    displayName = formatLabel(angle.name.substring(group.stripPrefix.length));
                }
                childList.appendChild(createViewItem(angle, true, displayName));
            });
            container.appendChild(childList);

            return container;
        }

        // Add grouped views
        viewGroups.forEach(group => {
            const container = createViewGroup(group);
            if (container) {
                viewList.appendChild(container);
            }
        });

        // Add ungrouped views (any not in a group)
        data.view_angles.forEach(angle => {
            if (!groupedViewNames.has(angle.name)) {
                viewList.appendChild(createViewItem(angle));
            }
        });

    } catch (error) {
        console.error('Error loading view angles:', error);
    }
}

// Load all view angle names for checkboxes
async function loadAllViewAngles() {
    try {
        const response = await fetch('/api/all_view_angles');
        const data = await response.json();
        // Merge with predefined view angles that may not exist yet
        const predefined = ['garage-side-yard'];
        const merged = new Set([...data.view_angles, ...predefined]);
        allViewAngles = Array.from(merged).sort();
    } catch (error) {
        console.error('Error loading view angles:', error);
    }
}

// Toggle bulk controls based on interior/exterior/materials
function toggleBulkControls(location) {
    const roomDropdown = document.querySelector('.dropdown-checkbox');
    const viewDropdown = document.getElementById('bulkViewAngleDropdownWrapper');

    // Always show room dropdown so you can set category + room together
    if (roomDropdown) roomDropdown.style.display = 'inline-block';

    if (location === 'exterior') {
        viewDropdown.style.display = 'inline-block';
    } else {
        viewDropdown.style.display = 'none';
    }
}

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


// Set active room/view in sidebar
function setActiveRoom(name, location = 'interior') {
    document.querySelectorAll('.room-item').forEach(item => {
        item.classList.remove('active');
        if (location === 'interior') {
            if (name === null && !item.dataset.room && !item.dataset.location && !item.dataset.viewAngle && !item.dataset.materialCategory) {
                item.classList.add('active');
            } else if (item.dataset.room === name) {
                item.classList.add('active');
            }
        } else if (location === 'exterior') {
            if (name === null && item.dataset.location === 'exterior') {
                item.classList.add('active');
            } else if (item.dataset.viewAngle === name) {
                item.classList.add('active');
            }
        } else if (location === 'materials') {
            if (name === null && item.dataset.location === 'materials') {
                item.classList.add('active');
            } else if (item.dataset.materialCategory === name) {
                item.classList.add('active');
            }
        } else if (location === 'videos') {
            if (item.dataset.location === 'videos') {
                item.classList.add('active');
            }
        } else if (location === 'favorites') {
            if (item.dataset.location === 'favorites') {
                item.classList.add('active');
            }
        }
    });

    // Close sidebar on mobile after selection
    closeSidebarOnMobile();
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
    const roomFilterValue = document.getElementById('roomFilter').value;

    // currentMaterialId is set by selectMaterialFilter() when a specific material is chosen
    loadImages(currentRoom, currentLocation, phase, month, currentViewAngle, currentMaterialCategory, showHidden, search, '', videosOnly, roomFilterValue, currentMaterialId);
    closeFiltersOnMobile();
}

// Clear all filters
function clearFilters() {
    document.getElementById('searchInput').value = '';
    document.getElementById('phaseFilter').value = '';
    document.getElementById('monthFilter').value = '';
    document.getElementById('roomFilter').value = '';
    document.getElementById('showHidden').checked = false;
    document.getElementById('videosOnly').checked = false;
    currentMaterialId = null;
    currentMaterialName = null;
    // Reset materials filter button text
    const materialsFilterBtn = document.getElementById('materialsFilterBtn');
    if (materialsFilterBtn) {
        materialsFilterBtn.textContent = 'All Materials';
    }
    applyFilters();
}

// Toggle filter visibility based on current view
function updateFilterVisibility() {
    const materialsFilterGroup = document.getElementById('materialsFilterGroup');
    const roomFilterGroup = document.getElementById('roomFilterGroup');

    if (currentLocation === 'materials') {
        // In Materials view, show room filter instead of materials filter
        materialsFilterGroup.style.display = 'none';
        roomFilterGroup.style.display = 'flex';
    } else {
        // In other views, show materials filter
        materialsFilterGroup.style.display = 'flex';
        roomFilterGroup.style.display = 'none';
    }
}

// Load images with filters
async function loadImages(room = null, location = 'interior', phase = '', month = '', viewAngle = null, materialCategory = null, showHidden = false, search = '', hasMaterialCategory = '', videosOnly = false, roomFilterValue = '', materialId = null) {
    const grid = document.getElementById('imageGrid');
    grid.innerHTML = '<div class="loading">Loading images...</div>';

    // Clear selection when loading new images
    selectedIds.clear();
    updateSelectionToolbar();

    // Update filter visibility based on location
    updateFilterVisibility();

    try {
        let url = `/api/images?location=${location}`;
        if (room) url += `&room=${encodeURIComponent(room)}`;
        if (viewAngle) url += `&view_angle=${encodeURIComponent(viewAngle)}`;
        if (materialCategory) url += `&material_category=${encodeURIComponent(materialCategory)}`;
        if (phase) url += `&phase=${encodeURIComponent(phase)}`;
        if (month) url += `&month=${encodeURIComponent(month)}`;
        if (showHidden) url += `&show_hidden=true`;
        if (search) url += `&search=${encodeURIComponent(search)}`;
        if (hasMaterialCategory) url += `&has_material_category=${encodeURIComponent(hasMaterialCategory)}`;
        if (videosOnly) url += `&videos_only=true`;
        if (roomFilterValue) url += `&room_filter=${encodeURIComponent(roomFilterValue)}`;
        if (materialId) url += `&material_id=${materialId}`;
        if (location === 'favorites') url += `&favorites_only=true`;

        const response = await fetch(url);
        const data = await response.json();

        currentImages = data.images;
        document.getElementById('imageCount').textContent = `${currentImages.length} images`;

        if (currentImages.length === 0) {
            grid.innerHTML = '<div class="loading">No images found</div>';
            return;
        }

        grid.innerHTML = currentImages.map((img, index) => {
            // Display rooms or view angles depending on category
            let displayLabel = '';
            if (currentLocation === 'videos') {
                // In videos view, show interior/exterior
                displayLabel = formatLabel(img.interior_exterior) || '';
            } else if (img.interior_exterior === 'interior') {
                const rooms = img.rooms || [];
                displayLabel = rooms.length > 0 ? rooms.map(formatLabel).join(', ') : '';
            } else if (img.interior_exterior === 'exterior') {
                const viewAngles = img.view_angles || [];
                displayLabel = viewAngles.length > 0 ? viewAngles.map(formatLabel).join(', ') : '';
            } else if (img.interior_exterior === 'materials') {
                const materialCats = img.material_categories && img.material_categories.length > 0 ? img.material_categories : [];
                displayLabel = materialCats.length > 0 ? materialCats.map(formatLabel).join(', ') : '';
            }
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
                    <div class="image-room">${displayLabel}</div>
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
            // Update favorites count in nav
            loadRooms();
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

    // Get selected category from radio button
    const categoryRadio = document.querySelector('#bulkCategoryDropdown input[type="radio"]:checked');
    const newCategory = categoryRadio ? categoryRadio.value : '';

    // Get selected phase from radio button
    const phaseRadio = document.querySelector('#bulkPhaseDropdown input[type="radio"]:checked');
    const newPhase = phaseRadio ? phaseRadio.value : '';

    // Get checked rooms from dropdown
    const checkedRooms = [];
    document.querySelectorAll('#bulkRoomDropdown input[type="checkbox"]:checked').forEach(cb => {
        checkedRooms.push(cb.value);
    });

    // Get checked view angles from dropdown
    const checkedViewAngles = [];
    document.querySelectorAll('#bulkViewAngleDropdown input[type="checkbox"]:checked').forEach(cb => {
        checkedViewAngles.push(cb.value);
    });

    // Get checked materials from dropdown
    const checkedMaterials = [];
    document.querySelectorAll('#bulkMaterialsDropdown input[type="checkbox"]:checked').forEach(cb => {
        checkedMaterials.push(parseInt(cb.value));
    });

    if (!newCategory && checkedRooms.length === 0 && checkedViewAngles.length === 0 && checkedMaterials.length === 0 && !newPhase) {
        alert('Please select a category, room(s), view(s), material(s), or phase to apply');
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
                category: newCategory || undefined,
                rooms: checkedRooms.length > 0 ? checkedRooms : undefined,
                view_angles: checkedViewAngles.length > 0 ? checkedViewAngles : undefined,
                material_ids: checkedMaterials.length > 0 ? checkedMaterials : undefined,
                phase: newPhase || undefined
            })
        });

        if (response.ok) {
            // Reset and close dropdowns
            document.querySelectorAll('#bulkCategoryDropdown input[type="radio"]').forEach(r => r.checked = false);
            document.querySelectorAll('#bulkPhaseDropdown input[type="radio"]').forEach(r => r.checked = false);
            document.querySelectorAll('#bulkRoomDropdown input[type="checkbox"]').forEach(cb => cb.checked = false);
            document.querySelectorAll('#bulkViewAngleDropdown input[type="checkbox"]').forEach(cb => cb.checked = false);
            document.querySelectorAll('#bulkMaterialsDropdown input[type="checkbox"]').forEach(cb => cb.checked = false);
            document.getElementById('bulkCategoryDropdown')?.classList.remove('active');
            document.getElementById('bulkPhaseDropdown')?.classList.remove('active');
            document.getElementById('bulkRoomDropdown')?.classList.remove('active');
            document.getElementById('bulkViewAngleDropdown')?.classList.remove('active');
            document.getElementById('bulkMaterialsDropdown')?.classList.remove('active');

            // Clear selection and reload
            clearSelection();
            applyFilters();
            loadRooms();
            loadViewAngles();
            loadMaterialCategories();
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
            loadRooms();
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
            loadRooms();
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

    // Show location (room for interior, view angle for exterior)
    let locationText = '';
    if (img.interior_exterior === 'interior') {
        const rooms = img.rooms || [];
        if (rooms.length > 0) {
            locationText = rooms.map(formatLabel).join(', ');
        }
    } else if (img.interior_exterior === 'exterior') {
        const views = img.view_angles || [];
        if (views.length > 0) {
            locationText = views.map(formatLabel).join(', ');
        }
    }
    document.getElementById('modalLocation').textContent = locationText;

    // Show construction phase
    document.getElementById('modalPhase').textContent = img.construction_phase ? formatLabel(img.construction_phase) : '';

    // Show room controls for interior, view angle controls for exterior
    updateModalControls(img.interior_exterior);

    // Set notes - combine description and material_notes
    const notes = img.material_notes || img.description || '';
    document.getElementById('imageNotes').value = notes;

    // Update navigation button states
    updateNavButtons();

    // Load material details if available
    loadMaterialDetails(img.id);

    // Load transcription for videos
    if (img.is_video) {
        loadTranscription(img.id, currentRoom);
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
    currentRoom = null;
    currentViewAngle = null;
    currentMaterialCategory = null;
    currentMaterialId = materialId;
    currentMaterialName = materialName;
    currentLocation = 'materials';

    // Update header
    document.getElementById('currentRoom').textContent = materialName;

    // Clear sidebar selection and highlight materials
    setActiveRoom(null, 'materials');

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
async function loadTranscription(imageId, filterRoom) {
    const transcriptionPanel = document.getElementById('transcriptionPanel');
    const transcriptionText = document.getElementById('transcriptionText');
    const segmentsPanel = document.getElementById('videoSegmentsPanel');
    const summaryText = document.getElementById('summaryText');
    const roomSegmentsList = document.getElementById('roomSegmentsList');
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

            // Room segments
            const roomSegments = data.segments.filter(s => s.segment_type === 'room');
            if (roomSegments.length > 0) {
                roomSegmentsList.innerHTML = roomSegments.map(s => `
                    <div style="margin-bottom: 6px; display: flex; align-items: baseline; gap: 8px;">
                        <a href="#" onclick="seekVideo(${s.start_time}, ${s.end_time}); return false;"
                           style="color: #2d4a6d; text-decoration: none; font-weight: 500; white-space: nowrap;">
                            ▶ ${formatTime(s.start_time)}-${formatTime(s.end_time)}
                        </a>
                        <span style="font-weight: 500;">${formatLabel(s.segment_value)}</span>
                        <span style="color: #666; font-size: 0.8rem;">${s.description || ''}</span>
                    </div>
                `).join('');
                document.getElementById('roomSegmentsPanel').style.display = 'block';

                // Auto-seek to filtered room if provided
                if (filterRoom) {
                    const matchingSegment = roomSegments.find(s => s.segment_value === filterRoom);
                    if (matchingSegment) {
                        // Small delay to allow video to load
                        setTimeout(() => {
                            seekVideo(matchingSegment.start_time, matchingSegment.end_time);
                        }, 500);
                    }
                }
            } else {
                document.getElementById('roomSegmentsPanel').style.display = 'none';
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

// Update modal controls visibility based on category
function updateModalControls(category) {
    const roomsContainer = document.getElementById('roomsContainer');
    const viewsContainer = document.getElementById('viewsContainer');

    if (category === 'exterior') {
        // Exterior: show views, hide rooms
        roomsContainer.style.display = 'none';
        viewsContainer.style.display = 'block';
    } else {
        // Interior: show rooms, hide views
        roomsContainer.style.display = 'block';
        viewsContainer.style.display = 'none';
    }
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
    loadAllViewAngles();
    loadAllRoomNames();
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

// Update category (interior/exterior/materials)
async function updateCategory() {
    const img = currentImages[currentIndex];
    const newCategory = document.getElementById('categorySelect').value;
    const status = document.getElementById('saveStatus');

    status.textContent = 'Saving...';

    // Update controls visibility immediately
    updateModalControls(newCategory);

    try {
        const response = await fetch(`/api/images/${img.id}/category`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category: newCategory })
        });

        if (response.ok) {
            status.textContent = 'Saved!';
            img.interior_exterior = newCategory;

            // Refresh counts
            loadRooms();
            loadViewAngles();

            setTimeout(() => { status.textContent = ''; }, 2000);
        } else {
            status.textContent = 'Error saving';
        }
    } catch (error) {
        console.error('Error updating category:', error);
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

// Update material categories (for materials images) - checkboxes
async function updateMaterialCategories() {
    const img = currentImages[currentIndex];
    const status = document.getElementById('saveStatus');

    // Get all checked material categories
    const selectedCategories = [];
    document.querySelectorAll('#materialCategoryCheckboxes input[type="checkbox"]:checked').forEach(cb => {
        selectedCategories.push(cb.value);
    });

    status.textContent = 'Saving...';

    try {
        const response = await fetch(`/api/images/${img.id}/materials`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categories: selectedCategories })
        });

        if (response.ok) {
            status.textContent = 'Saved!';
            img.material_categories = selectedCategories;

            // Update the card in the grid
            const cards = document.querySelectorAll('.image-card');
            if (cards[currentIndex]) {
                const catDisplay = selectedCategories.length > 0 ? selectedCategories.join(', ') : 'unclassified';
                cards[currentIndex].querySelector('.image-room').textContent = catDisplay;
            }

            // Refresh material category counts
            loadMaterialCategories();

            setTimeout(() => { status.textContent = ''; }, 2000);
        } else {
            status.textContent = 'Error saving';
        }
    } catch (error) {
        console.error('Error updating material categories:', error);
        status.textContent = 'Error saving';
    }
}

// Update view angles (for exterior images) - checkboxes
async function updateViewAngles() {
    const img = currentImages[currentIndex];
    const status = document.getElementById('saveStatus');

    // Get all checked view angles
    const selectedViewAngles = [];
    document.querySelectorAll('#viewAngleCheckboxes input[type="checkbox"]:checked').forEach(cb => {
        selectedViewAngles.push(cb.value);
    });

    status.textContent = 'Saving...';

    try {
        const response = await fetch(`/api/images/${img.id}/view_angle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ view_angles: selectedViewAngles })
        });

        if (response.ok) {
            status.textContent = 'Saved!';
            img.view_angles = selectedViewAngles;

            // Update the card in the grid
            const cards = document.querySelectorAll('.image-card');
            if (cards[currentIndex]) {
                const viewDisplay = selectedViewAngles.length > 0 ? selectedViewAngles.join(', ') : 'unclassified';
                cards[currentIndex].querySelector('.image-room').textContent = viewDisplay;
            }

            // Refresh view angle counts
            loadViewAngles();

            setTimeout(() => { status.textContent = ''; }, 2000);
        } else {
            status.textContent = 'Error saving';
        }
    } catch (error) {
        console.error('Error updating view angles:', error);
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
        if (dropdownId === 'roomsDropdown') {
            populateRoomsDropdown();
            // Clear search input when opening and focus
            const roomsSearchInput = document.getElementById('roomsSearch');
            if (roomsSearchInput) {
                roomsSearchInput.value = '';
                setTimeout(() => roomsSearchInput.focus(), 10);
            }
        } else if (dropdownId === 'materialsDropdown') {
            populateMaterialsDropdown();
            // Clear search input when opening and focus
            const searchInput = document.getElementById('materialsSearch');
            if (searchInput) {
                searchInput.value = '';
                setTimeout(() => searchInput.focus(), 10);
            }
        } else if (dropdownId === 'categoryDropdown') {
            populateCategoryDropdown();
        } else if (dropdownId === 'phaseDropdown') {
            populatePhaseDropdown();
        } else if (dropdownId === 'viewsDropdown') {
            populateViewsDropdown();
        }
        dropdown.classList.add('active');
    }
}

// Populate rooms dropdown
function populateRoomsDropdown() {
    const img = currentImages[currentIndex];
    const container = document.getElementById('roomsOptions');
    const linkedRooms = new Set(img.rooms || []);

    let html = '';
    for (const room of allRooms) {
        const checked = linkedRooms.has(room) ? 'checked' : '';
        const displayName = room.replace(/-/g, ' ');
        html += `<label>
            <input type="checkbox" value="${room}" ${checked}>
            <span>${displayName}</span>
        </label>`;
    }
    container.innerHTML = html;
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
            const displayName = mat.manufacturer ? `${mat.name} (${mat.manufacturer})` : mat.name;
            html += `<label>
                <input type="checkbox" value="${mat.id}" ${checked}>
                <span>${displayName}</span>
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

// Save rooms from dropdown
async function saveRoomsFromDropdown() {
    if (!canEdit()) return;
    const img = currentImages[currentIndex];
    const status = document.getElementById('saveStatus');

    const selectedRooms = [];
    document.querySelectorAll('#roomsOptions input[type="checkbox"]:checked').forEach(cb => {
        selectedRooms.push(cb.value);
    });

    status.textContent = 'Saving...';

    try {
        const response = await fetch(`/api/images/${img.id}/room`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rooms: selectedRooms })
        });

        if (response.ok) {
            status.textContent = 'Saved!';

            img.rooms = selectedRooms;

            const cards = document.querySelectorAll('.image-card');
            if (cards[currentIndex]) {
                const roomDisplay = selectedRooms.length > 0 ? selectedRooms.join(', ').replace(/-/g, ' ') : 'unclassified';
                cards[currentIndex].querySelector('.image-room').textContent = roomDisplay;
            }

            document.getElementById('roomsDropdown').classList.remove('active');
            loadRooms();
            setTimeout(() => { status.textContent = ''; }, 2000);
        } else {
            status.textContent = 'Error saving';
        }
    } catch (error) {
        console.error('Error saving rooms:', error);
        status.textContent = 'Error saving';
    }
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
            loadMaterialCategories();
            setTimeout(() => { status.textContent = ''; }, 2000);
        } else {
            status.textContent = 'Error saving';
        }
    } catch (error) {
        console.error('Error saving materials:', error);
        status.textContent = 'Error saving';
    }
}

// Populate category dropdown
function populateCategoryDropdown() {
    const img = currentImages[currentIndex];
    const currentCategory = img.interior_exterior || '';

    document.querySelectorAll('#categoryOptions input[type="radio"]').forEach(radio => {
        radio.checked = (radio.value === currentCategory);
    });
}

// Save category from dropdown
async function saveCategoryFromDropdown() {
    if (!canEdit()) return;
    const img = currentImages[currentIndex];
    const status = document.getElementById('saveStatus');

    const selectedRadio = document.querySelector('#categoryOptions input[type="radio"]:checked');
    if (!selectedRadio) return;

    const newCategory = selectedRadio.value;
    status.textContent = 'Saving...';

    // Update controls visibility immediately
    updateModalControls(newCategory);

    try {
        const response = await fetch(`/api/images/${img.id}/category`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category: newCategory })
        });

        if (response.ok) {
            status.textContent = 'Saved!';
            img.interior_exterior = newCategory;

            document.getElementById('categoryDropdown').classList.remove('active');
            // Refresh counts
            loadRooms();
            loadViewAngles();

            setTimeout(() => { status.textContent = ''; }, 2000);
        } else {
            status.textContent = 'Error saving';
        }
    } catch (error) {
        console.error('Error saving category:', error);
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

// Populate views dropdown
function populateViewsDropdown() {
    const img = currentImages[currentIndex];
    const container = document.getElementById('viewsOptions');
    if (!container) return;

    const linkedViews = new Set(img.view_angles || []);

    let html = '';
    for (const view of allViewAngles || []) {
        const checked = linkedViews.has(view) ? 'checked' : '';
        html += `<label>
            <input type="checkbox" value="${view}" ${checked}>
            <span>${formatLabel(view)}</span>
        </label>`;
    }
    container.innerHTML = html;
}

// Save views from dropdown
async function saveViewsFromDropdown() {
    const img = currentImages[currentIndex];
    const status = document.getElementById('saveStatus');

    const selectedViews = [];
    document.querySelectorAll('#viewsOptions input[type="checkbox"]:checked').forEach(cb => {
        selectedViews.push(cb.value);
    });

    status.textContent = 'Saving...';

    try {
        const response = await fetch(`/api/images/${img.id}/view_angles`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ view_angles: selectedViews })
        });

        if (response.ok) {
            status.textContent = 'Saved!';

            img.view_angles = selectedViews;

            document.getElementById('viewsDropdown').classList.remove('active');
            loadViewAngles();
            setTimeout(() => { status.textContent = ''; }, 2000);
        } else {
            status.textContent = 'Error saving';
        }
    } catch (error) {
        console.error('Error saving views:', error);
        status.textContent = 'Error saving';
    }
}
