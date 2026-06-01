const Dossier = {
    panel: null,
    inner: null,
    closeBtn: null,
    currentEntityId: null,
    flipped: false,

    init() {
        this.panel = document.getElementById('dossier-panel');
        this.inner = document.getElementById('panel-inner');
        this.closeBtn = document.getElementById('panel-close');
        this.closeBtn.addEventListener('click', () => this.close());
    },

    close() {
        this.panel.classList.remove('open');
        this.panel.setAttribute('aria-hidden', 'true');
        this.currentEntityId = null;
        this.flipped = false;
        clearHighlight();
        document.getElementById('cy-container').focus();
    },

    flip() {
        this.flipped = !this.flipped;
        const container = this.inner.querySelector('.panel-flip-inner');
        if (container) {
            container.classList.toggle('flipped', this.flipped);
        }
        const btn = this.inner.querySelector('.panel-flip-btn');
        if (btn) {
            btn.textContent = this.flipped ? 'Flip to Wrestler' : 'Flip to Archetype';
        }
    },

    async show(entityId) {
        this.currentEntityId = entityId;
        this.flipped = false;
        highlightNode(entityId);

        const entity = await API.getEntity(entityId);
        if (!entity) return;


        let archetypeSlug = null;
        if (entity.archetype && entity.archetype !== '—') {
            const arch = await API.getArchetypeForEntity(entityId);
            if (arch) archetypeSlug = arch.slug;
        }

        const tierColor = TIER_BADGE_COLORS[entity.tier_normalized] || '#94a3b8';
        const confColor = CONFIDENCE_COLORS[entity.confidence] || '#94a3b8';
        const branchColor = BRANCHES[entity.promotion] ? BRANCHES[entity.promotion].color : '#888';
        const tradColor = TRADITION_COLORS[entity.tradition] || '#94a3b8';

        let html = '<div class="panel-flip-container"><div class="panel-flip-inner">';

        // ---- FRONT: Wrestler Stats ----
        html += '<div class="panel-face panel-front">';

        // Photo / placeholder
        const rawPhoto = (typeof resolveWrestlerPhoto === 'function')
            ? resolveWrestlerPhoto(entity.photo_url)
            : null;
        const photoUrl = (rawPhoto && typeof _withCacheBust === 'function')
            ? _withCacheBust(rawPhoto)
            : rawPhoto;
        html += `<div class="panel-photo-header">`;
        if (photoUrl) {
            html += `<img class="panel-photo" src="${photoUrl}" alt="${esc(entity.name)}" style="border-color:${branchColor}" />`;
        } else {
            const initial = entity.name.charAt(0).toUpperCase();
            html += `<div class="panel-photo-placeholder" style="border-color:${branchColor};color:${branchColor}">${initial}</div>`;
        }
        html += `<div>`;
        html += `<h2 class="panel-title" id="dossier-title">${esc(entity.name)}</h2>`;
        if (entity.aspect) {
            html += `<p class="panel-aliases">${esc(entity.aspect)}</p>`;
        }
        html += `</div></div>`;

        // Badges
        html += `<div class="meta-badges">`;
        html += `<span class="meta-badge" style="border-color:${branchColor};color:${branchColor}">${entity.promotion.toUpperCase()}</span>`;
        html += `<span class="meta-badge" style="border-color:${tierColor};color:${tierColor}">${esc(entity.tier)}</span>`;
        if (entity.confidence) {
            html += `<span class="meta-badge" style="border-color:${confColor};color:${confColor}">${entity.confidence}</span>`;
        }
        html += `</div>`;

        // Championships — authoritative current-title layer (champions.json overlay)
        if (entity.current_titles && entity.current_titles.length) {
            html += `<div class="panel-section-label">Championship${entity.current_titles.length > 1 ? 's' : ''}</div>`;
            html += `<div class="championships">`;
            entity.current_titles.forEach(t => {
                html += `<div class="title-belt">`;
                html += `<span class="title-belt-name">${esc(t.title)}</span>`;
                if (t.won) html += `<span class="title-belt-since">${esc(t.won)}</span>`;
                if (t.flag) html += `<span class="title-belt-flag">${esc(t.flag)}</span>`;
                html += `</div>`;
            });
            html += `</div>`;
        }

        // Stats
        if (entity.lands || entity.scroll) {
            html += `<div class="panel-stats">`;
            if (entity.lands) html += `<div class="stat-row"><span class="stat-label">Lands</span><span class="stat-val">${esc(entity.lands)}</span></div>`;
            if (entity.scroll) html += `<div class="stat-row"><span class="stat-label">Scroll</span><span class="stat-val">${esc(entity.scroll)}</span></div>`;
            if (entity.division) html += `<div class="stat-row"><span class="stat-label">Division</span><span class="stat-val">${esc(entity.division)}</span></div>`;
            html += `</div>`;
        }

        // Notes excerpt
        if (entity.notes) {
            const excerpt = entity.notes.length > 400 ? entity.notes.slice(0, 400) + '...' : entity.notes;
            html += `<div class="panel-section-label">Notes</div>`;
            html += `<div class="panel-description">${esc(excerpt)}</div>`;
        }

        // Connected entities from graph
        if (graphData) {
            const connections = graphData.edges.filter(e =>
                e.source === entity.id || e.target === entity.id
            );
            if (connections.length > 0) {
                const grouped = {};
                connections.forEach(e => {
                    const key = e.relationship_type;
                    if (!grouped[key]) grouped[key] = [];
                    grouped[key].push(e);
                });

                html += `<div class="panel-section-label">Connections (${connections.length})</div>`;
                for (const [relType, rels] of Object.entries(grouped)) {
                    const edgeColor = EDGE_TYPE_COLORS[relType] || '#888';
                    html += `<div class="rel-group">`;
                    html += `<div class="rel-group-title" style="color:${edgeColor}">${relType.replace(/_/g, ' ')}</div>`;
                    rels.forEach(r => {
                        const otherId = r.source === entity.id ? r.target : r.source;
                        const otherNode = graphData.nodes.find(n => n.id === otherId);
                        const otherName = otherNode ? otherNode.name : `#${otherId}`;
                        const isFaction = otherNode && otherNode.entity_type === 'faction';
                        html += `<div class="rel-item${isFaction ? ' rel-faction' : ''}" data-entity-id="${otherId}" ${isFaction ? 'data-faction="true"' : ''} tabindex="0" role="link">
                            <div class="rel-entity-name">${esc(otherName)}${isFaction ? ' <span class="rel-faction-tag">FACTION</span>' : ''}</div>
                        </div>`;
                    });
                    html += `</div>`;
                }
            }
        }

        html += '</div>'; // end panel-front

        // ---- BACK: Archetype Deep Dive ----
        html += '<div class="panel-face panel-back">';

        if (entity.archetype && entity.archetype !== '—') {
            const rawArch = (typeof resolveArchetypeImage === 'function')
                ? resolveArchetypeImage(entity.archetype_symbol)
                : null;
            const archImg = (rawArch && typeof _withCacheBust === 'function')
                ? _withCacheBust(rawArch)
                : rawArch;
            if (archImg) {
                html += `<div class="archetype-hero" style="border-color:${tradColor}">`;
                html += `<img class="archetype-hero-img" src="${archImg}" alt="${esc(entity.archetype)} depiction" />`;
                html += `</div>`;
            }
            const tradIcon = getTraditionIcon(entity.tradition, tradColor);
            html += `<div class="archetype-header">`;
            html += `<img class="archetype-header-icon" src="${tradIcon}" alt="" />`;
            html += `<div>`;
            html += `<h2 class="panel-title" style="color:${tradColor}">${esc(entity.archetype)}</h2>`;
            html += `<span class="meta-badge" style="border-color:${tradColor};color:${tradColor}">${entity.tradition}</span>`;
            html += `</div>`;
            html += `</div>`;

            if (entity.aspect) {
                html += `<div class="panel-section-label">Aspect</div>`;
                html += `<div class="panel-description">${esc(entity.aspect)}</div>`;
            }

            // Full notes on archetype side
            if (entity.notes) {
                html += `<div class="panel-section-label">Mythic Context</div>`;
                html += `<div class="panel-description">${esc(entity.notes)}</div>`;
            }
        } else {
            html += `<div class="archetype-header">`;
            html += `<h2 class="panel-title" style="color:#6b7280">No Archetype Assigned</h2>`;
            html += `<p class="panel-aliases">TBD — watching for emergence</p>`;
            html += `</div>`;
        }

        if (archetypeSlug) {
            html += `<button class="panel-archetype-map-btn" data-slug="${archetypeSlug}">View Archetype Map</button>`;
        }
        html += '</div>'; // end panel-back
        html += '</div></div>'; // end flip-inner, flip-container

        // Flip button
        html += `<button class="panel-flip-btn">Flip to Archetype</button>`;

        this.inner.innerHTML = html;
        this.panel.classList.add('open');
        this.panel.setAttribute('aria-hidden', 'false');
        this.panel.scrollTop = 0;

        // Flip button handler
        const flipBtn = this.inner.querySelector('.panel-flip-btn');
        if (flipBtn) {
            flipBtn.addEventListener('click', () => this.flip());
        }

        const archMapBtn = this.inner.querySelector('.panel-archetype-map-btn');
        if (archMapBtn) {
            archMapBtn.addEventListener('click', () => {
                const slug = archMapBtn.getAttribute('data-slug');
                this.close();
                buildArchetypeEgo(slug);
                if (typeof updateBreadcrumb === 'function') updateBreadcrumb();
            });
        }

        // Relationship click handlers
        this.inner.querySelectorAll('.rel-item[data-entity-id]').forEach(el => {
            el.addEventListener('click', () => {
                const id = parseInt(el.getAttribute('data-entity-id'));
                if (!id) return;
                const isFaction = el.getAttribute('data-faction') === 'true';
                if (isFaction) {
                    this.close();
                    focusFaction(id);
                    if (typeof updateBreadcrumb === 'function') updateBreadcrumb();
                } else if (egoMode) {
                    navStack.push(id);
                    recenterOn(id);
                    updateBreadcrumb();
                    this.show(id);
                } else {
                    focusNode(id);
                    this.show(id);
                }
            });
        });
    },
};

function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
