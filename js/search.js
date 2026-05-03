const Search = {
    input: null,
    results: null,
    debounceTimer: null,

    init() {
        this.input = document.getElementById('search-input');
        this.results = document.getElementById('search-results');

        this.results.setAttribute('aria-live', 'polite');
        this.results.setAttribute('role', 'listbox');
        this.input.setAttribute('aria-controls', 'search-results');
        this.input.setAttribute('aria-expanded', 'false');

        this.input.addEventListener('input', () => {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => this.doSearch(), 200);
        });

        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.input.value = '';
                this.results.classList.remove('visible');
                this.input.setAttribute('aria-expanded', 'false');
                this.input.blur();
            }
        });

        document.addEventListener('click', (e) => {
            if (!this.input.contains(e.target) && !this.results.contains(e.target)) {
                this.results.classList.remove('visible');
                this.input.setAttribute('aria-expanded', 'false');
            }
        });
    },

    async doSearch() {
        const q = this.input.value.trim();
        if (q.length < 1) {
            this.results.classList.remove('visible');
            this.input.setAttribute('aria-expanded', 'false');
            return;
        }

        try {
            const [entities, archetypes] = await Promise.all([
                API.searchEntities(q),
                API.searchArchetypes(q),
            ]);

            if (entities.length === 0 && archetypes.length === 0) {
                this.results.innerHTML = '<div class="search-result-item" style="color:rgba(255,255,255,0.35)">No results</div>';
                this.results.classList.add('visible');
                this.input.setAttribute('aria-expanded', 'true');
                return;
            }

            let html = '';

            archetypes.forEach(a => {
                const tradColor = TRADITION_COLORS[a.tradition] || '#94a3b8';
                html += `<div class="search-result-item" data-archetype="${a.slug}" tabindex="0" role="option">
                    <span class="search-result-dot" style="background:${tradColor}"></span>
                    <span>${esc(a.name)}</span>
                    <span class="search-result-type" style="color:${tradColor}">archetype · ${a.carriers.length} carrier${a.carriers.length !== 1 ? 's' : ''}</span>
                </div>`;
            });

            entities.forEach(e => {
                const color = BRANCHES[e.promotion] ? BRANCHES[e.promotion].color : '#888';
                const tierColor = TIER_BADGE_COLORS[e.tier_normalized] || '#94a3b8';
                html += `<div class="search-result-item" data-id="${e.id}" tabindex="0" role="option">
                    <span class="search-result-dot" style="background:${color}"></span>
                    <span>${esc(e.name)}</span>
                    <span class="search-result-type" style="color:${tierColor}">${esc(e.archetype || e.tier || '')}</span>
                </div>`;
            });

            this.results.innerHTML = html;
            this.results.classList.add('visible');
            this.input.setAttribute('aria-expanded', 'true');

            this.results.querySelectorAll('[data-archetype]').forEach(el => {
                el.addEventListener('click', () => {
                    const slug = el.getAttribute('data-archetype');
                    buildArchetypeEgo(slug);
                    if (typeof updateBreadcrumb === 'function') updateBreadcrumb();
                    this.results.classList.remove('visible');
                    this.input.setAttribute('aria-expanded', 'false');
                    this.input.value = '';
                });
            });

            this.results.querySelectorAll('[data-id]').forEach(el => {
                el.addEventListener('click', () => {
                    const id = parseInt(el.getAttribute('data-id'));
                    if (egoMode) {
                        navStack.push(id);
                        recenterOn(id);
                        updateBreadcrumb();
                    } else {
                        focusNode(id);
                    }
                    Dossier.show(id);
                    this.results.classList.remove('visible');
                    this.input.setAttribute('aria-expanded', 'false');
                    this.input.value = '';
                });
            });
        } catch (err) {
            console.error('Search error:', err);
        }
    },
};


const Filters = {
    init(entityTypes) {
        const container = document.getElementById('type-filters');
        if (!container) return;

        container.innerHTML = '<span class="filter-label">TIER</span>';
        const tiers = ['pantheon', 'demihero', 'shadow', 'trickster', 'transitional'];
        const allTiers = new Set(tiers);

        tiers.forEach(tier => {
            const color = TIER_BADGE_COLORS[tier] || '#888';
            const pill = document.createElement('span');
            pill.className = 'type-pill active';
            pill.innerHTML = `<span class="pill-dot" style="background:${color}"></span>${tier}`;
            pill.addEventListener('click', () => {
                if (allTiers.has(tier)) {
                    allTiers.delete(tier);
                    pill.classList.remove('active');
                } else {
                    allTiers.add(tier);
                    pill.classList.add('active');
                }
                // Filter nodes by tier visibility
                if (typeof filterByType === 'function') {
                    filterByType(allTiers);
                }
            });
            container.appendChild(pill);
        });
    },
};
