/**
 * Archetype Console — Cytoscape.js Map Engine
 *
 * View modes:
 *   1. Hub: 6 promotion anchors as entry points
 *   2. Focused: Active promotion expanded at center, 5 others in depth-scaled peripheral ring
 *   3. Ego: BFS depth-2 neighborhood in concentric layout
 *   4. Faction ego / Archetype ego: specialized centered layouts
 *
 * Exports a global API surface that app.js, dossier.js, search.js call.
 */

// ---- Constants ----

function _mkIcon(path, vb = '0 0 24 24') {
    return 'data:image/svg+xml,' + encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`
    );
}

const TIER_ICONS = {
    'pantheon':     _mkIcon('<circle cx="12" cy="4" r="2.5" fill="rgba(255,255,255,0.55)" stroke="none"/><path d="M12 7v3M8 21l2-8M16 21l-2-8M6 14h12"/><path d="M4 10l8-7 8 7"/>'),
    'pantheon-adj': _mkIcon('<circle cx="12" cy="4" r="2.5" fill="rgba(255,255,255,0.55)" stroke="none"/><path d="M12 7v3M8 21l2-8M16 21l-2-8M6 14h12"/><path d="M4 10l8-7 8 7"/>'),
    'demihero':     _mkIcon('<path d="M12 2l2.5 7H22l-6 4.5 2.5 7.5-7-5-7 5 2.5-7.5L1 9h7.5z"/>'),
    'shadow':       _mkIcon('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18" fill="rgba(255,255,255,0.3)" stroke="none"/>'),
    'trickster':    _mkIcon('<circle cx="8" cy="10" r="2"/><circle cx="16" cy="10" r="2"/><path d="M7 16c0 0 2 3 5 3s5-3 5-3"/>'),
    'transitional': _mkIcon('<path d="M12 2v20M2 12h20"/><circle cx="12" cy="12" r="4"/>'),
    'wrestler':     _mkIcon('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 12 0v1"/>', '0 0 20 24'),
    'faction':      _mkIcon('<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><circle cx="12" cy="16" r="3"/>'),
};

const EDGE_TYPE_COLORS = {
    faction_member: '#a78bfa',
    archetype_kin:  '#fbbf24',
    cross_promo:    '#34d399',
};

function getTierColor(tier) {
    return (typeof TIER_BADGE_COLORS !== 'undefined' && TIER_BADGE_COLORS[tier]) || '#94a3b8';
}

function getTierIcon(tier) {
    const nt = tier ? tier.toLowerCase().replace(/\s*\(.*?\)/, '').split('/')[0].trim() : '';
    return TIER_ICONS[nt] || TIER_ICONS['wrestler'];
}

// 1 if a node currently holds at least one championship (champions.json overlay), else 0.
// Drives the gold outline on champion nodes.
function isChampionNode(n) {
    return (n && n.current_titles && n.current_titles.length) ? 1 : 0;
}

// Radial layout — adaptive: radius scales with entity count for tight packing
// nodeSpacing is the target arc gap between nodes on each ring
const RING_CONFIG = {
    1: { minDist: 100, nodeSpacing: 60 },   // Ring 1: Pantheon, biggest nodes
    2: { minDist: 180, nodeSpacing: 44 },   // Ring 2: Demihero
    3: { minDist: 260, nodeSpacing: 32 },   // Ring 3: Shadow/Trickster/Transitional
};
const NODE_SIZES = { 1: 40, 2: 28, 3: 20 };
const BRANCH_NODE_SIZES = { 1: 40, 2: 30, 3: 22 };
const EGO_RING_DISTANCES = [0, 180, 340];
const EGO_NODE_SIZES = [44, 24, 16];
const ARCHETYPE_EGO_SIZES = { center: 72, strong: 36, partial: 28, speculative: 22 };
const MIN_RING_GAP = 70;

const _verifiedPhotos = new Set();
const _verifiedArchetypes = new Set();
let _assetsScanned = false;
// Bump alongside index.html ?v=N when on-disk wrestler/archetype images change.
const ASSET_VERSION = '31';

async function scanAvailableAssets() {
    if (_assetsScanned) return;
    _assetsScanned = true;
    try {
        const resp = await fetch('images/photos/manifest.json');
        if (resp.ok) {
            const files = await resp.json();
            files.forEach(f => _verifiedPhotos.add('images/photos/' + f));
        }
    } catch (e) {}
    try {
        const resp = await fetch('images/archetypes/manifest.json');
        if (resp.ok) {
            const files = await resp.json();
            files.forEach(f => _verifiedArchetypes.add('images/archetypes/' + f));
        }
    } catch (e) {}
}

function _withCacheBust(url) {
    if (!url || url.startsWith('data:')) return url;
    return url + (url.includes('?') ? '&' : '?') + 'v=' + ASSET_VERSION;
}

// Returns the actual on-disk path for a requested URL (handling .jpg<->.png swaps),
// or null if no matching file exists. Data URIs are returned as-is.
function _resolveFilePath(url, set) {
    if (!url) return null;
    if (url.startsWith('data:')) return url;
    if (set.has(url)) return url;
    const m = url.match(/^(.+)\.\w+$/);
    if (m) {
        for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
            const candidate = m[1] + ext;
            if (set.has(candidate)) return candidate;
        }
    }
    return null;
}

// Resolve an archetype symbol path to a real, on-disk image (or null).
// Tries the exact path first (with extension swap), then base-name fallback.
function resolveArchetypeImage(symbolPath) {
    if (!symbolPath) return null;
    const direct = _resolveFilePath(symbolPath, _verifiedArchetypes);
    if (direct) return direct;
    return _findArchetypeFallback(symbolPath);
}

// Resolve a wrestler photo path to a real, on-disk image (or null).
function resolveWrestlerPhoto(photoPath) {
    return _resolveFilePath(photoPath, _verifiedPhotos);
}

// If the exact archetype image isn't on disk, try base-name extraction.
// E.g., 'images/archetypes/loki-as-ego.jpg' falls back to 'loki.jpg' if present.
// 'aging-loki.jpg' -> 'loki.jpg'. 'hera-enthroned.jpg' -> 'hera.jpg'.
function _findArchetypeFallback(symbolPath) {
    if (!symbolPath || symbolPath.startsWith('data:')) return null;
    const m = symbolPath.match(/images\/archetypes\/([^/]+)\.\w+$/i);
    if (!m) return null;
    const slug = m[1];
    const words = slug.split('-');
    // Try longest words first — proper nouns tend to be longer than connective words.
    const ranked = [...words].sort((a, b) => b.length - a.length);
    for (const word of ranked) {
        if (word.length < 3) continue;
        const resolved = _resolveFilePath(`images/archetypes/${word}.jpg`, _verifiedArchetypes);
        if (resolved) return resolved;
    }
    return null;
}

// Set both faces of a node: front (wrestler) + back (archetype).
// Tracks frontIsIcon/backIsIcon so the flip can switch background-fit between
// 'cover' (real photo, fills circle) and 'contain' (SVG glyph, padded).
function setNodePhoto(nodeData, photoUrl, tier, tradition, archetypeSymbol) {
    const resolved = resolveWrestlerPhoto(photoUrl);
    if (resolved) {
        nodeData.wrestlerPhoto = _withCacheBust(resolved);
        nodeData.frontIsIcon = 0;
    } else {
        nodeData.wrestlerPhoto = getTierIcon(tier);
        nodeData.frontIsIcon = 1;
    }
    nodeData.photo_url = nodeData.wrestlerPhoto;
    if (nodeData.frontIsIcon) nodeData.isIcon = 1;

    const resolvedSymbol = resolveArchetypeImage(archetypeSymbol);
    if (resolvedSymbol) {
        nodeData.backPhoto = _withCacheBust(resolvedSymbol);
        nodeData.backIsIcon = 0;
    } else {
        const tradColor = TRADITION_COLORS[tradition] || '#94a3b8';
        nodeData.backPhoto = getTraditionIcon(tradition, tradColor);
        nodeData.backIsIcon = 1;
    }
}

// Focused branch view — peripheral ring geometry
const RING_LAYOUT = {
    peripheralRadius: 800,    // distance from center to peripheral branch anchors
    tilt: 0.45,               // ellipse aspect ratio (simulates viewing angle)
    minScale: 0.3,            // node scale at "back" of ring (theta=PI)
    maxScale: 0.7,            // node scale at "front" of ring (theta=0)
    clusterRadius: 55,        // base radius of peripheral mini-cluster
};

/** Compute adaptive ring distances — ensures strictly increasing order */
function computeRingDistances(ringCounts) {
    const distances = {};
    let prevDist = 0;
    [1, 2, 3].forEach(ring => {
        const count = ringCounts[ring] || 0;
        const cfg = RING_CONFIG[ring];
        let needed = cfg.minDist;
        if (count > 1) {
            needed = Math.max(needed, (count * cfg.nodeSpacing) / (2 * Math.PI));
        }
        const dist = Math.max(needed, prevDist + MIN_RING_GAP);
        distances[ring] = dist;
        prevDist = dist;
    });
    return distances;
}

// Opacity
const DIM_OPACITY = 0.08;
const LINE_DEFAULT_OPACITY = 0.35;
const LINE_HIGHLIGHT_OPACITY = 0.8;

// ---- State ----
let graphData = null;
let currentCenterId = null;
let navStack = [];
let egoMode = false;
let hubMode = true;
let isRecentering = false;
let activeBranchFilter = null; // currently focused branch key, or null
let activeBranchView = null;   // current branch-level view key, or null for hub overview
let archetypeEgoSlug = null;
let archetypeEgoName = null;

let cy = null;
let currentView = 'radial'; // 'radial' | 'ego'
let branchAssignments = null;

const filterState = {
    activeTiers: new Set(['pantheon', 'demihero', 'shadow', 'trickster', 'transitional', 'departed', 'tbd']),
    activeTypes: null,
    showConnections: false,
};

// Ring rotation state (for drag-to-rotate interaction)
const ringState = {
    rotation: 0,            // current rotation offset in radians
    dragStartRotation: 0,   // rotation when drag began
    activeBranch: null,     // current active branch key
    otherBranches: [],      // ordered peripheral branch keys
    branchRing1: {},        // { branchKey: [entityId, ...] } for each peripheral branch
    entityNames: {},        // { entityId: name } for label toggling during rotation
};


// ---- Mobile detection ----
const IS_MOBILE = window.innerWidth < 600;
if (IS_MOBILE) {
    // Scale up node sizes for touch targets
    for (const k of Object.keys(BRANCH_NODE_SIZES)) {
        BRANCH_NODE_SIZES[k] = Math.round(BRANCH_NODE_SIZES[k] * 1.3);
    }
    for (let i = 0; i < EGO_NODE_SIZES.length; i++) {
        EGO_NODE_SIZES[i] = Math.round(EGO_NODE_SIZES[i] * 1.3);
    }
}

// ---- Initialize ----

function initMap() {
    const container = document.getElementById('cy-container');
    if (!container) return;

    cy = cytoscape({
        container: container,
        style: getCytoscapeStyle(),
        elements: [],
        layout: { name: 'preset' },
        minZoom: IS_MOBILE ? 0.15 : 0.08,
        maxZoom: 6,
        wheelSensitivity: 2.0,
        boxSelectionEnabled: false,
        selectionType: 'single',
        pixelRatio: 'auto',
    });

    // Node click
    cy.on('tap', 'node', (evt) => {
        const node = evt.target;
        if (node.hasClass('title-badge') || node.hasClass('branch-center') || node.hasClass('archetype-center')) return;

        // Branch anchor click — switch to that branch
        if (node.hasClass('branch-anchor')) {
            const branchKey = node.id().replace('anchor_', '');
            toggleBranchFocus(branchKey);
            return;
        }

        // Peripheral entity click — switch to that branch
        if (node.data('isPeripheral') === 1) {
            const branchKey = node.data('branchKey');
            if (branchKey) {
                toggleBranchFocus(branchKey);
            }
            return;
        }

        const nodeId = parseInt(node.id());
        if (window._onMapNodeClick) {
            window._onMapNodeClick(nodeId);
        }
    });

    // Background click
    cy.on('tap', (evt) => {
        if (evt.target === cy) {
            if (activeBranchFilter) {
                clearBranchFocus();
            }
            if (window._onMapBgClick) {
                window._onMapBgClick();
            }
        }
    });

    // Hover highlights
    cy.on('mouseover', 'node', (evt) => {
        const node = evt.target;
        if (node.hasClass('title-badge') || node.hasClass('branch-center') || node.hasClass('archetype-center')) return;
        hoverHighlight(node);
    });

    cy.on('mouseout', 'node', (evt) => {
        hoverClear();
    });

    // ---- Ring rotation drag (on branch-center node) ----
    let ringDragging = false;
    let ringDragStartX = 0;

    cy.on('tapstart', 'node.branch-center', (evt) => {
        if (!activeBranchView) return;
        ringDragging = true;
        ringDragStartX = evt.renderedPosition.x;
        ringState.dragStartRotation = ringState.rotation;
        cy.panningEnabled(false);
        cy.container().style.cursor = 'grabbing';
    });

    cy.on('vmousemove', (evt) => {
        if (!ringDragging) return;
        const dx = evt.renderedPosition.x - ringDragStartX;
        ringState.rotation = ringState.dragStartRotation + dx * 0.004;
        updatePeripheralPositions();
    });

    cy.on('vmouseup', () => {
        if (!ringDragging) return;
        ringDragging = false;
        cy.panningEnabled(true);
        cy.container().style.cursor = '';
        snapToNearestBranch();
    });

    // Safety: release if pointer leaves window (mouse + touch)
    const ringDragEnd = () => {
        if (ringDragging) {
            ringDragging = false;
            cy.panningEnabled(true);
            cy.container().style.cursor = '';
            snapToNearestBranch();
        }
    };
    document.addEventListener('mouseup', ringDragEnd);
    document.addEventListener('touchend', ringDragEnd);

    // Cursor hint on branch-center hover
    cy.on('mouseover', 'node.branch-center', () => {
        if (activeBranchView && !ringDragging) {
            cy.container().style.cursor = 'grab';
        }
    });
    cy.on('mouseout', 'node.branch-center', () => {
        if (!ringDragging) {
            cy.container().style.cursor = '';
        }
    });
}


function storeGraphData(data) {
    graphData = data;
}


// ---- Cytoscape Stylesheet ----

function getCytoscapeStyle() {
    return [
        // Node base
        {
            selector: 'node',
            style: {
                'label': 'data(label)',
                'font-family': "'Oswald', 'Arial Narrow', sans-serif",
                'font-size': 10,
                'font-weight': 500,
                'color': 'rgba(255,255,255,0.7)',
                'text-valign': 'bottom',
                'text-halign': 'center',
                'text-margin-y': 6,
                'text-max-width': '80px',
                'text-wrap': 'ellipsis',
                'text-outline-width': 2,
                'text-outline-color': '#0a0a0f',
                'text-outline-opacity': 0.8,
                'width': 'data(size)',
                'height': 'data(size)',
                'background-color': 'data(color)',
                'border-width': 1.5,
                'border-color': 'data(borderColor)',
                'border-opacity': 0.6,
                'transition-property': 'opacity, width, height',
                'transition-duration': '0.2s',
                'min-zoomed-font-size': 0,
            }
        },
        // Photo nodes (real photos) — contained inside the ellipse, aspect preserved
        {
            selector: 'node[photo_url][!isIcon]',
            style: {
                'background-image': 'data(photo_url)',
                'background-fit': 'contain',
                'background-clip': 'node',
                'background-position-x': '50%',
                'background-position-y': '50%',
            }
        },
        // Fallback type icons
        {
            selector: 'node[isIcon]',
            style: {
                'background-image': 'data(photo_url)',
                'background-fit': 'contain',
                'background-clip': 'none',
                'background-width': '55%',
                'background-height': '55%',
                'background-opacity': 0.7,
            }
        },
        // Title badge (center)
        {
            selector: 'node.title-badge',
            style: {
                'label': 'ARCHETYPE\nCONSOLE',
                'font-size': 10,
                'font-weight': 'bold',
                'color': 'rgba(255,255,255,0.35)',
                'text-valign': 'center',
                'text-halign': 'center',
                'text-wrap': 'wrap',
                'width': 80,
                'height': 80,
                'background-color': '#0a0a0f',
                'border-width': 1,
                'border-color': 'rgba(255,255,255,0.12)',
                'border-style': 'dashed',
                'shape': 'ellipse',
                'text-margin-y': 0,
                'events': 'no',
                'z-index': 0,
            }
        },
        // Branch anchor nodes
        {
            selector: 'node.branch-anchor',
            style: {
                'label': 'data(countLabel)',
                'font-size': 8,
                'font-weight': 'bold',
                'color': 'data(borderColor)',
                'text-valign': 'bottom',
                'text-halign': 'center',
                'text-margin-y': 6,
                'text-outline-width': 2,
                'text-outline-color': '#0a0a0f',
                'text-outline-opacity': 0.8,
                'width': 'data(size)',
                'height': 'data(size)',
                'background-color': '#0a0a0f',
                'background-image': 'data(photo_url)',
                'background-fit': 'contain',
                'background-clip': 'none',
                'background-width': '85%',
                'background-height': '85%',
                'border-width': 2,
                'border-color': 'data(borderColor)',
                'shape': 'ellipse',
                'z-index': 5,
            }
        },
        // Branch center node (focused view title — drag to rotate ring)
        {
            selector: 'node.branch-center',
            style: {
                'label': 'data(branchLabel)',
                'font-size': 7,
                'font-weight': 'bold',
                'color': 'data(borderColor)',
                'text-valign': 'bottom',
                'text-halign': 'center',
                'text-wrap': 'wrap',
                'text-max-width': '100px',
                'text-margin-y': 6,
                'text-outline-width': 2,
                'text-outline-color': '#0a0a0f',
                'text-outline-opacity': 0.8,
                'width': 'data(size)',
                'height': 'data(size)',
                'background-color': '#0a0a0f',
                'background-image': 'data(photo_url)',
                'background-fit': 'contain',
                'background-clip': 'none',
                'background-width': '85%',
                'background-height': '85%',
                'border-width': 1.5,
                'border-color': 'data(borderColor)',
                'border-style': 'dashed',
                'shape': 'ellipse',
                'z-index': 5,
                'min-zoomed-font-size': 0,
            }
        },
        // Archetype ego center (diamond)
        {
            selector: 'node.archetype-center',
            style: {
                'label': 'data(label)',
                'font-size': 9,
                'font-weight': 'bold',
                'color': 'data(borderColor)',
                'text-valign': 'bottom',
                'text-halign': 'center',
                'text-wrap': 'wrap',
                'text-max-width': '120px',
                'text-margin-y': 8,
                'text-outline-width': 2,
                'text-outline-color': '#0a0a0f',
                'text-outline-opacity': 0.8,
                'width': 'data(size)',
                'height': 'data(size)',
                'background-color': '#0a0a0f',
                'background-image': 'data(photo_url)',
                'background-fit': 'contain',
                'background-clip': 'none',
                'background-width': '100%',
                'background-height': '100%',
                'background-position-x': '50%',
                'background-position-y': '50%',
                'background-opacity': 0.9,
                'border-width': 2.5,
                'border-color': 'data(borderColor)',
                'shape': 'diamond',
                'z-index': 10,
                'min-zoomed-font-size': 0,
            }
        },
        // Peripheral nodes (depth-scaled opacity)
        {
            selector: 'node[isPeripheral = 1]',
            style: {
                'opacity': 'mapData(depth, 0, 1, 0.2, 0.75)',
            }
        },
        // Champion nodes — gold outline marks current title-holders (champions.json overlay)
        {
            selector: 'node[isChampion = 1]',
            style: {
                'outline-color': '#e8c44d',
                'outline-width': 3,
                'outline-offset': 2,
                'outline-opacity': 0.85,
            }
        },
        // Edge base — unbundled bezier with center-pull (spiderweb aesthetic)
        {
            selector: 'edge',
            style: {
                'curve-style': 'unbundled-bezier',
                'control-point-distances': 'data(cpDist)',
                'control-point-weights': 0.5,
                'width': 0.8,
                'line-color': 'data(tierColor)',
                'line-opacity': LINE_DEFAULT_OPACITY,
                'target-arrow-shape': 'none',
                'overlay-opacity': 0,
                'transition-property': 'line-opacity, opacity',
                'transition-duration': '0.2s',
            }
        },
        // Cross-branch edges (dashed, subtle)
        {
            selector: 'edge[isCrossBranch = 1]',
            style: {
                'curve-style': 'straight',
                'line-opacity': 0.18,
                'line-style': 'dashed',
                'line-dash-pattern': [6, 3],
                'width': 0.5,
            }
        },
        // Dimmed
        {
            selector: '.dimmed',
            style: {
                'opacity': DIM_OPACITY,
            }
        },
        // Highlighted node
        {
            selector: '.highlighted',
            style: {
                'border-width': 3,
                'border-color': '#4a9eff',
                'z-index': 999,
            }
        },
        // Highlighted edge
        {
            selector: 'edge.highlighted',
            style: {
                'line-opacity': LINE_HIGHLIGHT_OPACITY,
                'width': 1.5,
                'z-index': 998,
            }
        },
        // Gesture cursor hover (Phase 11)
        {
            selector: '.cy-hover',
            style: {
                'border-width': 3,
                'border-color': '#7ed4ff',
                'border-opacity': 1,
                'z-index': 1000,
            }
        },
        // Hidden
        {
            selector: '.hidden',
            style: {
                'display': 'none',
            }
        },
        // Edge hidden (separate from node hidden for filter logic)
        {
            selector: '.edge-hidden',
            style: {
                'display': 'none',
            }
        },
    ];
}


// ---- Hub View (11 branch anchors) ----

function buildRadialMap() {
    if (!cy || !graphData || !branchAssignments) return;

    egoMode = false;
    hubMode = true;
    activeBranchView = null;
    currentCenterId = null;
    currentView = 'radial';
    activeBranchFilter = null;
    archetypeEgoSlug = null;
    archetypeEgoName = null;

    const branchKeys = Object.keys(BRANCHES);
    const N = branchKeys.length;
    const elements = [];
    const positions = {};

    // Title badge at center
    positions['title'] = { x: 0, y: 0 };
    elements.push({
        group: 'nodes',
        data: { id: 'title', label: '', size: 80, color: '#0a0a0f', borderColor: 'rgba(255,255,255,0.12)' },
        classes: 'title-badge',
        position: { x: 0, y: 0 },
    });

    // Branch anchors in a circle — sized by entity count
    const branchStats = {};
    branchKeys.forEach(k => { branchStats[k] = 0; });
    for (const info of Object.values(branchAssignments)) {
        if (branchStats[info.branch] !== undefined) branchStats[info.branch]++;
    }
    const maxCount = Math.max(...Object.values(branchStats));

    branchKeys.forEach((k, i) => {
        const angle = -Math.PI / 2 + (2 * Math.PI * i / N);
        const dist = 240;
        const pos = {
            x: Math.cos(angle) * dist,
            y: Math.sin(angle) * dist,
        };
        positions['anchor_' + k] = pos;

        const sizeFactor = 0.6 + 0.4 * (branchStats[k] / maxCount);
        const size = Math.round(70 * sizeFactor);

        elements.push({
            group: 'nodes',
            data: {
                id: 'anchor_' + k,
                label: '',
                branchLabel: `${BRANCHES[k].label}\n${branchStats[k]}`,
                countLabel: `${branchStats[k]}`,
                size: size,
                color: '#0a0a0f',
                borderColor: BRANCHES[k].color,
                photo_url: BRANCHES[k].logo,
            },
            classes: 'branch-anchor',
            position: pos,
        });
    });

    cy.batch(() => {
        cy.elements().remove();
        cy.add(elements);
    });

    cy.layout({
        name: 'preset',
        positions: (node) => positions[node.id()] || { x: 0, y: 0 },
        fit: true,
        padding: 60,
    }).run();

    // Reset ring state for hub
    ringState.rotation = 0;
    ringState.activeBranch = null;
    ringState.otherBranches = [];
    ringState.branchRing1 = {};
    ringState.entityNames = {};

    applyAllFilters();
}


// ---- Center-Pull Bezier ----

/**
 * Compute signed perpendicular distance to pull an edge's bezier
 * control point toward center (0,0) — spiderweb aesthetic.
 */
const CENTER_PULL_FACTOR = 0.45;

function computeCenterPull(positions, srcId, tgtId) {
    const p1 = positions[srcId];
    const p2 = positions[tgtId];
    if (!p1 || !p2) return 0;

    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;

    const toCenterX = -mx;
    const toCenterY = -my;

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const edgeLen = Math.sqrt(dx * dx + dy * dy);
    if (edgeLen < 1) return 0;

    const perpX = -dy / edgeLen;
    const perpY = dx / edgeLen;

    const projection = (toCenterX * perpX + toCenterY * perpY) * CENTER_PULL_FACTOR;

    const maxPull = edgeLen * 0.6;
    return Math.max(-maxPull, Math.min(maxPull, projection));
}


// ---- Focused Branch View (with peripheral ring) ----

function computeFocusedLayout(branchKey) {
    if (!graphData || !branchAssignments) return { positions: {}, scales: {}, depths: {} };

    const positions = {};
    const scales = {};
    const depths = {};

    // ---- Active branch at center ----
    positions['branch_center'] = { x: 0, y: 0 };
    scales['branch_center'] = 1.0;
    depths['branch_center'] = 1.0;

    // Gather active branch entities by ring
    const activeRings = { 1: [], 2: [], 3: [] };
    for (const [id, info] of Object.entries(branchAssignments)) {
        if (info.branch !== branchKey) continue;
        activeRings[info.ring].push(parseInt(id));
    }

    const ringCounts = { 1: activeRings[1].length, 2: activeRings[2].length, 3: activeRings[3].length };
    const ringDists = computeRingDistances(ringCounts);

    [1, 2, 3].forEach(ring => {
        const entities = activeRings[ring];
        if (entities.length === 0) return;
        const dist = ringDists[ring];
        const angleStep = (2 * Math.PI) / entities.length;

        entities.forEach((eid, i) => {
            const angle = -Math.PI / 2 + i * angleStep;
            const key = String(eid);
            positions[key] = {
                x: Math.cos(angle) * dist,
                y: Math.sin(angle) * dist,
            };
            scales[key] = 1.0;
            depths[key] = 1.0;
        });
    });

    // ---- Peripheral branches in elliptical ring ----
    const otherBranches = Object.keys(BRANCHES).filter(k => k !== branchKey);
    const N = otherBranches.length;

    otherBranches.forEach((key, i) => {
        const theta = 2 * Math.PI * i / N;
        const R = RING_LAYOUT.peripheralRadius;

        // Ellipse: x varies with sin, y with cos*tilt
        // theta=0 → bottom (front/close), theta=PI → top (back/far)
        const cx = R * Math.sin(theta);
        const cy_pos = R * Math.cos(theta) * RING_LAYOUT.tilt;

        // Depth: 1 at front (theta=0), 0 at back (theta=PI)
        const depth = (1 + Math.cos(theta)) / 2;
        const scale = RING_LAYOUT.minScale + (RING_LAYOUT.maxScale - RING_LAYOUT.minScale) * depth;

        // Branch anchor
        const anchorId = 'anchor_' + key;
        positions[anchorId] = { x: cx, y: cy_pos };
        scales[anchorId] = scale;
        depths[anchorId] = depth;

        // Ring 1 entities in mini-cluster around anchor
        const ring1 = [];
        for (const [id, info] of Object.entries(branchAssignments)) {
            if (info.branch !== key || info.ring !== 1) continue;
            ring1.push(parseInt(id));
        }

        const miniR = RING_LAYOUT.clusterRadius * scale;
        ring1.forEach((eid, j) => {
            const miniAngle = -Math.PI / 2 + (2 * Math.PI * j / ring1.length);
            const eidKey = String(eid);
            positions[eidKey] = {
                x: cx + Math.cos(miniAngle) * miniR,
                y: cy_pos + Math.sin(miniAngle) * miniR,
            };
            scales[eidKey] = scale;
            depths[eidKey] = depth;
        });
    });

    return { positions, scales, depths };
}


function buildBranchMap(branchKey) {
    if (!cy || !graphData || !branchAssignments) return;

    egoMode = false;
    hubMode = true;
    activeBranchView = branchKey;
    currentCenterId = null;
    currentView = 'radial';
    activeBranchFilter = null;
    archetypeEgoSlug = null;
    archetypeEgoName = null;

    // Populate ring state for rotation
    ringState.rotation = 0;
    ringState.activeBranch = branchKey;
    ringState.otherBranches = Object.keys(BRANCHES).filter(k => k !== branchKey);
    ringState.branchRing1 = {};
    ringState.entityNames = {};
    ringState.otherBranches.forEach(key => {
        ringState.branchRing1[key] = [];
        for (const [id, info] of Object.entries(branchAssignments)) {
            if (info.branch !== key || info.ring !== 1) continue;
            const eid = parseInt(id);
            ringState.branchRing1[key].push(eid);
            const node = graphData.nodes.find(n => n.id === eid);
            if (node) ringState.entityNames[eid] = node.name;
        }
    });

    const layout = computeFocusedLayout(branchKey);
    const elements = buildFocusedElements(branchKey, layout);

    cy.batch(() => {
        cy.elements().remove();
        cy.add(elements);
    });

    cy.layout({
        name: 'preset',
        positions: (node) => layout.positions[node.id()] || { x: 0, y: 0 },
        fit: true,
        padding: 40,
    }).run();

    applyAllFilters();
}


function buildFocusedElements(branchKey, layout) {
    const elements = [];
    const nodeIds = new Set();
    const activeBranch = BRANCHES[branchKey];
    const { positions, scales, depths } = layout;

    // Branch center title node (grabbable: false so drag is handled by ring rotation)
    elements.push({
        group: 'nodes',
        data: {
            id: 'branch_center',
            label: '',
            branchLabel: activeBranch.label + '\n\u25C0 drag \u25B6',
            size: 70,
            color: '#0a0a0f',
            borderColor: activeBranch.color,
            photo_url: activeBranch.logo,
            depth: 1.0,
        },
        grabbable: false,
        classes: 'branch-center',
        position: positions['branch_center'],
    });

    // ---- Active branch entities (all rings) ----
    graphData.nodes.forEach(n => {
        const info = branchAssignments[String(n.id)];
        if (!info || info.branch !== branchKey) return;

        const size = BRANCH_NODE_SIZES[info.ring] || 26;
        const typeColor = getTierColor(n.tier);

        const nodeData = {
            id: String(n.id),
            label: n.name,
            entityId: n.id,
            entityType: n.entity_type,
            tier: n.tier || 'other',
            branchKey: info.branch,
            ring: info.ring,
            size: size,
            color: activeBranch.color,
            borderColor: typeColor,
            connectionCount: n.connection_count || 0,
            isChampion: isChampionNode(n),
            depth: 1.0,
            isPeripheral: 0,
        };

        setNodePhoto(nodeData, n.photo_url, n.tier, n.tradition, n.archetype_symbol);

        elements.push({
            group: 'nodes',
            data: nodeData,
            position: positions[String(n.id)] || { x: 0, y: 0 },
        });
        nodeIds.add(String(n.id));
    });

    // ---- Peripheral branch anchors + Ring 1 entities ----
    const otherBranches = Object.keys(BRANCHES).filter(k => k !== branchKey);
    otherBranches.forEach(key => {
        const branch = BRANCHES[key];
        const anchorId = 'anchor_' + key;
        const scale = scales[anchorId] || 0.5;
        const depth = depths[anchorId] || 0.5;

        // Branch anchor node
        elements.push({
            group: 'nodes',
            data: {
                id: anchorId,
                label: '',
                branchLabel: branch.label,
                countLabel: branch.label,
                size: Math.round(50 * scale),
                color: '#0a0a0f',
                borderColor: branch.color,
                photo_url: branch.logo,
                depth: depth,
                isPeripheral: 1,
            },
            classes: 'branch-anchor',
            position: positions[anchorId],
        });
        nodeIds.add(anchorId);

        // Ring 1 entities of this peripheral branch
        graphData.nodes.forEach(n => {
            const info = branchAssignments[String(n.id)];
            if (!info || info.branch !== key || info.ring !== 1) return;

            const nodeSize = Math.round(BRANCH_NODE_SIZES[1] * scale * 0.7);
            const typeColor = getTierColor(n.tier);

            const nodeData = {
                id: String(n.id),
                label: depth > 0.45 ? n.name : '',
                entityId: n.id,
                entityType: n.entity_type,
                tier: n.tier || 'other',
                branchKey: info.branch,
                ring: info.ring,
                size: nodeSize,
                color: branch.color,
                borderColor: typeColor,
                connectionCount: n.connection_count || 0,
                isChampion: isChampionNode(n),
                depth: depth,
                isPeripheral: 1,
            };

            setNodePhoto(nodeData, n.photo_url, n.tier, n.tradition, n.archetype_symbol);

            elements.push({
                group: 'nodes',
                data: nodeData,
                position: positions[String(n.id)] || { x: 0, y: 0 },
            });
            nodeIds.add(String(n.id));
        });
    });

    // ---- Edges: intra-branch + cross-branch to peripheral Ring 1 ----
    graphData.edges.forEach(e => {
        const srcId = String(e.source);
        const tgtId = String(e.target);
        if (!nodeIds.has(srcId) || !nodeIds.has(tgtId)) return;

        const srcInfo = branchAssignments[srcId];
        const tgtInfo = branchAssignments[tgtId];
        if (!srcInfo || !tgtInfo) return;

        const srcIsActive = srcInfo.branch === branchKey;
        const tgtIsActive = tgtInfo.branch === branchKey;

        // Only: intra-branch OR cross-branch with one end in active branch
        if (!srcIsActive && !tgtIsActive) return;

        const isCrossBranch = srcIsActive !== tgtIsActive;
        const cpDist = isCrossBranch ? 0 : computeCenterPull(positions, srcId, tgtId);

        elements.push({
            group: 'edges',
            data: {
                id: 'e' + e.id,
                source: srcId,
                target: tgtId,
                edgeId: e.id,
                relationshipType: e.relationship_type,
                tierColor: EDGE_TYPE_COLORS[e.relationship_type] || '#888',
                label: e.label || '',
                cpDist: cpDist,
                isCrossBranch: isCrossBranch ? 1 : 0,
            },
        });
    });

    return elements;
}


// ---- Ego Mode ----

async function recenterOn(nodeId) {
    if (!cy || !graphData || isRecentering) return;
    isRecentering = true;

    try {
        const neighborhood = await API.getNeighborhood(nodeId, 2);
        if (!neighborhood || !neighborhood.nodes.length) {
            isRecentering = false;
            return;
        }

        egoMode = true;
        hubMode = false;
        currentCenterId = nodeId;
        currentView = 'ego';
        archetypeEgoSlug = null;
        archetypeEgoName = null;

        const egoPositions = computeEgoPositions(nodeId, neighborhood);
        const elements = buildEgoElements(nodeId, neighborhood, egoPositions);

        cy.batch(() => {
            cy.elements().remove();
            cy.add(elements);
        });

        cy.layout({
            name: 'preset',
            positions: (node) => {
                return egoPositions[node.id()] || { x: 0, y: 0 };
            },
            fit: true,
            padding: 80,
        }).run();

        applyAllFilters();
        } finally {
        isRecentering = false;
    }
}


function computeBfsRingMap(centerId, neighborhood) {
    const adj = {};
    neighborhood.edges.forEach(e => {
        if (!adj[e.source]) adj[e.source] = [];
        if (!adj[e.target]) adj[e.target] = [];
        adj[e.source].push(e.target);
        adj[e.target].push(e.source);
    });

    const ringMap = { [centerId]: 0 };
    let frontier = [centerId];
    for (let depth = 1; depth <= 2; depth++) {
        const next = [];
        for (const nid of frontier) {
            for (const neighbor of (adj[nid] || [])) {
                if (ringMap[neighbor] === undefined) {
                    ringMap[neighbor] = depth;
                    next.push(neighbor);
                }
            }
        }
        frontier = next;
    }
    return ringMap;
}


function computeEgoPositions(centerId, neighborhood) {
    const positions = {};
    positions[String(centerId)] = { x: 0, y: 0 };

    const ringMap = computeBfsRingMap(centerId, neighborhood);

    [1, 2].forEach(ring => {
        const nodesInRing = neighborhood.nodes.filter(n =>
            ringMap[n.id] === ring
        );
        const count = nodesInRing.length;
        if (count === 0) return;

        const dist = EGO_RING_DISTANCES[ring];
        const angleStep = (2 * Math.PI) / count;

        nodesInRing.forEach((n, i) => {
            const angle = -Math.PI / 2 + i * angleStep;
            positions[String(n.id)] = {
                x: Math.cos(angle) * dist,
                y: Math.sin(angle) * dist,
            };
        });
    });

    return positions;
}


function buildEgoElements(centerId, neighborhood, positions) {
    const elements = [];
    const nodeIds = new Set();
    const centerIdStr = String(centerId);

    const ringMap = computeBfsRingMap(centerId, neighborhood);

    neighborhood.nodes.forEach(n => {
        const info = branchAssignments[String(n.id)];
        const branch = info ? BRANCHES[info.branch] : null;
        const ring = ringMap[n.id] !== undefined ? ringMap[n.id] : 2;
        const size = EGO_NODE_SIZES[ring] || 18;
        const typeColor = getTierColor(n.tier);
        const branchColor = branch ? branch.color : '#888';

        const nodeData = {
            id: String(n.id),
            label: n.name,
            entityId: n.id,
            entityType: n.entity_type,
            tier: n.tier || 'other',
            branchKey: info ? info.branch : 'unknown',
            ring: ring,
            size: size,
            color: n.id === centerId ? '#4a9eff' : branchColor,
            borderColor: typeColor,
            connectionCount: n.connection_count || 0,
            isChampion: isChampionNode(n),
        };

        setNodePhoto(nodeData, n.photo_url, n.tier, n.tradition, n.archetype_symbol);

        elements.push({
            group: 'nodes',
            data: nodeData,
            position: positions[String(n.id)] || { x: 0, y: 0 },
        });
        nodeIds.add(String(n.id));
    });

    neighborhood.edges.forEach(e => {
        const srcId = String(e.source);
        const tgtId = String(e.target);
        if (!nodeIds.has(srcId) || !nodeIds.has(tgtId)) return;

        const cpDist = computeCenterPull(positions, srcId, tgtId);

        elements.push({
            group: 'edges',
            data: {
                id: 'e' + e.id,
                source: srcId,
                target: tgtId,
                edgeId: e.id,
                relationshipType: e.relationship_type,
                tierColor: EDGE_TYPE_COLORS[e.relationship_type] || '#888',
                label: e.label || '',
                cpDist: cpDist,
            },
        });
    });

    return elements;
}


// ---- Faction Ego Mode ----

async function focusFaction(factionId) {
    if (!cy || !graphData || isRecentering) return;
    isRecentering = true;

    try {
        const factionNode = graphData.nodes.find(n => n.id === factionId && n.entity_type === 'faction');
        if (!factionNode) { isRecentering = false; return; }

        const memberEdges = graphData.edges.filter(e =>
            e.relationship_type === 'faction_member' &&
            (e.source === factionId || e.target === factionId)
        );
        const memberIds = memberEdges.map(e =>
            e.source === factionId ? e.target : e.source
        );
        const memberNodes = graphData.nodes.filter(n => memberIds.includes(n.id));

        // Ring 2: members' other connections (not back to this faction)
        const ring2Ids = new Set();
        memberIds.forEach(mid => {
            graphData.edges.forEach(e => {
                if (e.source === mid && e.target !== factionId && !memberIds.includes(e.target)) {
                    ring2Ids.add(e.target);
                } else if (e.target === mid && e.source !== factionId && !memberIds.includes(e.source)) {
                    ring2Ids.add(e.source);
                }
            });
        });
        const ring2Nodes = graphData.nodes.filter(n => ring2Ids.has(n.id));

        egoMode = true;
        hubMode = false;
        currentCenterId = factionId;
        currentView = 'ego';
        archetypeEgoSlug = null;
        archetypeEgoName = null;

        const allNodes = [factionNode, ...memberNodes, ...ring2Nodes];
        const allNodeIds = new Set(allNodes.map(n => n.id));
        const allEdges = graphData.edges.filter(e =>
            allNodeIds.has(e.source) && allNodeIds.has(e.target)
        );

        // Positions: faction at center, members ring 1, secondaries ring 2
        const positions = {};
        const factionColor = BRANCHES[factionNode.promotion] ? BRANCHES[factionNode.promotion].color : '#888';
        positions[String(factionId)] = { x: 0, y: 0 };

        const r1 = Math.max(160, (memberNodes.length * 60) / (2 * Math.PI));
        memberNodes.forEach((n, i) => {
            const angle = -Math.PI / 2 + (2 * Math.PI * i / memberNodes.length);
            positions[String(n.id)] = {
                x: Math.cos(angle) * r1,
                y: Math.sin(angle) * r1,
            };
        });

        const r2 = r1 + Math.max(140, (ring2Nodes.length * 36) / (2 * Math.PI));
        ring2Nodes.forEach((n, i) => {
            const angle = -Math.PI / 2 + (2 * Math.PI * i / ring2Nodes.length);
            positions[String(n.id)] = {
                x: Math.cos(angle) * r2,
                y: Math.sin(angle) * r2,
            };
        });

        // Build elements
        const elements = [];
        allNodes.forEach(n => {
            const info = branchAssignments[String(n.id)];
            const branch = info ? BRANCHES[info.branch] : null;
            const isCenter = n.id === factionId;
            const isMember = memberIds.includes(n.id);
            const size = isCenter ? 50 : (isMember ? 36 : 18);
            const typeColor = getTierColor(n.tier);
            const branchColor = branch ? branch.color : factionColor;

            const nodeData = {
                id: String(n.id),
                label: n.name,
                entityId: n.id,
                entityType: n.entity_type,
                tier: n.tier || 'other',
                branchKey: info ? info.branch : (n.promotion || 'unknown'),
                ring: isCenter ? 0 : (isMember ? 1 : 2),
                size: size,
                color: isCenter ? factionColor : branchColor,
                borderColor: isCenter ? factionColor : typeColor,
                connectionCount: n.connection_count || 0,
                isChampion: isChampionNode(n),
            };

            if (isCenter) {
                nodeData.photo_url = TIER_ICONS['faction'];
                nodeData.isIcon = 1;
            } else {
                setNodePhoto(nodeData, n.photo_url, n.tier, n.tradition, n.archetype_symbol);
            }

            elements.push({
                group: 'nodes',
                data: nodeData,
                position: positions[String(n.id)] || { x: 0, y: 0 },
            });
        });

        allEdges.forEach(e => {
            const srcId = String(e.source);
            const tgtId = String(e.target);
            const cpDist = computeCenterPull(positions, srcId, tgtId);
            elements.push({
                group: 'edges',
                data: {
                    id: 'e' + e.id,
                    source: srcId,
                    target: tgtId,
                    edgeId: e.id,
                    relationshipType: e.relationship_type,
                    tierColor: EDGE_TYPE_COLORS[e.relationship_type] || '#888',
                    label: e.label || '',
                    cpDist: cpDist,
                },
            });
        });

        cy.batch(() => {
            cy.elements().remove();
            cy.add(elements);
        });

        cy.layout({
            name: 'preset',
            positions: (node) => positions[node.id()] || { x: 0, y: 0 },
            fit: true,
            padding: 80,
        }).run();

        applyAllFilters();
        } finally {
        isRecentering = false;
    }
}


// ---- Archetype Ego Mode ----

async function buildArchetypeEgo(slug) {
    if (!cy || !graphData || isRecentering) return;
    isRecentering = true;

    try {
        const archetype = await API.getArchetype(slug);
        if (!archetype || !archetype.carriers || archetype.carriers.length === 0) {
            isRecentering = false;
            return;
        }

        egoMode = true;
        hubMode = false;
        currentCenterId = null;
        archetypeEgoSlug = slug;
        archetypeEgoName = archetype.name;
        activeBranchView = null;
        currentView = 'ego';

        const confidenceOrder = ['strong', 'partial', 'speculative'];
        const rings = { strong: [], partial: [], speculative: [] };

        archetype.carriers.forEach(c => {
            const conf = c.confidence || 'speculative';
            if (rings[conf]) rings[conf].push(c);
            else rings.speculative.push(c);
        });

        const activeRings = confidenceOrder.filter(c => rings[c].length > 0);

        const positions = {};
        const centerId = 'archetype_' + slug;
        positions[centerId] = { x: 0, y: 0 };

        let prevDist = 0;
        activeRings.forEach((conf, idx) => {
            const carriers = rings[conf];
            const baseDist = 180 + idx * 140;
            const circumDist = (carriers.length * 55) / (2 * Math.PI);
            const dist = Math.max(baseDist, circumDist, prevDist + MIN_RING_GAP);
            prevDist = dist;

            const angleStep = (2 * Math.PI) / carriers.length;
            carriers.forEach((c, i) => {
                const angle = -Math.PI / 2 + i * angleStep;
                positions[String(c.id)] = {
                    x: Math.cos(angle) * dist,
                    y: Math.sin(angle) * dist,
                };
            });
        });

        const elements = [];
        const tradColor = TRADITION_COLORS[archetype.tradition] || '#94a3b8';

        elements.push({
            group: 'nodes',
            data: {
                id: centerId,
                label: archetype.name,
                size: ARCHETYPE_EGO_SIZES.center,
                color: tradColor,
                borderColor: tradColor,
                photo_url: getTraditionIcon(archetype.tradition, tradColor),
                isIcon: 1,
            },
            classes: 'archetype-center',
            position: { x: 0, y: 0 },
        });

        let edgeId = 0;
        activeRings.forEach(conf => {
            const carriers = rings[conf];
            const confColor = CONFIDENCE_COLORS[conf] || '#94a3b8';
            const nodeSize = ARCHETYPE_EGO_SIZES[conf] || 22;

            carriers.forEach(c => {
                const branchColor = BRANCHES[c.promotion] ? BRANCHES[c.promotion].color : '#888';
                const entity = graphData.nodes.find(n => n.id === c.id);
                const tier = entity ? entity.tier : 'other';

                const nodeData = {
                    id: String(c.id),
                    label: c.name,
                    entityId: c.id,
                    entityType: 'wrestler',
                    tier: tier,
                    branchKey: c.promotion,
                    ring: activeRings.indexOf(conf) + 1,
                    size: nodeSize,
                    color: branchColor,
                    borderColor: confColor,
                    connectionCount: entity ? (entity.connection_count || 0) : 0,
                    isChampion: isChampionNode(entity),
                };

                const carrierTradition = entity ? entity.tradition : archetype.tradition;
                setNodePhoto(
                    nodeData,
                    entity ? entity.photo_url : null,
                    tier,
                    carrierTradition,
                    entity ? entity.archetype_symbol : null
                );

                elements.push({
                    group: 'nodes',
                    data: nodeData,
                    position: positions[String(c.id)] || { x: 0, y: 0 },
                });

                elements.push({
                    group: 'edges',
                    data: {
                        id: 'ae' + edgeId++,
                        source: centerId,
                        target: String(c.id),
                        relationshipType: 'archetype_carrier',
                        tierColor: confColor,
                        label: '',
                        cpDist: 0,
                    },
                });
            });
        });

        const carrierIds = new Set(archetype.carriers.map(c => String(c.id)));
        graphData.edges.forEach(e => {
            const srcId = String(e.source);
            const tgtId = String(e.target);
            if (carrierIds.has(srcId) && carrierIds.has(tgtId)) {
                elements.push({
                    group: 'edges',
                    data: {
                        id: 'ae' + edgeId++,
                        source: srcId,
                        target: tgtId,
                        relationshipType: e.relationship_type,
                        tierColor: EDGE_TYPE_COLORS[e.relationship_type] || '#888',
                        label: e.label || '',
                        cpDist: computeCenterPull(positions, srcId, tgtId),
                    },
                });
            }
        });

        cy.batch(() => {
            cy.elements().remove();
            cy.add(elements);
        });

        cy.layout({
            name: 'preset',
            positions: (node) => positions[node.id()] || { x: 0, y: 0 },
            fit: true,
            padding: 80,
        }).run();

        applyAllFilters();
    } finally {
        isRecentering = false;
    }
}


// ---- Filtering ----

function filterByTier(activeTiers) {
    if (!cy) return;
    filterState.activeTiers = activeTiers instanceof Set ? activeTiers : new Set(activeTiers);
    applyEdgeFilters();
}

function tierMatchesFilter(tier) {
    if (!tier) return true;
    const t = tier.toLowerCase();
    if (filterState.activeTypes.has(t)) return true;
    // Match compound tiers: "pantheon-adj" → "pantheon", "shadow-adj" → "shadow"
    const base = t.split('-')[0];
    if (filterState.activeTypes.has(base)) return true;
    // Compound tiers like "trickster-shadow" match if either half is active
    const parts = t.split('-');
    for (const p of parts) {
        if (filterState.activeTypes.has(p)) return true;
    }
    return false;
}

function filterByType(activeTypes) {
    if (!cy) return;
    filterState.activeTypes = activeTypes instanceof Set ? activeTypes : new Set(activeTypes);
    cy.batch(() => {
        cy.nodes().forEach(node => {
            if (node.hasClass('title-badge') || node.hasClass('branch-anchor') || node.hasClass('branch-center')) return;
            const tier = node.data('tier');
            if (tierMatchesFilter(tier)) {
                node.removeClass('hidden');
            } else {
                node.addClass('hidden');
            }
        });
    });
}

function applyEdgeFilters() {
    if (!cy) return;

    cy.batch(() => {
        cy.edges().forEach(edge => {
            if (archetypeEgoSlug || filterState.showConnections) {
                edge.removeClass('edge-hidden');
            } else {
                edge.addClass('edge-hidden');
            }
        });
    });
}

function applyAllFilters() {
    if (filterState.activeTypes) {
        filterByType(filterState.activeTypes);
    }
    applyEdgeFilters();
}


// ---- Highlight / Focus ----

function highlightNode(nodeId) {
    if (!cy) return;
    clearHighlight();

    const node = cy.getElementById(String(nodeId));
    if (!node || node.empty()) return;

    const connectedEdges = node.connectedEdges();
    const connectedNodes = connectedEdges.connectedNodes();

    cy.batch(() => {
        cy.elements().addClass('dimmed');

        node.removeClass('dimmed').addClass('highlighted');
        connectedEdges.removeClass('dimmed').addClass('highlighted');
        connectedNodes.removeClass('dimmed');

        cy.nodes('.title-badge, .branch-anchor, .branch-center').removeClass('dimmed');
    });
}

function clearHighlight() {
    if (!cy) return;
    cy.batch(() => {
        cy.elements().removeClass('dimmed highlighted');
    });
}

function focusNode(nodeId) {
    if (!cy) return;
    const node = cy.getElementById(String(nodeId));
    if (!node || node.empty()) return;

    cy.animate({
        center: { eles: node },
        zoom: 2.5,
        duration: 400,
        easing: 'ease-in-out',
    });

    highlightNode(nodeId);
}


// ---- Branch Focus ----

function toggleBranchFocus(branchKey) {
    if (!cy || egoMode) return;

    if (activeBranchView === branchKey) {
        // Already viewing this branch — go back to hub
        buildRadialMap();
        if (typeof updateBreadcrumb === 'function') updateBreadcrumb();
        return;
    }

    buildBranchMap(branchKey);
    if (typeof updateBreadcrumb === 'function') updateBreadcrumb();
}

function clearBranchFocus() {
    if (!cy || !activeBranchView) return;
    buildRadialMap();
    if (typeof updateBreadcrumb === 'function') updateBreadcrumb();
}


// ---- Ring Rotation ----

function updatePeripheralPositions() {
    if (!cy || !ringState.otherBranches.length) return;

    const N = ringState.otherBranches.length;
    const R = RING_LAYOUT.peripheralRadius;

    cy.batch(() => {
        ringState.otherBranches.forEach((key, i) => {
            const theta = 2 * Math.PI * i / N + ringState.rotation;
            const cx = R * Math.sin(theta);
            const cy_pos = R * Math.cos(theta) * RING_LAYOUT.tilt;
            const depth = (1 + Math.cos(theta)) / 2;
            const scale = RING_LAYOUT.minScale + (RING_LAYOUT.maxScale - RING_LAYOUT.minScale) * depth;

            // Update branch anchor
            const anchorNode = cy.getElementById('anchor_' + key);
            if (anchorNode && !anchorNode.empty()) {
                anchorNode.position({ x: cx, y: cy_pos });
                anchorNode.data('size', Math.round(50 * scale));
                anchorNode.data('depth', depth);
            }

            // Update Ring 1 entities in this cluster
            const ring1 = ringState.branchRing1[key] || [];
            const miniR = RING_LAYOUT.clusterRadius * scale;
            ring1.forEach((eid, j) => {
                const miniAngle = -Math.PI / 2 + (2 * Math.PI * j / ring1.length);
                const node = cy.getElementById(String(eid));
                if (node && !node.empty()) {
                    node.position({
                        x: cx + Math.cos(miniAngle) * miniR,
                        y: cy_pos + Math.sin(miniAngle) * miniR,
                    });
                    node.data('size', Math.round(BRANCH_NODE_SIZES[1] * scale * 0.7));
                    node.data('depth', depth);
                    node.data('label', depth > 0.45 ? (ringState.entityNames[eid] || '') : '');
                }
            });
        });
    });
}


function animateRingRotation(targetRotation, onComplete) {
    const startRotation = ringState.rotation;
    const duration = 300;
    const startTime = performance.now();

    function step(now) {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);
        const eased = 1 - (1 - t) * (1 - t); // ease-out quadratic

        ringState.rotation = startRotation + (targetRotation - startRotation) * eased;
        updatePeripheralPositions();

        if (t < 1) {
            requestAnimationFrame(step);
        } else if (onComplete) {
            onComplete();
        }
    }

    requestAnimationFrame(step);
}


function snapToNearestBranch() {
    if (!ringState.otherBranches.length) return;

    const N = ringState.otherBranches.length;
    const snapThreshold = Math.PI / N; // half the angle between branches

    // Small drag — snap back without switching
    if (Math.abs(ringState.rotation - ringState.dragStartRotation) < snapThreshold * 0.5) {
        animateRingRotation(ringState.dragStartRotation, null);
        return;
    }

    // Find which branch is closest to the front (theta ≈ 0)
    let bestIdx = 0;
    let bestDist = Infinity;

    for (let i = 0; i < N; i++) {
        let theta = (2 * Math.PI * i / N + ringState.rotation) % (2 * Math.PI);
        if (theta > Math.PI) theta -= 2 * Math.PI;
        if (theta < -Math.PI) theta += 2 * Math.PI;

        if (Math.abs(theta) < bestDist) {
            bestDist = Math.abs(theta);
            bestIdx = i;
        }
    }

    const frontBranch = ringState.otherBranches[bestIdx];

    // Animate to align this branch to front, then switch
    const targetRotation = -(2 * Math.PI * bestIdx / N);
    let diff = targetRotation - ringState.rotation;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;

    animateRingRotation(ringState.rotation + diff, () => {
        ringState.rotation = 0;
        buildBranchMap(frontBranch);
        if (typeof updateBreadcrumb === 'function') updateBreadcrumb();
    });
}


// ---- Hover (lightweight) ----

function hoverHighlight(node) {
    if (!cy) return;
    if (activeBranchFilter) return;
    if (cy.elements('.highlighted').length > 0) return;

    const connectedEdges = node.connectedEdges();
    connectedEdges.forEach(e => {
        e.style('line-opacity', LINE_HIGHLIGHT_OPACITY);
        e.style('width', 1.2);
    });
}

function hoverClear() {
    if (!cy) return;
    if (activeBranchFilter) return;
    if (cy.elements('.highlighted').length > 0) return;

    cy.edges().removeStyle('line-opacity width');
}


// ---- Zoom / Pan controls ----

function zoomIn() {
    if (!cy) return;
    const w = cy.width(), h = cy.height();
    cy.animate({
        zoom: { level: cy.zoom() * 1.4, renderedPosition: { x: w / 2, y: h / 2 } },
        duration: 200,
    });
}

function zoomOut() {
    if (!cy) return;
    const w = cy.width(), h = cy.height();
    cy.animate({
        zoom: { level: cy.zoom() / 1.4, renderedPosition: { x: w / 2, y: h / 2 } },
        duration: 200,
    });
}

function resetView() {
    if (!cy) return;
    cy.animate({ fit: { eles: cy.elements(), padding: 60 }, duration: 300 });
}

function toggleConnections() {
    filterState.showConnections = !filterState.showConnections;
    applyEdgeFilters();
    return filterState.showConnections;
}


// ---- Branch assignment loader ----

function setBranchAssignments(assignments) {
    branchAssignments = assignments;
    ENTITY_BRANCH_MAP = {};
    for (const [id, info] of Object.entries(assignments)) {
        ENTITY_BRANCH_MAP[id] = { branch: info.branch, ring: info.ring };
    }
}


// ---- Gesture Layer accessors ----
// Live-value getters and the gesture-event API surface that gestures.js +
// gesture_handlers.js consume. Top-level function declarations in this file
// (recenterOn, highlightNode, focusNode, etc.) are already on `window`
// automatically — these getters only exist to expose the `let`-scoped state
// variables (cy, graphData) and to publish the gesture-action API.
if (typeof window !== 'undefined') {
    window.__archetype = window.__archetype || {};
    Object.defineProperty(window.__archetype, 'cy', {
        get: function () { return cy; },
        configurable: true,
    });
    Object.defineProperty(window.__archetype, 'graphData', {
        get: function () { return graphData; },
        configurable: true,
    });
    window.__archetype.gesture = {
        setRingRotation: (r) => {
            ringState.rotation = r;
            if (typeof updatePeripheralPositions === 'function') updatePeripheralPositions();
        },
        getRingState: () => ({ ...ringState }),
        snapBranchToNearest: () => {
            if (typeof snapToNearestBranch === 'function') snapToNearestBranch();
        },
        isInBranchView: () => !!activeBranchView,
        hitTestNode: (x, y) => {
            if (!cy) return null;
            const found = cy.nodes().toArray().find(n => {
                const bb = n.renderedBoundingBox();
                return x >= bb.x1 && x <= bb.x2 && y >= bb.y1 && y <= bb.y2;
            });
            return found || null;
        },
        // Move a Cytoscape node so its center sits at the given screen (rendered) coords.
        // Used by gesture-trigger drag. cy container is full-viewport, so screen ≈ rendered.
        dragNodeTo: (node, screenX, screenY) => {
            if (!cy || !node) return;
            const pan = cy.pan();
            const zoom = cy.zoom() || 1;
            node.position({
                x: (screenX - pan.x) / zoom,
                y: (screenY - pan.y) / zoom,
            });
        },
    };
}
