function _promoLogo(text, color) {
    return 'data:image/svg+xml,' + encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">` +
        `<circle cx="40" cy="40" r="36" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.4"/>` +
        `<circle cx="40" cy="40" r="28" fill="none" stroke="${color}" stroke-width="0.5" stroke-dasharray="3 4" opacity="0.25"/>` +
        `<text x="40" y="44" text-anchor="middle" font-family="monospace" font-size="${text.length > 3 ? 11 : 14}" font-weight="700" fill="${color}" letter-spacing="1.5">${text}</text>` +
        `</svg>`
    );
}

const BRANCHES = {
    wwe:  { label: 'WWE',  color: '#c9a84c', logo: _promoLogo('WWE', '#c9a84c') },
    nxt:  { label: 'NXT',  color: '#a78bfa', logo: _promoLogo('NXT', '#a78bfa') },
    aew:  { label: 'AEW',  color: '#4a9eff', logo: _promoLogo('AEW', '#4a9eff') },
    tna:  { label: 'TNA',  color: '#f87171', logo: _promoLogo('TNA', '#f87171') },
    njpw: { label: 'NJPW', color: '#34d399', logo: _promoLogo('NJPW', '#34d399') },
    aaa:  { label: 'AAA',  color: '#fb923c', logo: _promoLogo('AAA', '#fb923c') },
};

const TIER_BADGE_COLORS = {
    'pantheon':     '#fbbf24',
    'pantheon-adj': '#d4a017',
    'demihero':     '#4a9eff',
    'shadow':       '#94a3b8',
    'trickster':    '#a78bfa',
    'transitional': '#fb923c',
    'failed':       '#f87171',
    'tbd':          '#6b7280',
    'departed':     '#4b5563',
};

const TRADITION_COLORS = {
    egyptian:     '#fbbf24',
    norse:        '#4a8a8a',
    greek:        '#4a9eff',
    celtic:       '#34d399',
    mesoamerican: '#fb923c',
    japanese:     '#f472b6',
    polynesian:   '#6ee7b7',
    yoruba:       '#c084fc',
    slavic:       '#f87171',
    sumerian:     '#d4a017',
    chinese:      '#ef4444',
    hindu:        '#e879f9',
    other:        '#94a3b8',
};

const CONFIDENCE_COLORS = {
    strong:      '#34d399',
    partial:     '#fbbf24',
    speculative: '#f87171',
};

let ENTITY_BRANCH_MAP = {};
