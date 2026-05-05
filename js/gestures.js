// Gesture Layer — Phase 11
// Webcam + MediaPipe Hands → screen-space cursor + thumb-curl trigger.
// Toggle G · Cycle cursor V · Calibrate C · Toggle PiP B
//
// Session 1: foundation (cursor, wag-click, hover preview)
// Session 1.5: PiP preview, 2-corner calibration, EMA smoothing, hold-last-position
// Session 7: thumb-curl trigger replaces finger-wag.
// Session 7.1: Fist replaced with PINCH (drag any node, spin hub-center).
// Session 7.2: Trigger record/capture tool (R) — learns user-specific templates.
// Session 8: SEMANTIC EVENT REFACTOR. gestures.js is now a pure event producer.
//            All Cytoscape/DOM behavior lives in js/gesture_handlers.js, which
//            subscribes to GestureLayer.events. Hit-tests still happen here so
//            payloads carry `target` — but actions (cy.tap, dragNodeTo,
//            setRingRotation, hover classes) are dispatched as events.
//
// Event vocabulary (CustomEvent on GestureLayer.events):
//   gesture:point       { position, target, timestamp }      — every valid frame
//   gesture:click       { position, target, timestamp }
//   gesture:grab-start  { position, target, timestamp }
//   gesture:grab-move   { position, target, timestamp }
//   gesture:grab-end    { position, target, throw, timestamp }
//   gesture:spin-start  { rotation, target, timestamp }
//   gesture:spin-update { rotation, delta, timestamp }
//   gesture:spin-end    { rotation, snappedTo, timestamp }
//   gesture:enabled / gesture:disabled
//   gesture:lost-tracking / gesture:recovered-tracking
//
// Position is {x, y, z}. z=0 today (forward-compatible for stereo/WiLoR).
// Target is {type: 'cytoscape-node'|'dom-element'|'world'|null, ref}.

