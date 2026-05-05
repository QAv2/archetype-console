(async function () {
    const loadingScreen = document.getElementById('loading-screen');
    const loadingStatus = document.getElementById('loading-status');
    const loadingBarFill = document.getElementById('loading-bar-fill');

    function setProgress(msg, pct) {
        if (loadingStatus) loadingStatus.textContent = msg;
        if (loadingBarFill) {
            loadingBarFill.style.width = pct + '%';
            loadingBarFill.setAttribute('aria-valuenow', Math.round(pct));
        }
    }

    function dismissLoading() {
        if (!loadingScreen) return;
        loadingScreen.classList.add('ready');
        setProgress('CLICK TO ENTER', 100);
        const enter = () => {
            loadingScreen.removeEventListener('click', enter);
            document.removeEventListener('keydown', enterKey);
            loadingScreen.classList.add('done');
            setTimeout(() => { loadingScreen.style.display = 'none'; }, 600);
        };
        const enterKey = (e) => {
            if (e.key === 'Enter' || e.key === ' ') enter();
        };
        loadingScreen.addEventListener('click', enter);
        document.addEventListener('keydown', enterKey);
        loadingScreen.style.cursor = 'pointer';
    }

    function showLoadingError(msg) {
        if (loadingStatus) {
            loadingStatus.textContent = msg;
            loadingStatus.style.color = '#f87171';
        }
    }

    setProgress('INITIALIZING...', 5);

    initMap();
    Dossier.init();
    CardFlip.init();
    Search.init();
    Navigator.init();
    ArchetypeIndex.init();
    WrestlerIndex.init();
    if (window.GestureLayer) GestureLayer.init();
    if (window.GestureHandlers) GestureHandlers.init();

    // Dock tab switching
    document.querySelectorAll('.dock-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.getAttribute('data-pane');
            document.querySelectorAll('.dock-tab').forEach(t => t.classList.toggle('active', t === tab));
            document.querySelectorAll('.dock-pane').forEach(p => {
                const match = p.getAttribute('data-pane') === target;
                if (match) p.removeAttribute('hidden');
                else p.setAttribute('hidden', '');
            });
        });
    });

    const btnReset = document.getElementById('btn-reset');
    const btnZoomIn = document.getElementById('btn-zoom-in');
    const btnZoomOut = document.getElementById('btn-zoom-out');
    const btnConnections = document.getElementById('btn-connections');
    const btnBackToMap = document.getElementById('btn-back-to-map');

    window._onMapNodeClick = async (nodeId) => {
        if (archetypeEgoSlug) {
            CardFlip.show(nodeId);
            Dossier.show(nodeId);
            return;
        }
        if (hubMode) {
            navStack = [nodeId];
            await recenterOn(nodeId);
            updateBreadcrumb();
            CardFlip.show(nodeId);
            Dossier.show(nodeId);
        } else if (egoMode && nodeId !== currentCenterId) {
            navStack.push(nodeId);
            await recenterOn(nodeId);
            updateBreadcrumb();
            CardFlip.show(nodeId);
            Dossier.show(nodeId);
        } else {
            CardFlip.show(nodeId);
            Dossier.show(nodeId);
        }
    };

    window._onMapBgClick = () => {
        CardFlip.hide();
        Dossier.close();
    };

    let graphLoaded = false;
    try {
        setProgress('LOADING DATA...', 15);

        const [data, assignments] = await Promise.all([
            API.getGraphFull(),
            API.getBranchAssignments(),
            scanAvailableAssets(),
        ]);

        storeGraphData(data);
        setBranchAssignments(assignments);
        Navigator.build(data.nodes, assignments);
        graphLoaded = true;

        setProgress('BUILDING MAP...', 40);

        const types = [...new Set(data.nodes.map(n => n.entity_type))].sort();
        Filters.init(types);

        // Stats bar
        const activeCount = data.nodes.filter(n => !n.departed && n.entity_type === 'wrestler').length;
        const factionCount = data.nodes.filter(n => n.entity_type === 'faction').length;
        const statsBar = document.getElementById('stats-bar');
        if (statsBar) {
            statsBar.innerHTML = `
                <span class="stat-item"><span class="stat-value">${activeCount}</span> performers</span>
                <span class="stat-item"><span class="stat-value">${factionCount}</span> factions</span>
                <span class="stat-item"><span class="stat-value">${data.edges.length}</span> connections</span>`;
        }

        buildRadialMap();
        updateBreadcrumb();

        setProgress('READY', 95);
        dismissLoading();

        if (!window.location.hash) {
            showGuide(() => Navigator.open());
        }

    } catch (err) {
        console.error('Boot error:', err);
        if (!graphLoaded) {
            showLoadingError('FAILED TO LOAD DATA');
        }
    }

    function showGuide(onDismiss) {
        const overlay = document.getElementById('guide-overlay');
        if (!overlay) { if (onDismiss) onDismiss(); return; }
        overlay.classList.add('visible');
        const dismiss = (e) => {
            if (e.type === 'wheel') return;
            overlay.classList.add('dismissing');
            overlay.classList.remove('visible');
            setTimeout(() => { overlay.style.display = 'none'; }, 400);
            document.removeEventListener('keydown', dismiss);
            overlay.removeEventListener('click', dismiss);
            if (onDismiss) setTimeout(onDismiss, 450);
        };
        document.addEventListener('keydown', dismiss);
        overlay.addEventListener('click', dismiss);
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (Navigator.isOpen) { Navigator.close(); return; }
            CardFlip.hide();
            Dossier.close();
        }
        if (e.key === '/' && document.activeElement !== Search.input) {
            e.preventDefault();
            Search.input.focus();
        }
        if (e.key === 'Backspace' && document.activeElement !== Search.input) {
            e.preventDefault();
            navigateBack();
        }
        if (e.key === 'i' && document.activeElement !== Search.input) {
            Navigator.toggle();
        }
        if (e.key === 'f' && document.activeElement !== Search.input) {
            if (Dossier.currentEntityId) {
                Dossier.flip();
                CardFlip.flipActive();
            }
        }
        if (e.key === '?' && document.activeElement !== Search.input) {
            const overlay = document.getElementById('guide-overlay');
            if (overlay) { overlay.style.display = ''; overlay.classList.add('visible'); overlay.classList.remove('dismissing'); }
            showGuide();
        }
        if ((e.key === 'g' || e.key === 'G') && document.activeElement !== Search.input
                && !e.ctrlKey && !e.metaKey && !e.altKey) {
            if (window.GestureLayer) GestureLayer.toggle();
        }
        if ((e.key === 'v' || e.key === 'V') && document.activeElement !== Search.input
                && !e.ctrlKey && !e.metaKey && !e.altKey) {
            if (window.GestureLayer) GestureLayer.cycleCursorMode();
        }
        if ((e.key === 'c' || e.key === 'C') && document.activeElement !== Search.input
                && !e.ctrlKey && !e.metaKey && !e.altKey) {
            if (window.GestureLayer && GestureLayer.isEnabled && GestureLayer.isEnabled()) {
                GestureLayer.startCalibration();
            }
        }
        if ((e.key === 'b' || e.key === 'B') && document.activeElement !== Search.input
                && !e.ctrlKey && !e.metaKey && !e.altKey) {
            if (window.GestureLayer && GestureLayer.isEnabled && GestureLayer.isEnabled()) {
                GestureLayer.togglePip();
            }
        }
        // [ / ] tune sensitivity. No modifier = uniform. Shift = X-axis only. Alt = Y-axis only.
        // Use e.code (BracketLeft/BracketRight) so Shift+[ (which yields '{') still triggers.
        if ((e.code === 'BracketRight' || e.code === 'BracketLeft')
                && document.activeElement !== Search.input
                && !e.ctrlKey && !e.metaKey) {
            const gl = window.GestureLayer;
            if (gl && gl.isEnabled && gl.isEnabled()) {
                const factor = e.code === 'BracketRight' ? 1.10 : 1 / 1.10;
                if (e.shiftKey && !e.altKey) {
                    gl.adjustSensitivityAxis('x', factor);
                } else if (e.altKey && !e.shiftKey) {
                    gl.adjustSensitivityAxis('y', factor);
                } else if (!e.shiftKey && !e.altKey) {
                    gl.adjustSensitivity(factor);
                }
            }
        }
        if (e.key === '\\' && document.activeElement !== Search.input
                && !e.ctrlKey && !e.metaKey && !e.altKey) {
            if (window.GestureLayer && GestureLayer.isEnabled && GestureLayer.isEnabled()) {
                GestureLayer.resetSensitivity();
            }
        }
        // R = toggle trigger record mode. Shift+R = clear learned templates.
        if ((e.key === 'r' || e.key === 'R') && document.activeElement !== Search.input
                && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const gl = window.GestureLayer;
            if (gl && gl.isEnabled && gl.isEnabled()) {
                if (e.shiftKey) {
                    gl.clearTriggerTemplates();
                } else {
                    gl.toggleRecordMode();
                }
            }
        }
    });

    if (btnReset) btnReset.addEventListener('click', () => { CardFlip.hide(); resetView(); });
    if (btnZoomIn) btnZoomIn.addEventListener('click', zoomIn);
    if (btnZoomOut) btnZoomOut.addEventListener('click', zoomOut);

    if (btnConnections) {
        btnConnections.addEventListener('click', () => {
            const on = toggleConnections();
            btnConnections.classList.toggle('active', on);
        });
    }

    if (btnBackToMap) {
        btnBackToMap.addEventListener('click', () => {
            CardFlip.hide();
            if (egoMode && activeBranchView) {
                navStack = [];
                Dossier.close();
                buildBranchMap(activeBranchView);
                updateBreadcrumb();
            } else {
                navStack = [];
                Dossier.close();
                buildRadialMap();
                updateBreadcrumb();
            }
        });
    }


    const btnIndex = document.getElementById('btn-index');
    if (btnIndex) {
        btnIndex.addEventListener('click', () => Navigator.toggle());
    }

    function updateBreadcrumb() {
        const bar = document.getElementById('breadcrumb-bar');

        if (btnBackToMap) {
            btnBackToMap.style.display = (egoMode || activeBranchView) ? '' : 'none';
        }

        if (hubMode && !activeBranchView) {
            bar.innerHTML = `<span class="breadcrumb-current">All Promotions</span>`;
            return;
        }

        if (archetypeEgoSlug) {
            bar.innerHTML = `<span class="breadcrumb-item" data-hub="true">Hub</span>` +
                `<span class="breadcrumb-sep">&rsaquo;</span>` +
                `<span class="breadcrumb-current">${esc(archetypeEgoName || archetypeEgoSlug)}</span>`;
            const hubLink = bar.querySelector('[data-hub]');
            if (hubLink) {
                hubLink.addEventListener('click', () => {
                    navStack = [];
                    Dossier.close();
                    buildRadialMap();
                    updateBreadcrumb();
                });
            }
            return;
        }

        let html = '';
        html += `<span class="breadcrumb-item" data-hub="true">Hub</span>`;
        html += `<span class="breadcrumb-sep">&rsaquo;</span>`;

        if (activeBranchView) {
            const branchLabel = BRANCHES[activeBranchView] ? BRANCHES[activeBranchView].label : activeBranchView;
            if (hubMode && !egoMode) {
                html += `<span class="breadcrumb-current">${esc(branchLabel)}</span>`;
            } else {
                html += `<span class="breadcrumb-item" data-branch="${activeBranchView}">${esc(branchLabel)}</span>`;
                html += `<span class="breadcrumb-sep">&rsaquo;</span>`;
            }
        }

        if (navStack.length > 0) {
            navStack.forEach((id, i) => {
                const name = getEntityName(id);
                if (i < navStack.length - 1) {
                    html += `<span class="breadcrumb-item" data-id="${id}">${esc(name)}</span>`;
                    html += `<span class="breadcrumb-sep">&rsaquo;</span>`;
                } else {
                    html += `<span class="breadcrumb-current">${esc(name)}</span>`;
                }
            });
        }

        bar.innerHTML = html;

        bar.querySelectorAll('.breadcrumb-item[data-id]').forEach(el => {
            el.addEventListener('click', async () => {
                const id = parseInt(el.getAttribute('data-id'));
                const idx = navStack.indexOf(id);
                if (idx >= 0) navStack = navStack.slice(0, idx + 1);
                await recenterOn(id);
                updateBreadcrumb();
                Dossier.show(id);
            });
        });

        const branchLink = bar.querySelector('[data-branch]');
        if (branchLink) {
            branchLink.addEventListener('click', () => {
                const bk = branchLink.getAttribute('data-branch');
                navStack = [];
                Dossier.close();
                buildBranchMap(bk);
                updateBreadcrumb();
            });
        }

        const hubLink = bar.querySelector('[data-hub]');
        if (hubLink) {
            hubLink.addEventListener('click', () => {
                navStack = [];
                Dossier.close();
                buildRadialMap();
                updateBreadcrumb();
            });
        }
    }

    async function navigateBack() {
        CardFlip.hide();
        if (archetypeEgoSlug) {
            Dossier.close();
            buildRadialMap();
            updateBreadcrumb();
            return;
        }
        if (hubMode && activeBranchView) {
            buildRadialMap();
            updateBreadcrumb();
            return;
        }
        if (hubMode && !activeBranchView) return;
        if (navStack.length <= 1) {
            navStack = [];
            Dossier.close();
            if (activeBranchView) {
                buildBranchMap(activeBranchView);
            } else {
                buildRadialMap();
            }
            updateBreadcrumb();
            return;
        }
        navStack.pop();
        const prevId = navStack[navStack.length - 1];
        await recenterOn(prevId);
        updateBreadcrumb();
    }

    function getEntityName(id) {
        if (!graphData) return `#${id}`;
        const node = graphData.nodes.find(n => n.id === id);
        return node ? node.name : `#${id}`;
    }

    window.navigateBack = navigateBack;
    window.updateBreadcrumb = updateBreadcrumb;
})();
