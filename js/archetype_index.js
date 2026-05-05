// Persistent left-rail listing of all archetypes. Click an entry to enter
// archetype-ego mode for that slug. Live filter at the top.
const ArchetypeIndex = {
    container: null,
    listEl: null,
    countEl: null,
    filterInput: null,
    archetypes: [],

    async init() {
        this.container = document.getElementById('archetype-index');
        this.listEl = document.getElementById('archetype-index-list');
        this.countEl = document.getElementById('archetype-index-count');
        this.filterInput = document.getElementById('archetype-index-filter');

        const all = await API.getAllArchetypes();
        this.archetypes = Object.entries(all).map(([slug, arch]) => ({
            slug,
            name: arch.name,
            tradition: arch.tradition || 'other',
            carrierCount: (arch.carriers || []).length,
        })).sort((a, b) => a.name.localeCompare(b.name));

        if (this.countEl) this.countEl.textContent = this.archetypes.length;
        this.render('');

        if (this.filterInput) {
            this.filterInput.addEventListener('input', () => {
                this.render(this.filterInput.value.trim().toLowerCase());
            });
        }
    },

    render(filter) {
        const items = filter
            ? this.archetypes.filter(a =>
                a.name.toLowerCase().includes(filter) ||
                a.tradition.toLowerCase().includes(filter))
            : this.archetypes;

        let html = '';
        for (const a of items) {
            const tradColor = TRADITION_COLORS[a.tradition] || '#94a3b8';
            const icon = getTraditionIcon(a.tradition, tradColor);
            html += `<div class="ai-row" data-slug="${a.slug}" tabindex="0" role="option">`;
            html += `<img class="ai-icon" src="${icon}" alt="" />`;
            html += `<span class="ai-name">${esc(a.name)}</span>`;
            html += `<span class="ai-count" style="color:${tradColor}">${a.carrierCount}</span>`;
            html += `</div>`;
        }
        if (!items.length) {
            html = '<div class="ai-empty">no matches</div>';
        }
        this.listEl.innerHTML = html;

        this.listEl.querySelectorAll('.ai-row').forEach(row => {
            row.addEventListener('click', () => {
                const slug = row.getAttribute('data-slug');
                if (typeof CardFlip !== 'undefined') CardFlip.hide();
                if (typeof Dossier !== 'undefined') Dossier.close();
                buildArchetypeEgo(slug);
                if (typeof updateBreadcrumb === 'function') updateBreadcrumb();
            });
            row.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    row.click();
                }
            });
        });
    },
};