(function () {
    'use strict';

    // ---- Event bus ----
    const events = new EventTarget();
    function dispatch(name, detail) {
        events.dispatchEvent(new CustomEvent(name, { detail }));
    }

    // ---- State ----
    const state = {
        initialized: false,
        enabled: false,
        starting: false,
        cursorMode: 'hybrid',           // 'hybrid' | 'skeleton' | 'dot'
        pipVisible: true,
        // DOM refs
        video: null,
        overlay: null,
        ctx: null,
        pipEl: null,
        pipCanvas: null,
        pipCtx: null,
        pipStatusEl: null,
        bannerEl: null,
        bannerTimer: null,
        // MediaPipe
        hands: null,
        camera: null,
        // Tracking
        rawTip: { x: 0, y: 0 },        // raw mapped screen coords this frame
        smoothedTip: { x: 0, y: 0 },   // EMA-smoothed screen coords
        fingertip: { x: 0, y: 0, valid: false }, // public cursor coords (== smoothedTip when valid)
        smoothingAlpha: 0.45,
        lastDetectAt: 0,                // performance.now() of last frame with a hand
        holdLastMs: 250,                // hold cursor for this long after losing detection
        smoothingPrimed: false,         // skip EMA blend on first frame after a detection gap
        // Thumb-curl trigger — click only
        // thumbRatio = dist(thumb_tip, index_mcp) / palm_length. Curled ≈ 0.2–0.4; extended ≈ 0.7+.
        // indexExtRatio = dist(index_tip, index_mcp) / palm_length. Pointing pose ≈ 0.9+; index curled ≈ 0.3.
        triggerPressThreshold: 0.55,    // thumbRatio below this → fire click (default heuristic)
        triggerReleaseThreshold: 0.75,  // thumbRatio above this → re-arm
        triggerIndexExtGate: 0.60,      // pose gate (loose; templates carry the precision)
        triggerState: 'idle',           // 'idle' | 'pressed'
        triggerDebounceMs: 200,
        lastClickAt: 0,
        // Learned templates: feature vectors captured at peak-curl in record mode.
        // When non-empty, detection uses min-distance-to-template instead of static threshold.
        // Each template = { thumbRatio, thumbBendNorm, pinchRatio }.
        triggerTemplates: [],
        triggerTemplateDist: 0.18,      // tune up if click misfires; down if it doesn't fire
        // Record mode
        record: {
            active: false,
            capturing: false,
            buf: [],                    // [{ thumbRatio, thumbBendNorm, pinchRatio, indexExt }]
            count: 0,
            target: 5,
        },

        // Pinch gesture — grab/drag + hub-spin
        // pinchRatio = dist(thumb_tip, index_tip) / palm_length.
        // Open hand or pointing ≈ 0.6–1.0; pinched (fingers touching) ≈ 0.05–0.20.
        pinchCloseThreshold: 0.28,      // close transition
        pinchOpenThreshold: 0.45,       // open transition (hysteresis gap 0.17)
        pinchState: 'idle',             // 'idle' | 'closed'
        pinchMode: 'none',              // 'none' | 'drag' | 'spin'
        pinchStartX: 0,
        pinchStartRotation: 0,
        spinSensitivity: 0.005,         // rad per screen-px; mouse-drag in cytomap uses 0.004
        dragNode: null,                 // Cytoscape node being dragged (or null)
        // Calibration: stored in normalized cam coords (post-mirror, so x and y both 0..1 with screen-aligned semantics)
        calibration: null,              // { topLeft: {x,y}, bottomRight: {x,y} }
        calibrationMode: null,          // null | 'topLeft' | 'bottomRight'
        pendingCal: null,               // partial during calibration: { topLeft?: {x,y} }
        // Independent X/Y sensitivity multipliers. >1 shrinks the effective rect along that axis,
        // which means a smaller hand-motion zone in that axis maps to the same screen extent.
        // Decoupling X from Y lets a wide-short cam strip drive a tall screen, etc.
        sensitivityX: 1.0,
        sensitivityY: 1.0,
        sensitivityMin: 0.4,
        sensitivityMax: 6.0,
        sensitivityStep: 1.10,          // ratio per press of [ or ]
        calOffset: { x: 0, y: 0 },      // translates the effective rect's center in cam-space. (0,0) = use raw cal center.
        panStep: 0.025,                 // 2.5% of cam frame per arrow click
        // Latest cam-space landmarks (for PiP rendering)
        lastCamLandmarks: null,
    };

    // MediaPipe Hands skeleton (21 points)
    const HAND_CONNECTIONS = [
        [0, 1], [1, 2], [2, 3], [3, 4],         // thumb
        [0, 5], [5, 6], [6, 7], [7, 8],         // index
        [5, 9], [9, 10], [10, 11], [11, 12],    // middle
        [9, 13], [13, 14], [14, 15], [15, 16],  // ring
        [13, 17], [17, 18], [18, 19], [19, 20], // pinky
        [0, 17],                                 // palm base
    ];
    const WRIST = 0;
    const THUMB_MCP = 2;
    const THUMB_IP = 3;
    const THUMB_TIP = 4;
    const INDEX_MCP = 5;
    const INDEX_TIP = 8;
    const MIDDLE_MCP = 9;

    const CAL_STORAGE_KEY = 'archetypeGestureCal';
    const TRIGGER_TPL_KEY = 'archetypeTriggerTemplates';

    // ---- Public API ----
    const GestureLayer = {
        events,                         // EventTarget — subscribe in gesture_handlers.js

        init() {
            if (state.initialized) return;
            state.video = document.getElementById('gesture-video');
            state.overlay = document.getElementById('gesture-overlay');
            state.pipEl = document.getElementById('gesture-pip');
            state.pipCanvas = document.getElementById('gesture-pip-canvas');
            state.pipStatusEl = document.getElementById('gesture-pip-status');
            state.pipSensValueEl = document.getElementById('gesture-pip-sens');
            if (!state.video || !state.overlay || !state.pipEl || !state.pipCanvas) {
                console.warn('[gestures] missing required DOM elements');
                return;
            }
            state.ctx = state.overlay.getContext('2d');
            state.pipCtx = state.pipCanvas.getContext('2d');
            resizeOverlay();
            window.addEventListener('resize', resizeOverlay);
            loadCalibration();
            loadTriggerTemplates();
            wirePipControls();
            updateSensitivityDisplay();
            state.initialized = true;
        },

        toggle() {
            if (!state.initialized) GestureLayer.init();
            if (state.enabled) {
                GestureLayer.disable();
            } else {
                GestureLayer.enable();
            }
        },

        async enable() {
            if (state.enabled || state.starting) return;
            state.starting = true;

            if (typeof Hands === 'undefined' || typeof Camera === 'undefined') {
                showBanner('Gesture mode unavailable — MediaPipe failed to load');
                state.starting = false;
                return;
            }

            try {
                state.hands = new Hands({
                    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
                });
                state.hands.setOptions({
                    maxNumHands: 1,
                    modelComplexity: 1,
                    minDetectionConfidence: 0.65,
                    minTrackingConfidence: 0.5,
                });
                state.hands.onResults(onResults);

                state.camera = new Camera(state.video, {
                    onFrame: async () => {
                        if (state.enabled && state.hands) {
                            await state.hands.send({ image: state.video });
                        }
                    },
                    width: 640,
                    height: 480,
                });
                await state.camera.start();

                state.enabled = true;
                state.smoothingPrimed = false;
                state.overlay.classList.add('active');
                if (state.pipVisible) state.pipEl.classList.add('active');
                const calMsg = state.calibration ? '' : ' · press C to calibrate';
                showBanner(`Gesture mode ON · V cursor · B PiP${calMsg} · G to exit`, 3500);
                dispatch('gesture:enabled', { timestamp: performance.now() });
            } catch (err) {
                console.warn('[gestures] enable failed:', err);
                const msg = (err && err.name === 'NotAllowedError')
                    ? 'Gesture mode requires camera access — denied'
                    : (err && err.name === 'NotFoundError')
                        ? 'Gesture mode — no camera detected'
                        : 'Gesture mode failed to start';
                showBanner(msg);
                cleanupCamera();
                state.enabled = false;
            } finally {
                state.starting = false;
            }
        },

        disable() {
            if (!state.enabled && !state.starting) return;
            state.enabled = false;
            cleanupCamera();
            state.overlay.classList.remove('active');
            state.pipEl.classList.remove('active');
            clearOverlay();
            exitCalibration(true);
            state.fingertip.valid = false;
            resetTrigger();
            resetPinch();
            state.lastCamLandmarks = null;
            state.smoothingPrimed = false;
            dispatch('gesture:disabled', { timestamp: performance.now() });
        },

        cycleCursorMode() {
            if (!state.enabled) return;
            const order = ['hybrid', 'skeleton', 'dot'];
            const idx = order.indexOf(state.cursorMode);
            state.cursorMode = order[(idx + 1) % order.length];
            showBanner(`Cursor: ${state.cursorMode}`, 1200);
        },

        togglePip() {
            if (!state.enabled) return;
            state.pipVisible = !state.pipVisible;
            state.pipEl.classList.toggle('active', state.pipVisible);
        },

        startCalibration() {
            if (!state.enabled) {
                showBanner('Enable gesture mode first (G)');
                return;
            }
            startCalibration();
        },

        clearCalibration() {
            state.calibration = null;
            state.sensitivityX = 1.0;
            state.sensitivityY = 1.0;
            state.calOffset = { x: 0, y: 0 };
            try { localStorage.removeItem(CAL_STORAGE_KEY); } catch (_) { /* noop */ }
            updateSensitivityDisplay();
            showBanner('Calibration cleared');
        },

        adjustSensitivity(factor) {
            if (!state.calibration) {
                showBanner('Calibrate first (C)', 1500);
                return;
            }
            const clamp = (v) => Math.max(state.sensitivityMin, Math.min(state.sensitivityMax, v));
            state.sensitivityX = clamp(state.sensitivityX * factor);
            state.sensitivityY = clamp(state.sensitivityY * factor);
            saveCalibration();
            updateSensitivityDisplay();
            showBanner(`Sensitivity: X ${state.sensitivityX.toFixed(2)}× · Y ${state.sensitivityY.toFixed(2)}×`, 900);
        },

        adjustSensitivityAxis(axis, factor) {
            if (!state.calibration) {
                showBanner('Calibrate first (C)', 1500);
                return;
            }
            if (axis !== 'x' && axis !== 'y') return;
            const key = axis === 'x' ? 'sensitivityX' : 'sensitivityY';
            const next = state[key] * factor;
            state[key] = Math.max(state.sensitivityMin, Math.min(state.sensitivityMax, next));
            saveCalibration();
            updateSensitivityDisplay();
            const label = axis === 'x' ? 'X' : 'Y';
            showBanner(`${label}-axis sensitivity: ${state[key].toFixed(2)}×`, 900);
        },

        resetSensitivity() {
            state.sensitivityX = 1.0;
            state.sensitivityY = 1.0;
            saveCalibration();
            updateSensitivityDisplay();
            showBanner('Sensitivity: 1.00× / 1.00×', 900);
        },

        panOffset(dx, dy) {
            if (!state.calibration) {
                showBanner('Calibrate first (C)', 1500);
                return;
            }
            state.calOffset.x += dx;
            state.calOffset.y += dy;
            saveCalibration();
        },

        anchorOnHand() {
            if (!state.calibration) {
                showBanner('Calibrate first (C)', 1500);
                return;
            }
            if (!state.lastCamLandmarks) {
                showBanner('Show hand to camera first', 1500);
                return;
            }
            const cal = state.calibration;
            const camTip = landmarkToCamCoords(state.lastCamLandmarks[INDEX_TIP]);
            const baseCx = (cal.topLeft.x + cal.bottomRight.x) / 2;
            const baseCy = (cal.topLeft.y + cal.bottomRight.y) / 2;
            state.calOffset.x = camTip.x - baseCx;
            state.calOffset.y = camTip.y - baseCy;
            saveCalibration();
            showBanner('Zone anchored on hand', 1100);
        },

        resetOffset() {
            state.calOffset = { x: 0, y: 0 };
            saveCalibration();
            showBanner('Zone re-centered', 900);
        },

        isEnabled: () => state.enabled,
        isCalibrating: () => !!state.calibrationMode,

        // ---- Trigger record/capture tool ----
        toggleRecordMode() {
            if (!state.enabled) {
                showBanner('Enable gesture mode first (G)', 1500);
                return;
            }
            if (state.record.active) {
                exitRecord(true);
            } else {
                startRecord();
            }
        },

        clearTriggerTemplates() {
            state.triggerTemplates = [];
            try { localStorage.removeItem(TRIGGER_TPL_KEY); } catch (_) { /* noop */ }
            showBanner('Trigger templates cleared · using default heuristic', 1800);
        },

        getTriggerInfo() {
            return {
                templates: state.triggerTemplates.length,
                recording: state.record.active,
                recordCount: state.record.count,
                recordTarget: state.record.target,
            };
        },
    };

    // ---- Camera lifecycle ----
    function cleanupCamera() {
        try {
            if (state.camera && typeof state.camera.stop === 'function') state.camera.stop();
        } catch (_) { /* noop */ }
        state.camera = null;
        try {
            if (state.video && state.video.srcObject) {
                state.video.srcObject.getTracks().forEach((t) => t.stop());
                state.video.srcObject = null;
            }
        } catch (_) { /* noop */ }
        if (state.hands) {
            try { state.hands.close(); } catch (_) { /* noop */ }
            state.hands = null;
        }
    }

    // ---- Overlay sizing ----
    function resizeOverlay() {
        if (!state.overlay) return;
        const dpr = window.devicePixelRatio || 1;
        state.overlay.width = window.innerWidth * dpr;
        state.overlay.height = window.innerHeight * dpr;
        state.overlay.style.width = window.innerWidth + 'px';
        state.overlay.style.height = window.innerHeight + 'px';
        if (state.ctx) state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function clearOverlay() {
        if (!state.ctx) return;
        state.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }

    // ---- Coord mapping ----
    // Convert raw landmark to normalized cam coords with x mirrored (selfie view).
    // After mirror: (0,0) = top-left of what user sees in their PiP.
    function landmarkToCamCoords(landmark) {
        return { x: 1 - landmark.x, y: landmark.y };
    }

    // Effective rect: calibration rect scaled by 1/sensitivity around its center,
    // then translated by calOffset (so user can reposition the active zone).
    function getEffectiveRect() {
        const cal = state.calibration;
        if (!cal) return null;
        const cx = (cal.topLeft.x + cal.bottomRight.x) / 2 + state.calOffset.x;
        const cy = (cal.topLeft.y + cal.bottomRight.y) / 2 + state.calOffset.y;
        const halfW = (cal.bottomRight.x - cal.topLeft.x) / 2 / state.sensitivityX;
        const halfH = (cal.bottomRight.y - cal.topLeft.y) / 2 / state.sensitivityY;
        return {
            topLeft: { x: cx - halfW, y: cy - halfH },
            bottomRight: { x: cx + halfW, y: cy + halfH },
        };
    }

    // Map cam coords → screen coords, applying calibration + sensitivity if present.
    function camToScreen(cam) {
        let xMapped, yMapped;
        const eff = getEffectiveRect();
        if (eff) {
            const dx = eff.bottomRight.x - eff.topLeft.x || 0.0001;
            const dy = eff.bottomRight.y - eff.topLeft.y || 0.0001;
            xMapped = (cam.x - eff.topLeft.x) / dx;
            yMapped = (cam.y - eff.topLeft.y) / dy;
        } else {
            xMapped = cam.x;
            yMapped = cam.y;
        }
        xMapped = Math.max(0, Math.min(1, xMapped));
        yMapped = Math.max(0, Math.min(1, yMapped));
        return { x: xMapped * window.innerWidth, y: yMapped * window.innerHeight };
    }

    // ---- MediaPipe results callback ----
    function onResults(results) {
        if (!state.enabled) return;
        clearOverlay();

        const hands = (results && results.multiHandLandmarks) || [];
        const now = performance.now();

        if (hands.length === 0) {
            state.lastCamLandmarks = null;
            // Hold last position for a brief grace period.
            const since = now - state.lastDetectAt;
            if (state.fingertip.valid && since < state.holdLastMs) {
                renderCursorAt(state.fingertip.x, state.fingertip.y, 1 - since / state.holdLastMs);
            } else {
                const wasValid = state.fingertip.valid;
                state.fingertip.valid = false;
                state.smoothingPrimed = false;
                // Lost hand mid-gesture: emit clean end-events so handlers can release.
                if (state.pinchState !== 'idle') {
                    if (state.pinchMode === 'spin') {
                        dispatch('gesture:spin-end', {
                            rotation: getCurrentRotation(),
                            snappedTo: null,
                            timestamp: now,
                        });
                    } else if (state.pinchMode === 'drag') {
                        dispatch('gesture:grab-end', {
                            position: { x: state.smoothedTip.x, y: state.smoothedTip.y, z: 0 },
                            target: state.dragNode ? { type: 'cytoscape-node', ref: state.dragNode } : null,
                            throw: false,
                            timestamp: now,
                        });
                    }
                    resetPinch();
                }
                if (state.triggerState !== 'idle') resetTrigger();
                if (wasValid) {
                    dispatch('gesture:lost-tracking', { timestamp: now });
                }
            }
            renderPip(results.image, null);
            return;
        }

        // Use first detected hand.
        const landmarks = hands[0];
        state.lastCamLandmarks = landmarks;
        const wasInvalid = !state.fingertip.valid;
        state.lastDetectAt = now;

        // Compute cam-space + screen-space fingertip.
        const camTip = landmarkToCamCoords(landmarks[INDEX_TIP]);
        const rawScreen = camToScreen(camTip);
        state.rawTip.x = rawScreen.x;
        state.rawTip.y = rawScreen.y;

        // EMA smoothing.
        if (!state.smoothingPrimed) {
            state.smoothedTip.x = rawScreen.x;
            state.smoothedTip.y = rawScreen.y;
            state.smoothingPrimed = true;
        } else {
            const a = state.smoothingAlpha;
            state.smoothedTip.x = a * rawScreen.x + (1 - a) * state.smoothedTip.x;
            state.smoothedTip.y = a * rawScreen.y + (1 - a) * state.smoothedTip.y;
        }
        state.fingertip.x = state.smoothedTip.x;
        state.fingertip.y = state.smoothedTip.y;
        state.fingertip.valid = true;

        // Build screen-space landmark array (for skeleton render).
        const screenPoints = landmarks.map((p) => {
            const c = landmarkToCamCoords(p);
            return camToScreen(c);
        });
        // Override index tip with smoothed position so the dot doesn't lag the raw.
        screenPoints[INDEX_TIP] = { x: state.smoothedTip.x, y: state.smoothedTip.y };

        // Render main overlay per cursorMode.
        if (state.cursorMode === 'skeleton') {
            drawSkeleton(state.ctx, screenPoints, 1.0, 2);
            drawFingertip(screenPoints[INDEX_TIP], 1.0);
        } else if (state.cursorMode === 'hybrid') {
            drawSkeleton(state.ctx, screenPoints, 0.22, 2);
            drawFingertip(screenPoints[INDEX_TIP], 1.0);
        } else {
            drawFingertip(screenPoints[INDEX_TIP], 1.0);
        }

        // Per-frame feature vector for trigger / pinch.
        const features = computeFeatures(landmarks);

        if (wasInvalid) {
            dispatch('gesture:recovered-tracking', { timestamp: now });
        }

        if (!state.calibrationMode) {
            // gesture:point fires every valid frame. Hit-test once; subscribers
            // (hover, click, downstream layers) all read this.
            // Suppress target updates while pinched — drag/spin own the target.
            const target = (state.pinchState !== 'closed')
                ? computeTarget(state.smoothedTip.x, state.smoothedTip.y)
                : null;
            dispatch('gesture:point', {
                position: { x: state.smoothedTip.x, y: state.smoothedTip.y, z: 0 },
                target,
                timestamp: now,
            });
            updatePinch(features.pinchRatio, now);
            if (state.record.active) {
                updateRecord(features, now);
            } else {
                updateTrigger(features, now);
            }
        } else {
            // During calibration: clear hover by emitting a null-target point.
            dispatch('gesture:point', {
                position: { x: state.smoothedTip.x, y: state.smoothedTip.y, z: 0 },
                target: null,
                timestamp: now,
            });
            if (state.pinchState !== 'idle') resetPinch();
            if (state.triggerState !== 'idle') resetTrigger();
            if (state.record.active) exitRecord(true);
        }

        renderPip(results.image, landmarks);
    }

    // Hit-test the screen at (x, y) and produce a semantic target descriptor.
    // Cytoscape-node has highest priority; falls back to whatever DOM element is
    // there (handler decides if it's hoverable/clickable).
    function computeTarget(x, y) {
        const api = (window.__archetype && window.__archetype.gesture) || null;
        const cytoNode = api ? api.hitTestNode(x, y) : null;
        if (cytoNode) return { type: 'cytoscape-node', ref: cytoNode };
        const el = document.elementFromPoint(x, y);
        if (el) return { type: 'dom-element', ref: el };
        return { type: 'world', ref: null };
    }

    function getCurrentRotation() {
        const api = (window.__archetype && window.__archetype.gesture) || null;
        if (api && api.getRingState) return api.getRingState().rotation || 0;
        return 0;
    }

    // Render only the cursor (used during hold-last-position).
    function renderCursorAt(x, y, alpha) {
        if (state.cursorMode === 'skeleton' || state.cursorMode === 'hybrid') {
            // Without landmarks we can only render the fingertip.
        }
        drawFingertip({ x, y }, Math.max(0.2, alpha));
    }

    // ---- Landmark ratio helpers ----
    // All ratios are normalized by palm length (wrist → middle MCP) for scale invariance.
    function computePalmLength(lm) {
        if (!lm || !lm[WRIST] || !lm[MIDDLE_MCP]) return 0.0001;
        const dx = lm[MIDDLE_MCP].x - lm[WRIST].x;
        const dy = lm[MIDDLE_MCP].y - lm[WRIST].y;
        return Math.sqrt(dx * dx + dy * dy) || 0.0001;
    }

    function computeNormDist(lm, aIdx, bIdx, palmLen) {
        if (!lm || !lm[aIdx] || !lm[bIdx]) return 1.0;
        const dx = lm[aIdx].x - lm[bIdx].x;
        const dy = lm[aIdx].y - lm[bIdx].y;
        return Math.sqrt(dx * dx + dy * dy) / palmLen;
    }

    // ---- Feature extraction ----
    // Joint angle (radians) at vertex b between rays b→a and b→c. View-invariant within reason.
    function angleAt(lm, a, b, c) {
        if (!lm || !lm[a] || !lm[b] || !lm[c]) return Math.PI;
        const v1x = lm[a].x - lm[b].x, v1y = lm[a].y - lm[b].y;
        const v2x = lm[c].x - lm[b].x, v2y = lm[c].y - lm[b].y;
        const dot = v1x * v2x + v1y * v2y;
        const m1 = Math.sqrt(v1x * v1x + v1y * v1y) || 1e-9;
        const m2 = Math.sqrt(v2x * v2x + v2y * v2y) || 1e-9;
        return Math.acos(Math.max(-1, Math.min(1, dot / (m1 * m2))));
    }

    function computeFeatures(landmarks) {
        const palmLen = computePalmLength(landmarks);
        const thumbRatio = computeNormDist(landmarks, THUMB_TIP, INDEX_MCP, palmLen);
        const pinchRatio = computeNormDist(landmarks, THUMB_TIP, INDEX_TIP, palmLen);
        const indexExt = computeNormDist(landmarks, INDEX_TIP, INDEX_MCP, palmLen);
        // Thumb bend angle at the IP joint. ~π = straight thumb; smaller = curled.
        const thumbBend = angleAt(landmarks, THUMB_MCP, THUMB_IP, THUMB_TIP);
        const thumbBendNorm = thumbBend / Math.PI; // normalize to [0,1] for feature vector
        return { thumbRatio, pinchRatio, indexExt, thumbBend, thumbBendNorm };
    }

    // Distance from current frame to a single template. Pinch is included so a pinch pose
    // (which lowers thumbRatio similarly to curl in some hand orientations) is differentiable.
    function featureDistance(f, tpl) {
        const dr = f.thumbRatio - tpl.thumbRatio;
        const da = f.thumbBendNorm - tpl.thumbBendNorm;
        const dp = f.pinchRatio - tpl.pinchRatio;
        return Math.sqrt(dr * dr + da * da + dp * dp);
    }

    // ---- Thumb-curl trigger (click) ----
    // If templates exist, fire when min-distance to any template < dist threshold.
    // Else, fall back to the static thumbRatio threshold.
    function updateTrigger(features, now) {
        const tip = state.smoothedTip;
        const useTemplates = state.triggerTemplates.length > 0;

        const poseOK = features.indexExt > state.triggerIndexExtGate
                && state.pinchState !== 'closed';

        let pressed;
        if (useTemplates) {
            let minD = Infinity;
            for (const t of state.triggerTemplates) {
                const d = featureDistance(features, t);
                if (d < minD) minD = d;
            }
            pressed = minD < state.triggerTemplateDist;
        } else {
            pressed = features.thumbRatio < state.triggerPressThreshold;
        }

        if (state.triggerState === 'idle' && pressed && poseOK
                && (now - state.lastClickAt) > state.triggerDebounceMs) {
            state.triggerState = 'pressed';
            state.lastClickAt = now;
            dispatch('gesture:click', {
                position: { x: tip.x, y: tip.y, z: 0 },
                target: computeTarget(tip.x, tip.y),
                timestamp: now,
            });
            drawClickPulse({ x: tip.x, y: tip.y });
            return;
        }

        // Re-arm hysteresis: require either thumb to extend OR (template mode) features to
        // drift far enough from any template.
        if (state.triggerState === 'pressed') {
            const released = useTemplates
                ? !pressed && features.thumbRatio > state.triggerReleaseThreshold
                : features.thumbRatio > state.triggerReleaseThreshold;
            if (released) state.triggerState = 'idle';
        }
    }

    function resetTrigger() {
        state.triggerState = 'idle';
    }

    // ---- Record / capture tool ----
    // R toggles record mode. While active, each "thumb-curl cycle" captures one template:
    //   - capture starts when thumbRatio dips below 0.55
    //   - capture ends when thumbRatio rises above 0.75 (or buf > 30 frames)
    //   - the buf frame with min thumbRatio is used as the template
    // After `target` captures, save and exit. ESC also exits.
    function startRecord() {
        state.record.active = true;
        state.record.capturing = false;
        state.record.buf = [];
        state.record.count = 0;
        showBanner(`REC trigger 0/${state.record.target} · pull trigger to capture · vary your hand angle · R/ESC to stop`, 999999);
    }

    function exitRecord(silent) {
        const had = state.record.count;
        state.record.active = false;
        state.record.capturing = false;
        state.record.buf = [];
        if (silent) {
            showBanner(had > 0 ? `Record stopped · ${had} templates kept` : 'Record cancelled', 1500);
        }
    }

    function updateRecord(features, now) {
        const r = state.record;

        if (!r.capturing) {
            if (features.thumbRatio < state.triggerPressThreshold) {
                r.capturing = true;
                r.buf = [Object.assign({}, features)];
            }
            return;
        }

        // Capturing: append until the user releases or buf is full.
        r.buf.push(Object.assign({}, features));
        const released = features.thumbRatio > state.triggerReleaseThreshold;
        if (released || r.buf.length > 40) {
            // Pick frame with minimum thumbRatio as the template.
            let best = r.buf[0];
            for (const f of r.buf) {
                if (f.thumbRatio < best.thumbRatio) best = f;
            }
            const tpl = {
                thumbRatio: best.thumbRatio,
                thumbBendNorm: best.thumbBendNorm,
                pinchRatio: best.pinchRatio,
            };
            state.triggerTemplates.push(tpl);
            r.count++;
            r.capturing = false;
            r.buf = [];
            // Brief pulse for capture feedback.
            drawClickPulse({ x: state.smoothedTip.x, y: state.smoothedTip.y });
            if (r.count >= r.target) {
                saveTriggerTemplates();
                state.record.active = false;
                showBanner(`Trigger learned · ${r.count} templates saved`, 2800);
            } else {
                showBanner(`REC trigger ${r.count}/${r.target} · keep going`, 1400);
            }
        }
        void now;
    }

    function saveTriggerTemplates() {
        try {
            localStorage.setItem(TRIGGER_TPL_KEY, JSON.stringify(state.triggerTemplates));
        } catch (err) {
            console.warn('[gestures] saveTriggerTemplates failed:', err);
        }
    }

    function loadTriggerTemplates() {
        try {
            const raw = localStorage.getItem(TRIGGER_TPL_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                state.triggerTemplates = parsed.filter(t =>
                    t && typeof t.thumbRatio === 'number'
                    && typeof t.thumbBendNorm === 'number'
                    && typeof t.pinchRatio === 'number'
                );
            }
        } catch (err) {
            console.warn('[gestures] loadTriggerTemplates failed:', err);
        }
    }

    // ---- Pinch gesture (grab/drag + hub-spin) ----
    function updatePinch(pinchRatio, now) {
        const tip = state.smoothedTip;
        const api = (window.__archetype && window.__archetype.gesture) || null;

        if (state.pinchState === 'idle' && pinchRatio < state.pinchCloseThreshold) {
            state.pinchState = 'closed';
            state.pinchStartX = tip.x;
            const node = api ? api.hitTestNode(tip.x, tip.y) : null;
            const inBranchView = api && api.isInBranchView && api.isInBranchView();

            if (node && node.hasClass && node.hasClass('branch-center') && inBranchView) {
                state.pinchMode = 'spin';
                state.pinchStartRotation = getCurrentRotation();
                state.dragNode = null;
                dispatch('gesture:spin-start', {
                    rotation: state.pinchStartRotation,
                    target: { type: 'cytoscape-node', ref: node },
                    timestamp: now,
                });
            } else if (node) {
                state.pinchMode = 'drag';
                state.dragNode = node;
                dispatch('gesture:grab-start', {
                    position: { x: tip.x, y: tip.y, z: 0 },
                    target: { type: 'cytoscape-node', ref: node },
                    timestamp: now,
                });
            } else {
                state.pinchMode = 'none';
                state.dragNode = null;
            }
            return;
        }

        if (state.pinchState === 'closed') {
            if (state.pinchMode === 'drag' && state.dragNode) {
                dispatch('gesture:grab-move', {
                    position: { x: tip.x, y: tip.y, z: 0 },
                    target: { type: 'cytoscape-node', ref: state.dragNode },
                    timestamp: now,
                });
            } else if (state.pinchMode === 'spin') {
                const dx = tip.x - state.pinchStartX;
                const rotation = state.pinchStartRotation + dx * state.spinSensitivity;
                dispatch('gesture:spin-update', {
                    rotation,
                    delta: dx * state.spinSensitivity,
                    timestamp: now,
                });
            }

            if (pinchRatio > state.pinchOpenThreshold) {
                if (state.pinchMode === 'spin') {
                    dispatch('gesture:spin-end', {
                        rotation: getCurrentRotation(),
                        snappedTo: null,    // handler may snap and update; no echo back
                        timestamp: now,
                    });
                } else if (state.pinchMode === 'drag') {
                    dispatch('gesture:grab-end', {
                        position: { x: tip.x, y: tip.y, z: 0 },
                        target: state.dragNode ? { type: 'cytoscape-node', ref: state.dragNode } : null,
                        throw: false,
                        timestamp: now,
                    });
                }
                resetPinch();
            }
        }
        void api;
    }

    function resetPinch() {
        state.pinchState = 'idle';
        state.pinchMode = 'none';
        state.dragNode = null;
    }

    // ---- Rendering: main overlay ----
    function drawSkeleton(ctx, points, alpha, lineWidth) {
        ctx.save();
        ctx.strokeStyle = `rgba(74, 158, 255, ${alpha})`;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        for (const [a, b] of HAND_CONNECTIONS) {
            ctx.beginPath();
            ctx.moveTo(points[a].x, points[a].y);
            ctx.lineTo(points[b].x, points[b].y);
            ctx.stroke();
        }
        ctx.fillStyle = `rgba(180, 220, 255, ${alpha})`;
        for (let i = 0; i < points.length; i++) {
            if (i === INDEX_TIP) continue;
            ctx.beginPath();
            ctx.arc(points[i].x, points[i].y, lineWidth * 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    function drawFingertip(p, alpha) {
        const ctx = state.ctx;
        ctx.save();
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 26);
        grad.addColorStop(0, `rgba(120, 200, 255, ${0.55 * alpha})`);
        grad.addColorStop(1, 'rgba(120, 200, 255, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 26, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255, 255, 255, ${0.95 * alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(74, 158, 255, ${0.9 * alpha})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    function drawClickPulse(p) {
        const start = performance.now();
        const animate = () => {
            if (!state.enabled) return;
            const dt = performance.now() - start;
            if (dt > 280) return;
            const r = 10 + (dt / 280) * 36;
            const alpha = 1 - dt / 280;
            const ctx = state.ctx;
            ctx.save();
            ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
            requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    }

    // ---- PiP rendering ----
    function renderPip(image, landmarks) {
        if (!state.pipVisible || !state.pipCtx) return;
        const ctx = state.pipCtx;
        const w = state.pipCanvas.width;
        const h = state.pipCanvas.height;

        ctx.clearRect(0, 0, w, h);

        // Mirrored video frame.
        if (image) {
            ctx.save();
            ctx.translate(w, 0);
            ctx.scale(-1, 1);
            try {
                ctx.drawImage(image, 0, 0, w, h);
            } catch (_) { /* image may not be ready */ }
            ctx.restore();
        }

        // Calibration rectangles: faint = raw calibration, bright = effective (after sensitivity).
        if (state.calibration) {
            if (state.sensitivityX !== 1.0 || state.sensitivityY !== 1.0) {
                drawCalRect(ctx, state.calibration.topLeft, state.calibration.bottomRight, 'rgba(74, 158, 255, 0.25)', w, h);
            }
            const eff = getEffectiveRect();
            drawCalRect(ctx, eff.topLeft, eff.bottomRight, 'rgba(126, 212, 255, 0.95)', w, h);
        }
        // Pending calibration markers.
        if (state.pendingCal && state.pendingCal.topLeft) {
            drawCalCorner(ctx, state.pendingCal.topLeft, '#ffd357', 'TL', w, h);
        }

        // Landmarks (in cam coords, already mirrored).
        if (landmarks) {
            const pipPoints = landmarks.map((p) => {
                const c = landmarkToCamCoords(p);
                return { x: c.x * w, y: c.y * h };
            });
            drawSkeleton(ctx, pipPoints, 0.85, 1.5);
            // Bright tip.
            const tip = pipPoints[INDEX_TIP];
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.95)';
            ctx.beginPath();
            ctx.arc(tip.x, tip.y, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(74,158,255,0.95)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(tip.x, tip.y, 6, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        // Border state.
        const detected = !!landmarks;
        state.pipEl.classList.toggle('no-detect', !detected);
        if (state.pipStatusEl) {
            if (state.calibrationMode === 'topLeft') {
                state.pipStatusEl.textContent = 'CAL 1/2 · TOP-LEFT · SPACE';
            } else if (state.calibrationMode === 'bottomRight') {
                state.pipStatusEl.textContent = 'CAL 2/2 · BOTTOM-RIGHT · SPACE';
            } else if (state.calibration) {
                state.pipStatusEl.textContent = detected ? 'TRACKING' : 'NO HAND';
            } else {
                state.pipStatusEl.textContent = detected ? 'NO CAL · PRESS C' : 'NO HAND';
            }
        }
    }

    function drawCalRect(ctx, tl, br, stroke, w, h) {
        ctx.save();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        const x1 = tl.x * w, y1 = tl.y * h;
        const x2 = br.x * w, y2 = br.y * h;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        ctx.restore();
    }

    function drawCalCorner(ctx, p, color, label, w, h) {
        ctx.save();
        const x = p.x * w, y = p.y * h;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = "10px 'Oswald', sans-serif";
        ctx.fillText(label, x + 8, y - 4);
        ctx.restore();
    }

    // ---- Calibration flow ----
    function startCalibration() {
        state.calibrationMode = 'topLeft';
        state.pendingCal = {};
        // Hover clears on next frame via gesture:point with target=null.
        showBanner('CALIBRATE 1/2 — Hold hand at SCREEN TOP-LEFT, press SPACE (ESC to cancel)', 999999);
    }

    function captureCalibrationPoint() {
        if (!state.calibrationMode) return;
        if (!state.lastCamLandmarks) {
            showBanner('No hand detected — show your hand to camera', 1500);
            return;
        }
        const camTip = landmarkToCamCoords(state.lastCamLandmarks[INDEX_TIP]);
        if (state.calibrationMode === 'topLeft') {
            state.pendingCal.topLeft = camTip;
            state.calibrationMode = 'bottomRight';
            showBanner('CALIBRATE 2/2 — Hold hand at SCREEN BOTTOM-RIGHT, press SPACE', 999999);
        } else if (state.calibrationMode === 'bottomRight') {
            state.pendingCal.bottomRight = camTip;
            // Sanity: bottomRight must be down-and-right of topLeft. If user reversed, swap.
            const tl = state.pendingCal.topLeft;
            const br = state.pendingCal.bottomRight;
            const fixed = {
                topLeft: { x: Math.min(tl.x, br.x), y: Math.min(tl.y, br.y) },
                bottomRight: { x: Math.max(tl.x, br.x), y: Math.max(tl.y, br.y) },
            };
            // Ensure non-degenerate.
            if (fixed.bottomRight.x - fixed.topLeft.x < 0.05 || fixed.bottomRight.y - fixed.topLeft.y < 0.05) {
                showBanner('Calibration too narrow — try again with wider range', 2500);
                exitCalibration(true);
                return;
            }
            state.calibration = fixed;
            state.sensitivityX = 1.0; // fresh calibration resets sensitivity (both axes)
            state.sensitivityY = 1.0;
            state.calOffset = { x: 0, y: 0 }; // and offset
            saveCalibration();
            updateSensitivityDisplay();
            exitCalibration(false);
            showBanner('Calibrated · − + uniform · ↔ ↕ per-axis · [ ] keys', 2800);
        }
    }

    function exitCalibration(silent) {
        if (!state.calibrationMode && !state.pendingCal) return;
        state.calibrationMode = null;
        state.pendingCal = null;
        if (!silent) showBanner('Calibration cancelled', 1500);
    }

    function saveCalibration() {
        if (!state.calibration) return;
        try {
            localStorage.setItem(CAL_STORAGE_KEY, JSON.stringify({
                version: 4,
                topLeft: state.calibration.topLeft,
                bottomRight: state.calibration.bottomRight,
                sensitivityX: state.sensitivityX,
                sensitivityY: state.sensitivityY,
                offset: state.calOffset,
            }));
        } catch (err) {
            console.warn('[gestures] saveCalibration failed:', err);
        }
    }

    function loadCalibration() {
        try {
            const raw = localStorage.getItem(CAL_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (parsed && parsed.topLeft && parsed.bottomRight) {
                state.calibration = { topLeft: parsed.topLeft, bottomRight: parsed.bottomRight };
                const clamp = (v) => Math.max(state.sensitivityMin, Math.min(state.sensitivityMax, v));
                // v4: independent X/Y. v3 (and earlier): single sensitivity → copy to both.
                if (typeof parsed.sensitivityX === 'number' && isFinite(parsed.sensitivityX)) {
                    state.sensitivityX = clamp(parsed.sensitivityX);
                }
                if (typeof parsed.sensitivityY === 'number' && isFinite(parsed.sensitivityY)) {
                    state.sensitivityY = clamp(parsed.sensitivityY);
                }
                if (typeof parsed.sensitivity === 'number' && isFinite(parsed.sensitivity)
                        && typeof parsed.sensitivityX !== 'number') {
                    const s = clamp(parsed.sensitivity);
                    state.sensitivityX = s;
                    state.sensitivityY = s;
                }
                if (parsed.offset && typeof parsed.offset.x === 'number' && typeof parsed.offset.y === 'number') {
                    state.calOffset = { x: parsed.offset.x, y: parsed.offset.y };
                }
            }
        } catch (err) {
            console.warn('[gestures] loadCalibration failed:', err);
        }
    }

    // ---- PiP control wiring ----
    function wirePipControls() {
        const btnMinus = document.getElementById('gesture-pip-minus');
        const btnPlus = document.getElementById('gesture-pip-plus');
        const btnReset = document.getElementById('gesture-pip-reset');
        const btnCal = document.getElementById('gesture-pip-cal');
        if (btnMinus) btnMinus.addEventListener('click', () => GestureLayer.adjustSensitivity(1 / state.sensitivityStep));
        if (btnPlus) btnPlus.addEventListener('click', () => GestureLayer.adjustSensitivity(state.sensitivityStep));
        if (btnReset) btnReset.addEventListener('click', () => GestureLayer.resetSensitivity());
        if (btnCal) btnCal.addEventListener('click', () => GestureLayer.startCalibration());

        const btnPanLeft = document.getElementById('gesture-pip-pan-left');
        const btnPanRight = document.getElementById('gesture-pip-pan-right');
        const btnPanUp = document.getElementById('gesture-pip-pan-up');
        const btnPanDown = document.getElementById('gesture-pip-pan-down');
        const btnAnchor = document.getElementById('gesture-pip-anchor');
        const btnPanReset = document.getElementById('gesture-pip-pan-reset');
        if (btnPanLeft) btnPanLeft.addEventListener('click', () => GestureLayer.panOffset(-state.panStep, 0));
        if (btnPanRight) btnPanRight.addEventListener('click', () => GestureLayer.panOffset(state.panStep, 0));
        if (btnPanUp) btnPanUp.addEventListener('click', () => GestureLayer.panOffset(0, -state.panStep));
        if (btnPanDown) btnPanDown.addEventListener('click', () => GestureLayer.panOffset(0, state.panStep));
        if (btnAnchor) btnAnchor.addEventListener('click', () => GestureLayer.anchorOnHand());
        if (btnPanReset) btnPanReset.addEventListener('click', () => GestureLayer.resetOffset());

        // Per-axis sensitivity buttons (Row 3)
        const btnXMinus = document.getElementById('gesture-pip-x-minus');
        const btnXPlus = document.getElementById('gesture-pip-x-plus');
        const btnYMinus = document.getElementById('gesture-pip-y-minus');
        const btnYPlus = document.getElementById('gesture-pip-y-plus');
        if (btnXMinus) btnXMinus.addEventListener('click', () => GestureLayer.adjustSensitivityAxis('x', 1 / state.sensitivityStep));
        if (btnXPlus) btnXPlus.addEventListener('click', () => GestureLayer.adjustSensitivityAxis('x', state.sensitivityStep));
        if (btnYMinus) btnYMinus.addEventListener('click', () => GestureLayer.adjustSensitivityAxis('y', 1 / state.sensitivityStep));
        if (btnYPlus) btnYPlus.addEventListener('click', () => GestureLayer.adjustSensitivityAxis('y', state.sensitivityStep));
    }

    function updateSensitivityDisplay() {
        if (state.pipSensValueEl) {
            const sx = state.sensitivityX.toFixed(2);
            const sy = state.sensitivityY.toFixed(2);
            state.pipSensValueEl.textContent = (sx === sy)
                ? `${sx}×`
                : `X ${sx} · Y ${sy}`;
        }
    }

    // ---- Calibration key handling (only active during calibration mode) ----
    document.addEventListener('keydown', (e) => {
        if (!state.calibrationMode) return;
        if (e.key === ' ' || e.code === 'Space') {
            e.preventDefault();
            captureCalibrationPoint();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            exitCalibration(false);
        }
    }, true); // capture phase so we beat any other Space handler

    // ---- Banner ----
    function showBanner(msg, ms = 4000) {
        if (!state.bannerEl) {
            state.bannerEl = document.createElement('div');
            state.bannerEl.className = 'gesture-banner';
            document.body.appendChild(state.bannerEl);
        }
        state.bannerEl.textContent = msg;
        // eslint-disable-next-line no-unused-expressions
        state.bannerEl.offsetWidth;
        state.bannerEl.classList.add('show');
        if (state.bannerTimer) { clearTimeout(state.bannerTimer); state.bannerTimer = null; }
        if (ms < 999999) {
            state.bannerTimer = setTimeout(() => {
                if (state.bannerEl) state.bannerEl.classList.remove('show');
            }, ms);
        }
    }

    window.GestureLayer = GestureLayer;
})();
