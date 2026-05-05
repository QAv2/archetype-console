// CardFlip — squeezes a Cytoscape node horizontally to ~zero width, swaps its
// background image (front<->back), then expands back. The illusion is a card
// turning edge-on. State lives on the node itself via `cardFlipped` data.
//
// Front face: wrestler photo (or tier icon if no photo file is verified).
// Back face: archetype image (or tradition glyph if no symbol file is verified).
const CardFlip = {
    activeId: null,
    autoFlipTimer: null,
    SQUEEZE_DURATION: 220,
    EXPAND_DURATION: 240,
    AUTO_FLIP_DELAY: 3200,

    init() {},

    // Tap a node from the map. If it's a new node, focus it and schedule the
    // auto-flip. If it's already active, toggle manually.
    show(nodeId) {
        if (!cy) return;
        if (this.activeId === nodeId) {
            this._cancelAutoFlip();
            this._toggleNode(nodeId);
            return;
        }
        this._resetActive();
        if (!this._isFlippable(nodeId)) return;
        this.activeId = nodeId;
        this.autoFlipTimer = setTimeout(() => {
            if (this.activeId === nodeId) this._toggleNode(nodeId);
        }, this.AUTO_FLIP_DELAY);
    },

    // Manual flip via 'F' key — toggles the active node if any.
    flipActive() {
        this._cancelAutoFlip();
        if (this.activeId != null) this._toggleNode(this.activeId);
    },

    // Dismissed (background click, escape, view rebuild). Snap any flipped
    // node back to the front face without animation.
    hide() {
        this._cancelAutoFlip();
        this._snapBackActive();
        this.activeId = null;
    },

    _isFlippable(nodeId) {
        const node = cy.getElementById(String(nodeId));
        if (!node || node.empty()) return false;
        if (node.data('entityType') !== 'wrestler') return false;
        if (node.hasClass('archetype-center') || node.hasClass('branch-center') ||
            node.hasClass('branch-anchor') || node.hasClass('title-badge')) return false;
        return !!(node.data('wrestlerPhoto') && node.data('backPhoto'));
    },

    _toggleNode(nodeId) {
        const node = cy.getElementById(String(nodeId));
        if (!node || node.empty()) return;
        if (node.data('cardFlipping')) return;

        const fullSize = node.data('size');
        if (!fullSize) return;

        const isFlipped = node.data('cardFlipped') === 1;
        const targetPhoto = isFlipped ? node.data('wrestlerPhoto') : node.data('backPhoto');
        const targetIsIcon = isFlipped ? node.data('frontIsIcon') : node.data('backIsIcon');

        if (!targetPhoto) return;

        node.data('cardFlipping', 1);

        node.animation({
            style: { 'width': 2 },
            duration: this.SQUEEZE_DURATION,
            easing: 'ease-in',
        }).play().promise().then(() => {
            node.data('photo_url', targetPhoto);
            // Toggle isIcon. Cytoscape selectors `[isIcon]` and `[!isIcon]`
            // need the attribute set/cleared distinctly — `0` still matches
            // some selector engines, so use removeData when not an icon.
            if (targetIsIcon) {
                node.data('isIcon', 1);
            } else {
                node.removeData('isIcon');
            }
            node.data('cardFlipped', isFlipped ? 0 : 1);

            // Front shows the wrestler with their promotion frame; back shows
            // the archetype free-floating (no fill, no border) so transparent
            // PNGs blend seamlessly with the page background.
            if (isFlipped) {
                node.removeStyle('background-color');
                node.removeStyle('border-width');
            } else {
                node.style({
                    'background-color': '#0a0a0f',
                    'border-width': 0,
                });
            }

            return node.animation({
                style: { 'width': fullSize },
                duration: this.EXPAND_DURATION,
                easing: 'ease-out',
            }).play().promise();
        }).then(() => {
            node.removeData('cardFlipping');
        }).catch(() => {
            node.removeData('cardFlipping');
        });
    },

    _resetActive() {
        this._cancelAutoFlip();
        if (this.activeId == null) return;
        this._snapBackActive();
        this.activeId = null;
    },

    _snapBackActive() {
        if (this.activeId == null || !cy) return;
        const node = cy.getElementById(String(this.activeId));
        if (!node || node.empty()) return;
        if (node.data('cardFlipped') !== 1) return;

        node.stop();
        node.removeStyle('width');
        node.removeStyle('background-color');
        node.removeStyle('border-width');
        node.data('photo_url', node.data('wrestlerPhoto'));
        if (node.data('frontIsIcon')) {
            node.data('isIcon', 1);
        } else {
            node.removeData('isIcon');
        }
        node.data('cardFlipped', 0);
        node.removeData('cardFlipping');
    },

    _cancelAutoFlip() {
        if (this.autoFlipTimer) {
            clearTimeout(this.autoFlipTimer);
            this.autoFlipTimer = null;
        }
    },
};
