function _promoLogo(text, color) {
    return 'data:image/svg+xml,' + encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">` +
        `<circle cx="40" cy="40" r="36" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.4"/>` +
        `<circle cx="40" cy="40" r="28" fill="none" stroke="${color}" stroke-width="0.5" stroke-dasharray="3 4" opacity="0.25"/>` +
        `<text x="40" y="44" text-anchor="middle" font-family="Cinzel, serif" font-size="${text.length > 3 ? 12 : 16}" font-weight="700" fill="${color}" letter-spacing="2">${text}</text>` +
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
    mlw:  { label: 'MLW',  color: '#dc2626', logo: _promoLogo('MLW', '#dc2626') },
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

function _mkTraditionIcon(color, paths, vb = '0 0 64 64') {
    return 'data:image/svg+xml,' + encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
    );
}

const TRADITION_ICONS = {
    greek: (c) => _mkTraditionIcon(c,
        '<path d="M32 4c-8 5-14 16-16 30-1 6-1 12 0 18" fill="none"/>' +
        '<path d="M32 4c8 5 14 16 16 30 1 6 1 12 0 18" fill="none"/>' +
        '<path d="M16 52c4-2 8-6 10-12" fill="none"/><path d="M48 52c-4-2-8-6-10-12" fill="none"/>' +
        '<path d="M18 44c3-3 6-8 8-16" fill="none"/><path d="M46 44c-3-3-6-8-8-16" fill="none"/>' +
        '<path d="M21 36c2-4 5-10 6-18" fill="none"/><path d="M43 36c-2-4-5-10-6-18" fill="none"/>' +
        '<path d="M25 26c1-4 4-10 4-16" fill="none"/><path d="M39 26c-1-4-4-10-4-16" fill="none"/>' +
        '<circle cx="32" cy="58" r="3" fill="' + c + '" stroke="none"/>',
        '0 0 64 64'
    ),
    norse: (c) => _mkTraditionIcon(c,
        '<polygon points="32,4 12,38 52,38" fill="none" stroke-width="2.5"/>' +
        '<polygon points="16,14 6,48 42,28" fill="none" stroke-width="2.5"/>' +
        '<polygon points="48,14 22,28 58,48" fill="none" stroke-width="2.5"/>',
        '0 0 64 52'
    ),
    celtic: (c) => _mkTraditionIcon(c,
        '<path d="M32 32c0-12-8-20-20-20" fill="none" stroke-width="2.5"/>' +
        '<path d="M12 12c12 0 20-8 20-20" fill="none" stroke-width="2.5"/>' +
        '<path d="M32 32c10 6 20 3 26-6" fill="none" stroke-width="2.5"/>' +
        '<path d="M58 26c-6 10-3 20 6 26" fill="none" stroke-width="2.5"/>' +
        '<path d="M32 32c-10 6-12 18-6 26" fill="none" stroke-width="2.5"/>' +
        '<path d="M26 58c-6-10-18-12-26-6" fill="none" stroke-width="2.5"/>' +
        '<circle cx="32" cy="32" r="4" fill="' + c + '" stroke="none"/>',
        '-4 -8 72 72'
    ),
    egyptian: (c) => _mkTraditionIcon(c,
        '<ellipse cx="32" cy="26" rx="26" ry="14" fill="none" stroke-width="2.5"/>' +
        '<circle cx="32" cy="26" r="7" fill="' + c + '" stroke="none" opacity="0.45"/>' +
        '<circle cx="32" cy="26" r="4" fill="' + c + '" stroke="none"/>' +
        '<path d="M10 30c6 16 10 24 16 34" fill="none" stroke-width="2.5"/>' +
        '<path d="M18 48c5-3 10-3 16 0" fill="none" stroke-width="2"/>',
        '2 8 60 58'
    ),
    japanese: (c) => _mkTraditionIcon(c,
        '<path d="M6 10c8 3 16 4 26 4s18-1 26-4" fill="none" stroke-width="3.5"/>' +
        '<line x1="14" y1="14" x2="50" y2="14" stroke-width="2"/>' +
        '<line x1="18" y1="14" x2="18" y2="58" stroke-width="2.5"/>' +
        '<line x1="46" y1="14" x2="46" y2="58" stroke-width="2.5"/>' +
        '<line x1="18" y1="30" x2="46" y2="30" stroke-width="2"/>',
        '2 4 60 58'
    ),
    mesoamerican: (c) => _mkTraditionIcon(c,
        '<circle cx="32" cy="10" r="7" fill="' + c + '" stroke="none" opacity="0.3"/>' +
        '<circle cx="32" cy="10" r="4" fill="' + c + '" stroke="none" opacity="0.6"/>' +
        '<line x1="32" y1="2" x2="32" y2="0"/><line x1="40" y1="4" x2="43" y2="1"/>' +
        '<line x1="24" y1="4" x2="21" y2="1"/><line x1="44" y1="10" x2="47" y2="10"/>' +
        '<line x1="20" y1="10" x2="17" y2="10"/>' +
        '<rect x="22" y="28" width="20" height="10" fill="none" stroke-width="2.5"/>' +
        '<rect x="14" y="38" width="36" height="8" fill="none" stroke-width="2.5"/>' +
        '<rect x="6" y="46" width="52" height="8" fill="none" stroke-width="2.5"/>',
        '2 -2 60 60'
    ),
    polynesian: (c) => _mkTraditionIcon(c,
        '<path d="M28 4v30c0 12 8 20 20 20 8 0 14-6 14-14" fill="none" stroke-width="3"/>' +
        '<path d="M28 4l-8-2 8-4" fill="none" stroke-width="2.5"/>' +
        '<path d="M62 40l-6 10-8-6" fill="none" stroke-width="2.5"/>',
        '12 -6 58 62'
    ),
    yoruba: (c) => _mkTraditionIcon(c,
        '<circle cx="32" cy="32" r="18" fill="none" stroke-width="2.5"/>' +
        '<line x1="32" y1="4" x2="32" y2="60" stroke-width="2.5"/>' +
        '<line x1="4" y1="32" x2="60" y2="32" stroke-width="2.5"/>' +
        '<circle cx="32" cy="32" r="5" fill="' + c + '" stroke="none"/>',
        '0 0 64 64'
    ),
    slavic: (c) => _mkTraditionIcon(c,
        '<path d="M32 58c-3-12-12-20-20-24" fill="none" stroke-width="2.5"/>' +
        '<path d="M32 58c3-12 12-20 20-24" fill="none" stroke-width="2.5"/>' +
        '<path d="M12 34c3-8 8-18 20-26" fill="none" stroke-width="2.5"/>' +
        '<path d="M52 34c-3-8-8-18-20-26" fill="none" stroke-width="2.5"/>' +
        '<path d="M20 20c3-8 8-14 12-18" fill="none" stroke-width="2.5"/>' +
        '<path d="M44 20c-3-8-8-14-12-18" fill="none" stroke-width="2.5"/>' +
        '<circle cx="32" cy="42" r="4" fill="' + c + '" stroke="none"/>',
        '8 -2 48 64'
    ),
    sumerian: (c) => _mkTraditionIcon(c,
        '<line x1="32" y1="4" x2="32" y2="60" stroke-width="2.5"/>' +
        '<line x1="4" y1="32" x2="60" y2="32" stroke-width="2.5"/>' +
        '<line x1="12" y1="12" x2="52" y2="52" stroke-width="2.5"/>' +
        '<line x1="52" y1="12" x2="12" y2="52" stroke-width="2.5"/>' +
        '<circle cx="32" cy="32" r="7" fill="' + c + '" stroke="none" opacity="0.35"/>',
        '0 0 64 64'
    ),
    chinese: (c) => _mkTraditionIcon(c,
        '<circle cx="32" cy="32" r="28" fill="none" stroke-width="2.5"/>' +
        '<path d="M32 4a28 28 0 0 1 0 56 14 14 0 0 1 0-28 14 14 0 0 0 0-28z" fill="' + c + '" stroke="none" opacity="0.2"/>' +
        '<circle cx="32" cy="18" r="4" fill="' + c + '" stroke="none" opacity="0.5"/>' +
        '<circle cx="32" cy="46" r="4" fill="none"/>',
        '0 0 64 64'
    ),
    other: (c) => _mkTraditionIcon(c,
        '<polygon points="32,4 37,26 32,20 27,26" fill="' + c + '" stroke="none" opacity="0.4"/>' +
        '<polygon points="60,32 38,37 44,32 38,27" fill="' + c + '" stroke="none" opacity="0.3"/>' +
        '<polygon points="32,60 27,38 32,44 37,38" fill="' + c + '" stroke="none" opacity="0.2"/>' +
        '<polygon points="4,32 26,27 20,32 26,37" fill="' + c + '" stroke="none" opacity="0.3"/>' +
        '<line x1="32" y1="4" x2="32" y2="60" stroke-width="2"/>' +
        '<line x1="4" y1="32" x2="60" y2="32" stroke-width="2"/>' +
        '<line x1="14" y1="14" x2="50" y2="50" stroke-width="1.5"/>' +
        '<line x1="50" y1="14" x2="14" y2="50" stroke-width="1.5"/>',
        '0 0 64 64'
    ),
};

function getTraditionIcon(tradition, color) {
    const fn = TRADITION_ICONS[tradition] || TRADITION_ICONS.other;
    return fn(color || TRADITION_COLORS[tradition] || '#94a3b8');
}

const CONFIDENCE_COLORS = {
    strong:      '#34d399',
    partial:     '#fbbf24',
    speculative: '#f87171',
};

let ENTITY_BRANCH_MAP = {};
