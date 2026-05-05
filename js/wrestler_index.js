// Wrestler list pane — grouped by promotion, alphabetical within group.
// Click a row to focus + open dossier.
const PROMO_ORDER = ['wwe', 'nxt', 'aew', 'tna', 'njpw', 'aaa'];

const WrestlerIndex = {
    listEl: null,
    countEl: null,
    filterInput: null,
    wrestlers: [],
    currentSlug: null,

    async init() {
        this.listEl = document.getElementById('wrestler-index-list');
        this.countEl = document.getElementById('wrestler-index-count');
        this.filterInput = document.getElementById('wrestler-index-filter');

        const all = await API._load().then(() => API._entities);
        this.wrestlers = Object.values(all)
            .filter(e => e.entity_type !== 'faction' && e.name)
            .map(e => ({
                id: e.id,
                slug: this._slug(e),
                name: e.name,
                promotion: e.promotion || 'unknown',
                tier: e.tier || '',
                photoUrl: e.photo_url,
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        if (this.countEl) this.countEl.textContent = this.wrestlers.length;
        this.render('');

        if (this.filterInput) {
            this.filterInput.addEventListener('input', () => {
                this.render(this.filterInput.value.trim().toLowerCase());
            });
        }
    },

    _slug(e) {
        if (!e.photo_url) return null;
        return e.photo_url.replace(/^.*\//, '').replace(/\.\w+$/, '');
    },

    render(filter) {
        const items = filter
            ? this.wrestlers.filter(w =>
                w.name.toLowerCase().includes(filter) ||
                w.promotion.toLowerCase().includes(filter))
            : this.wrestlers;

        const groups = {};
        for (const w of items) groups[w.promotion] = groups[w.promotion] || [];
        for (const w of items) groups[w.promotion].push(w);

        const promos = PROMO_ORDER.filter(p => groups[p]);
        for (const p of Object.keys(groups)) {
            if (!promos.includes(p)) promos.push(p);
        }

        let html = '';
        for (const promo of promos) {
            const branch = (typeof BRANCHES !== 'undefined' && BRANCHES[promo]) || null;
            const color = branch ? branch.color : '#888';
            const label = branch ? branch.label : promo.toUpperCase();
            html += `<div class="ai-group-header" style="color:${color}">${esc(label)} <span style="opacity:0.5;font-weight:normal">(${groups[promo].length})</span></div>`;
            for (const w of groups[promo]) {
                const activeClass = w.slug === this.currentSlug ? ' is-active' : '';
                html += `<div class="ai-row${activeClass}" data-id="${w.id}" data-slug="${w.slug || ''}" tabindex="0" role="option">`;
                html += `<span class="ai-dot" style="background:${color}"></span>`;
                html += `<span class="ai-name">${esc(w.name)}</span>`;
                html += `<span class="ai-tier">${esc(w.tier)}</span>`;
                html += `</div>`;
            }
        }
        if (!items.length) html = '<div class="ai-empty">no matches</div>';
        this.listEl.innerHTML = html;

        this.listEl.querySelectorAll('.ai-row[data-id]').forEach(row => {
            row.addEventListener('click', async () => {
                const id = parseInt(row.getAttribute('data-id'));
                const slug = row.getAttribute('data-slug');
                this.setActive(slug);
                if (typeof CardFlip !== 'undefined') CardFlip.hide();
                if (typeof recenterOn === 'function') {
                    if (typeof navStack !== 'undefined') navStack = [id];
                    await recenterOn(id);
                    if (typeof updateBreadcrumb === 'function') updateBreadcrumb();
                }
                if (typeof Dossier !== 'undefined') Dossier.show(id);
            });
            row.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); }
            });
        });
    },

    setActive(slug) {
        this.currentSlug = slug;
        this.listEl.querySelectorAll('.ai-row.is-active').forEach(el => el.classList.remove('is-active'));
        const row = this.listEl.querySelector(`.ai-row[data-slug="${slug}"]`);
        if (row) row.classList.add('is-active');
    },
};
