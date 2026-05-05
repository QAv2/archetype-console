// Gesture Handlers — Phase 11 Session 8
// Subscribes to GestureLayer.events and performs Cytoscape / DOM behavior.
//
// gestures.js produces semantic events (gesture:point, click, grab-*, spin-*,
// lifecycle); this module is the integration layer that turns them into:
//   - hover preview (cy-hover / gesture-hover classes)
//   - clicks (cy.emit('tap') or DOM .click())
//   - node drag (cytomap.dragNodeTo)
//   - hub ring rotation (cytomap.setRingRotation + snapBranchToNearest)
//
// New consumers (three.js, multi-monitor throw, voice-modified gestures, WiLoR
// upgrade) plug in by adding their own listeners — they don't touch this file
// or gestures.js.

(function () {
    'use strict';

    const HOVER_CLASS = 'gesture-hover';

    const state = {
        initialized: false,
        hoveredCytoNode: null,
        hoveredDomEl: null,
    };

    function api() {
        return (window.__archetype && window.__archetype.gesture) || null;
    }

    // Walk up from `el` looking for something that should receive hover/click.
    // Mirrors the original findHoverableAncestor in gestures.js. Skips the
    // gesture overlay/PiP layers themselves (they're transparent passthrough).
    function findHoverableAncestor(el) {
        if (!el) return null;
        let cur = el;
        while (cur && cur !== document.body) {
            if (cur.id === 'gesture-overlay' || cur.id === 'gesture-pip') return null;
            const tag = cur.tagName;
            if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT') return cur;
            if (cur.getAttribute && (cur.getAttribute('role') === 'button' || cur.getAttribute('tabindex') === '0')) return cur;
            if (cur.classList && (
                cur.classList.contains('dock-tab') ||
                cur.classList.contains('archetype-row') ||
                cur.classList.contains('wrestler-row') ||
                cur.classList.contains('breadcrumb-item') ||
                cur.classList.contains('promo-card') ||
                cur.classList.contains('tier-pill')
            )) return cur;
            cur = cur.parentElement;
        }
        return null;
    }

    function clearHover() {
        if (state.hoveredCytoNode) {
            state.hoveredCytoNode.removeClass('cy-hover');
            state.hoveredCytoNode = null;
        }
        if (state.hoveredDomEl) {
            state.hoveredDomEl.classList.remove(HOVER_CLASS);
            state.hoveredDomEl = null;
        }
    }

    function onPoint(e) {
        const target = e.detail.target;

        // Cytoscape node hover.
        if (target && target.type === 'cytoscape-node' && target.ref) {
            if (state.hoveredDomEl) {
                state.hoveredDomEl.classList.remove(HOVER_CLASS);
                state.hoveredDomEl = null;
            }
            const node = target.ref;
            if (state.hoveredCytoNode && state.hoveredCytoNode.id() !== node.id()) {
                state.hoveredCytoNode.removeClass('cy-hover');
            }
            if (!state.hoveredCytoNode || state.hoveredCytoNode.id() !== node.id()) {
                node.addClass('cy-hover');
                state.hoveredCytoNode = node;
            }
            return;
        }

        // DOM hover (resolve to nearest hoverable ancestor).
        if (state.hoveredCytoNode) {
            state.hoveredCytoNode.removeClass('cy-hover');
            state.hoveredCytoNode = null;
        }
        const dom = (target && target.type === 'dom-element') ? findHoverableAncestor(target.ref) : null;
        if (dom !== state.hoveredDomEl) {
            if (state.hoveredDomEl) state.hoveredDomEl.classList.remove(HOVER_CLASS);
            state.hoveredDomEl = dom;
            if (dom) dom.classList.add(HOVER_CLASS);
        }
    }

    function onClick(e) {
        const target = e.detail.target;
        if (target && target.type === 'cytoscape-node' && target.ref) {
            try { target.ref.emit('tap'); }
            catch (err) { console.warn('[gesture-handlers] tap emit failed:', err); }
            return;
        }
        if (target && target.type === 'dom-element' && target.ref) {
            const click = findHoverableAncestor(target.ref) || target.ref;
            if (click && typeof click.click === 'function') click.click();
        }
    }

    function onGrabMove(e) {
        const a = api();
        const target = e.detail.target;
        if (!a || !a.dragNodeTo || !target || !target.ref) return;
        a.dragNodeTo(target.ref, e.detail.position.x, e.detail.position.y);
    }

    function onSpinUpdate(e) {
        const a = api();
        if (a && a.setRingRotation) a.setRingRotation(e.detail.rotation);
    }

    function onSpinEnd() {
        const a = api();
        if (a && a.snapBranchToNearest) a.snapBranchToNearest();
    }

    function onLost() { clearHover(); }
    function onDisabled() { clearHover(); }

    const GestureHandlers = {
        init() {
            if (state.initialized) return;
            const gl = window.GestureLayer;
            if (!gl || !gl.events) {
                console.warn('[gesture-handlers] GestureLayer.events not available');
                return;
            }
            gl.events.addEventListener('gesture:point', onPoint);
            gl.events.addEventListener('gesture:click', onClick);
            gl.events.addEventListener('gesture:grab-move', onGrabMove);
            gl.events.addEventListener('gesture:spin-update', onSpinUpdate);
            gl.events.addEventListener('gesture:spin-end', onSpinEnd);
            gl.events.addEventListener('gesture:lost-tracking', onLost);
            gl.events.addEventListener('gesture:disabled', onDisabled);
            state.initialized = true;
        },
    };

    window.GestureHandlers = GestureHandlers;
})();
