const Navigator = (() => {
    let overlay = null;
    let _isOpen = false;

    function _esc(s) {
        if (!s) return '';
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    function init() {
        overlay = document.getElementById('navigator-overlay');
    }

    function build(nodes, assignments) {
        if (!overlay) return;

        const nodeMap = {};
        nodes.forEach(n => { nodeMap[n.id] = n; });

        const stats = {};
        Object.keys(BRANCHES).forEach(k => {
            stats[k] = { total: 0, ring1: [], byTier: {} };
        });

        for (const [id, info] of Object.entries(assignments)) {
            const node = nodeMap[parseInt(id)];
            if (!node) continue;
            const s = stats[info.branch];
            if (!s) continue;
            s.total++;
            if (info.ring === 1) s.ring1.push(node);
            const tier = node.tier || 'other';
            s.byTier[tier] = (s.byTier[tier] || 0) + 1;
        }

        Object.values(stats).forEach(s => {
            s.ring1.sort((a, b) => (b.connection_count || 0) - (a.connection_count || 0));
        });

        let html = `<div class="nav-scroll">
            <div class="nav-header">
                <div class="nav-title">ARCHETYPE CONSOLE</div>
                <div class="nav-subtitle">${nodes.filter(n => n.entity_type === 'wrestler').length} performers across ${Object.keys(BRANCHES).length} promotions</div>
            </div>
            <div class="nav-grid">`;

        Object.entries(BRANCHES).forEach(([key, branch]) => {
            const s = stats[key];
            const maxFigs = 7;
            const visible = s.ring1.slice(0, maxFigs);
            const overflow = Math.max(0, s.ring1.length - maxFigs);

            html += `<div class="nav-card" data-branch="${key}" style="--bc:${branch.color}" tabindex="0" role="button">
                <div class="nav-card-accent" style="background:${branch.color}"></div>
                <div class="nav-card-body">
                    <div class="nav-card-top">
                        <span class="nav-card-label">${_esc(branch.label)}</span>
                        <span class="nav-card-count">${s.total}</span>
                    </div>
                    <div class="nav-card-figures">`;

            visible.forEach(node => {
                html += `<div class="nav-fig" data-entity="${node.id}" title="${_esc(node.name)}">`;
                html += `<span>${_esc(node.name.charAt(0))}</span>`;
                html += `</div>`;
            });

            if (overflow > 0) {
                html += `<div class="nav-fig-more">+${overflow}</div>`;
            }

            html += `</div>
                    <div class="nav-card-types">`;

            const tiers = Object.entries(s.byTier).sort((a, b) => b[1] - a[1]);
            tiers.slice(0, 5).forEach(([tier, count], i) => {
                if (i > 0) html += '<span class="nav-sep">·</span>';
                const tierColor = TIER_BADGE_COLORS[tier] || '#94a3b8';
                html += `<span class="nav-type"><span class="nav-tdot" style="background:${tierColor}"></span>${count} ${tier}</span>`;
            });

            html += `</div>
                </div>
            </div>`;
        });

        html += `</div>
            <button class="nav-enter" id="nav-enter-btn">VIEW FULL MAP</button>
        </div>`;

        overlay.innerHTML = html;

        overlay.querySelectorAll('.nav-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.nav-fig')) return;
                const bk = card.dataset.branch;
                close();
                setTimeout(() => toggleBranchFocus(bk), 350);
            });
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    card.click();
                }
            });
        });

        overlay.querySelectorAll('.nav-fig').forEach(fig => {
            fig.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseInt(fig.dataset.entity);
                if (!id) return;
                close();
                setTimeout(() => {
                    if (window._onMapNodeClick) window._onMapNodeClick(id);
                }, 350);
            });
        });

        const enterBtn = document.getElementById('nav-enter-btn');
        if (enterBtn) enterBtn.addEventListener('click', close);
    }

    function open() {
        if (!overlay) return;
        overlay.classList.add('open');
        _isOpen = true;
        const btn = document.getElementById('btn-index');
        if (btn) btn.classList.add('active');
        setTimeout(() => {
            const firstCard = overlay.querySelector('.nav-card');
            if (firstCard) firstCard.focus();
        }, 100);
    }

    function close() {
        if (!overlay) return;
        overlay.classList.remove('open');
        _isOpen = false;
        const btn = document.getElementById('btn-index');
        if (btn) btn.classList.remove('active');
        document.getElementById('cy-container').focus();
    }

    function toggle() {
        _isOpen ? close() : open();
    }

    return { init, build, open, close, toggle, get isOpen() { return _isOpen; } };
})();
