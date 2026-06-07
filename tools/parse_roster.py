#!/usr/bin/env python3
"""
parse_roster.py — Roster Audit → Archetype Console JSON Pipeline

Reads ~/the-worked-shoot/audit/roster.md and generates:
  data/entities.json    — all performers keyed by integer ID
  data/graph.json       — nodes + edges for Cytoscape.js
  data/layer_assignments.json — promotion-based branch assignments
  data/archetypes.json  — archetype metadata (tradition, carriers)
  data/factions.json    — faction data with member mappings
"""

import json
import re
import sys
import unicodedata
from pathlib import Path
from collections import defaultdict

ROSTER_PATH = Path.home() / "the-worked-shoot" / "audit" / "roster.md"
# champions.json is the SINGLE SOURCE OF TRUTH for current titles (see its _note).
# roster.md title phrases are incidental archetype-flavor; the overlay below pulls
# authoritative title data from here so the console never drifts on who holds what.
CHAMPIONS_PATH = Path.home() / "the-worked-shoot" / "tools" / "champions.json"
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data"

# Section header → (promotion, division, table_type)
# table_type: 'performer' (8 cols), 'departed' (3 cols), 'faction' (6 cols), 'faction5' (5 cols)
SECTION_MAP = {
    "WWE Main Roster — Men":                ("wwe", "men", "performer"),
    "WWE Main Roster — Women":              ("wwe", "women", "performer"),
    "Historical / Departed — Women":        ("wwe", "women", "departed"),
    "Historical / Departed — Men":          ("wwe", "men", "departed"),
    "Stables / Factions — Archetypal Collective": ("wwe", None, "faction"),
    "NXT Stables":                          ("nxt", None, "faction5"),
    "NXT — Departed":                       ("nxt", None, "departed"),
    "Men":                                  (None, "men", "performer"),   # context-dependent
    "Women":                                (None, "women", "performer"), # context-dependent
    "AEW — Men":                            ("aew", "men", "performer"),
    "AEW — Stables / Factions":             ("aew", None, "faction"),
    "AEW — Departed (Men)":                 ("aew", "men", "departed"),
    "AEW — Women":                          ("aew", "women", "performer"),
    "TNA — Roster":                         ("tna", "men", "performer"),
    "TNA — Knockouts":                      ("tna", "women", "performer"),
    "TNA — Factions":                       ("tna", None, "faction"),
    "TNA — Departed":                       ("tna", None, "departed"),
    "NJPW — Roster":                        ("njpw", "men", "performer"),
    "NJPW — Factions":                      ("njpw", None, "faction"),
    "NJPW — Departed":                      ("njpw", None, "departed"),
    "AAA — Roster":                         ("aaa", "mixed", "performer"),
    "AAA — Factions":                       ("aaa", None, "faction"),
    "AAA — Departed":                       ("aaa", None, "departed"),
    "MLW — Roster":                         ("mlw", "mixed", "performer"),
    "MLW — Factions":                       ("mlw", None, "faction"),
}

TRADITION_MAP = {
    # Egyptian
    "anubis": "egyptian", "apophis": "egyptian", "thoth": "egyptian",
    "ma'at": "egyptian", "osiris": "egyptian", "auset": "egyptian",
    "isis": "egyptian", "neith": "egyptian", "sekhmet": "egyptian",
    "ra": "egyptian", "hall of two truths": "egyptian",
    # Norse
    "loki": "norse", "fenrir": "norse", "surtr": "norse",
    "wotan": "norse", "odin": "norse", "frigg": "norse",
    "skadi": "norse", "freya": "norse", "valkyrie": "norse",
    "tyr": "norse", "bragi": "norse", "raijin": "japanese",
    # Greek
    "telemachus": "greek", "prometheus": "greek", "poseidon": "greek",
    "icarus": "greek", "ares": "greek", "hera": "greek",
    "athena": "greek", "persephone": "greek", "aphrodite": "greek",
    "apollo": "greek", "nike": "greek", "hermes": "greek",
    "theseus": "greek", "nemesis": "greek", "eris": "greek",
    "achilles": "greek", "bellerophon": "greek", "arachne": "greek",
    "elektra": "greek", "hekate": "greek", "hecate": "greek",
    "cronus": "greek", "titan": "greek", "mnemosyne": "greek",
    "amazone": "greek", "amazon": "greek", "dioscuri": "greek",
    "iago": "greek", "charon": "greek",
    # Celtic
    "morrigan": "celtic", "fomorian": "celtic", "balor": "celtic",
    "bálor": "celtic", "brigid": "celtic", "cailleach": "celtic",
    "boudica": "celtic", "lugh": "celtic", "cú chulainn": "celtic",
    "brigantia": "celtic", "morgan le fay": "celtic",
    # Mesoamerican
    "tezcatlipoca": "mesoamerican", "quetzalcoatl": "mesoamerican",
    "xochiquetzal": "mesoamerican", "coatlicue": "mesoamerican",
    "tlazolteotl": "mesoamerican", "mictlantecuhtli": "mesoamerican",
    "xipe totec": "mesoamerican", "coyolxauhqui": "mesoamerican",
    "mayahuel": "mesoamerican", "ixchel": "mesoamerican",
    "mictecacihuatl": "mesoamerican", "nahual": "mesoamerican",
    "hunahpu": "mesoamerican", "la catrina": "mesoamerican",
    "la malinche": "mesoamerican",
    # Japanese
    "onryō": "japanese", "susano-o": "japanese", "susanoo": "japanese",
    "yuki-onna": "japanese", "tengu": "japanese",
    "onna-musha": "japanese", "kitsune": "japanese",
    "amaterasu": "japanese", "benzaiten": "japanese",
    "onmyōji": "japanese",
    # Polynesian
    "aitu": "polynesian", "pele": "polynesian", "maui": "polynesian",
    # Yoruba
    "oya": "yoruba", "oshun": "yoruba", "orisha": "yoruba",
    "eshu": "yoruba", "elegua": "yoruba", "mami wata": "yoruba",
    # Slavic
    "baba yaga": "slavic",
    # Sumerian
    "inanna": "sumerian", "ereshkigal": "sumerian",
    # Nüwa
    "nüwa": "chinese",
    # Egyptian (Yoruba overlap for Auset/Isis)
    # Misc
    "durga": "hindu",
}

TIER_RING = {
    "pantheon": 1,
    "pantheon-adj": 1,
    "pantheon-mixed": 1,
    "pantheon-active": 1,
    "pantheon-resurrected": 1,
    "demihero": 2,
    "demihero-adj": 2,
    "demihero-group": 2,
    "demihero-collective": 2,
}
# Everything else → ring 3

def slugify(name):
    s = name.lower().strip()
    s = re.sub(r'[^a-z0-9]+', '-', s)
    return s.strip('-')

_SORTED_TRADITIONS = sorted(TRADITION_MAP.items(), key=lambda x: -len(x[0]))
_SHORT_KEYS = {k for k in TRADITION_MAP if len(k) <= 3}

def detect_tradition(archetype_str):
    if not archetype_str or archetype_str == "—":
        return "other"
    lower = archetype_str.lower()
    for key, tradition in _SORTED_TRADITIONS:
        if key in _SHORT_KEYS:
            if re.search(r'\b' + re.escape(key) + r'\b', lower):
                return tradition
        elif key in lower:
            return tradition
    return "other"

def normalize_tier(raw_tier):
    if not raw_tier:
        return "tbd"
    t = raw_tier.strip().lower()
    t = re.sub(r'\s*\(.*?\)\s*', '', t)  # strip parentheticals like "(aging)"
    t = t.split('→')[0].strip()           # take pre-transition state
    t = t.split('/')[0].strip()           # take primary if "Shadow/Trickster"
    t = re.sub(r'-$', '', t)              # strip trailing dash
    for canon in ["pantheon-adj", "pantheon-mixed", "pantheon-active",
                   "pantheon-resurrected", "pantheon",
                   "demihero-group", "demihero-collective", "demihero-adj", "demihero",
                   "shadow-pantheon", "shadow-adj", "shadow",
                   "trickster-pantheon", "trickster-shadow", "trickster",
                   "transitional", "failed", "tbd"]:
        if t.startswith(canon):
            return canon
    if t in ("retired", "released", "departed", "dead", "dissolved", "—", ""):
        return "departed"
    return "tbd"

def get_ring(tier):
    nt = normalize_tier(tier)
    return TIER_RING.get(nt, 3)

def parse_table_row(line, num_structured_cols):
    parts = line.split('|')
    # Strip leading/trailing empty strings from | at start/end
    if parts and parts[0].strip() == '':
        parts = parts[1:]
    if parts and parts[-1].strip() == '':
        parts = parts[:-1]

    if len(parts) < num_structured_cols:
        return None

    structured = [p.strip() for p in parts[:num_structured_cols - 1]]
    last_col = '|'.join(parts[num_structured_cols - 1:]).strip()
    structured.append(last_col)
    return structured

def is_separator_row(line):
    return bool(re.match(r'^\|[\s\-|]+\|?\s*$', line))

def is_table_row(line):
    stripped = line.strip()
    return stripped.startswith('|') and not is_separator_row(stripped)

def is_header_row(line):
    stripped = line.strip()
    if not stripped.startswith('|'):
        return False
    if is_separator_row(stripped):
        return False
    parts = [p.strip() for p in stripped.split('|') if p.strip()]
    return parts and parts[0] in ('Name', 'Tier', 'name')


# ─────────────────────────────────────────────────────────────────────────────
# champions.json overlay — authoritative current-title layer
# ─────────────────────────────────────────────────────────────────────────────

def _norm_name(name):
    """Normalize a name for matching: strip accents/quotes/asterisks, lowercase, collapse spaces."""
    if not name:
        return ""
    name = unicodedata.normalize("NFKD", name)
    name = "".join(c for c in name if not unicodedata.combining(c))
    name = name.replace('"', "").replace("'", "").replace("*", "")
    name = re.sub(r"\s+", " ", name).strip().lower()
    return name


def parse_holder(holder):
    """Parse a champions.json holder string into (is_vacant, team_or_None, [members]).

      'Cody Rhodes'                                -> (False, None, ['Cody Rhodes'])
      'Christian Cage & Adam Copeland'             -> (False, None, ['Christian Cage', 'Adam Copeland'])
      'The Vision — Austin Theory & Logan Paul'    -> (False, 'The Vision', ['Austin Theory', 'Logan Paul'])
      'Divine Dominion (Megan Bayne & Lena Kross)' -> (False, 'Divine Dominion', ['Megan Bayne', 'Lena Kross'])
      'VACANT — Willow Nightingale relinquished'   -> (True, None, [])
    """
    h = (holder or "").strip()
    if h.upper().startswith("VACANT"):
        return True, None, []

    team = None
    members_str = h
    # Faction label with parenthetical members: "Name (a & b)"
    m = re.match(r"^(.*?)\s*\((.*)\)\s*$", h)
    if m:
        team = m.group(1).strip()
        members_str = m.group(2).strip()
    elif " — " in h:
        # Faction label before an em-dash, members on the right: "Name — a & b"
        left, right = h.split(" — ", 1)
        if "&" in right or "," in right:
            team, members_str = left.strip(), right.strip()

    parts = re.split(r"\s*&\s*|\s*,\s*|\s+and\s+", members_str)
    members = [p.strip() for p in parts if p.strip()]
    return False, team, members


def apply_champions_overlay(entities, factions):
    """Attach an authoritative `current_titles` list to every matched entity/faction
    from champions.json, and return a coverage/drift report.

    Does NOT touch prose — title attribution in roster.md stays as archetype-flavor;
    this layer is the source of truth the UI should read for who currently holds what.
    """
    # Always-present empty field so the schema is stable downstream.
    for e in entities.values():
        e.setdefault("current_titles", [])
    for f in factions.values():
        f.setdefault("current_titles", [])

    report = {"matched": [], "missing_rows": [], "partial": [], "vacant": [], "source_updated": None}

    if not CHAMPIONS_PATH.exists():
        print(f"  ⚠ champions.json not found at {CHAMPIONS_PATH} — skipping title overlay")
        return report

    champ = json.loads(CHAMPIONS_PATH.read_text(encoding="utf-8"))
    report["source_updated"] = champ.get("_updated")

    # Normalized-name lookup indexes (a name can map to >1 row across promotions).
    ent_by_norm = defaultdict(list)
    for e in entities.values():
        ent_by_norm[_norm_name(e["name"])].append(e)
    fac_by_norm = defaultdict(list)
    for f in factions.values():
        fac_by_norm[_norm_name(f["name"])].append(f)

    def lookup(candidate):
        """Exact normalized match first, then a contains-fallback (handles
        'War Raiders' vs roster's 'War Raiders (Erik & Ivar)')."""
        nc = _norm_name(candidate)
        if not nc:
            return []
        hits = list(ent_by_norm.get(nc, [])) + list(fac_by_norm.get(nc, []))
        if hits:
            return hits
        for norm, rows in list(ent_by_norm.items()) + list(fac_by_norm.items()):
            if norm and (norm.startswith(nc + " ") or norm.startswith(nc + " (") or nc.startswith(norm + " ")):
                hits.extend(rows)
        return hits

    for t in champ.get("titles", []):
        rec = {
            "title": t.get("title", ""),
            "promotion": t.get("promotion", ""),
            "won": t.get("won", ""),
            "verified": t.get("verified", ""),
            "flag": t.get("flag", ""),
        }
        is_vacant, team, members = parse_holder(t.get("holder", ""))
        if is_vacant:
            report["vacant"].append({"title": rec["title"], "holder": t.get("holder", "")})
            continue

        candidates = ([team] if team else []) + members
        matched_names, unmatched_names = [], []
        for cand in candidates:
            hits = lookup(cand)
            if hits:
                matched_names.append(cand)
                for row in hits:
                    if not any(ct["title"] == rec["title"] and ct["promotion"] == rec["promotion"]
                               for ct in row["current_titles"]):
                        row["current_titles"].append(rec)
            else:
                unmatched_names.append(cand)

        if not matched_names:
            # No roster row exists for any holder — the Mark-Davis gap, caught automatically.
            report["missing_rows"].append({"title": rec["title"], "holder": t.get("holder", "")})
        elif unmatched_names:
            report["partial"].append({"title": rec["title"], "missing": unmatched_names})
        else:
            report["matched"].append(rec["title"])

    return report


def parse_roster():
    lines = ROSTER_PATH.read_text(encoding='utf-8').splitlines()

    entities = {}
    factions = {}
    departed = []
    entity_id = 0
    faction_id = 0

    current_section = None
    current_promotion = None
    current_division = None
    current_table_type = None
    parent_promotion = None  # for NXT sub-sections under "NXT — Notable"
    in_table = False
    skip_next_separator = False

    for i, line in enumerate(lines):
        stripped = line.strip()

        # Detect section headers
        header_match = re.match(r'^(#{2,3})\s+(.+)$', stripped)
        if header_match:
            level = len(header_match.group(1))
            title = header_match.group(2).strip()

            if title in SECTION_MAP:
                promo, div, ttype = SECTION_MAP[title]
                current_table_type = ttype

                # Handle context-dependent "Men" / "Women" under NXT
                if promo is None:
                    current_promotion = parent_promotion or current_promotion
                else:
                    current_promotion = promo
                current_division = div if div else current_division

                # Track parent context for NXT sub-sections
                if title == "NXT — Notable":
                    parent_promotion = "nxt"
                elif level == 2 and promo:
                    parent_promotion = None

                in_table = False
                continue

            elif title == "NXT — Notable":
                parent_promotion = "nxt"
                current_promotion = "nxt"
                in_table = False
                continue

            elif title.startswith("Inverted View"):
                current_table_type = "inverted"
                in_table = False
                continue

            elif title in ("Tier", "Columns", "How to read this"):
                current_table_type = None
                in_table = False
                continue

            # If we hit a section not in our map, reset if it's h2
            if level == 2 and title not in SECTION_MAP:
                if not title.startswith("Inverted View"):
                    current_table_type = None
                    in_table = False

        if current_table_type is None or current_table_type == "inverted":
            continue

        # Skip non-table lines
        if not stripped.startswith('|'):
            in_table = False
            continue

        # Skip separator rows
        if is_separator_row(stripped):
            continue

        # Skip header rows
        if is_header_row(stripped):
            in_table = True
            continue

        if not in_table:
            # We see a | line but haven't seen a header — might be a data row
            # after a separator we skipped. Check if this looks like data.
            parts = [p.strip() for p in stripped.split('|') if p.strip()]
            if len(parts) >= 3:
                in_table = True
            else:
                continue

        # Parse based on table type
        if current_table_type == "performer":
            cols = parse_table_row(stripped, 8)
            if not cols or len(cols) < 8:
                continue
            name, tier, archetype, aspect, conf, lands, scroll, notes = cols

            # Skip cross-ref-only entries
            if "Cross-ref" in archetype and "—" in tier:
                continue

            entity_id += 1
            tradition = detect_tradition(archetype)
            entities[str(entity_id)] = {
                "id": entity_id,
                "name": name.strip('*'),
                "tier": tier.strip('*'),
                "tier_normalized": normalize_tier(tier),
                "archetype": archetype,
                "aspect": aspect,
                "confidence": conf.lower().strip(),
                "lands": lands.lower().strip(),
                "scroll": scroll.strip(),
                "promotion": current_promotion,
                "division": current_division or "unknown",
                "departed": False,
                "tradition": tradition,
                "notes": notes,
                "photo_url": f"images/photos/{slugify(name.strip('*'))}.jpg",
                "archetype_symbol": f"images/archetypes/{slugify(archetype.split('/')[0].strip())}.jpg" if archetype and archetype != "—" else "",
            }

        elif current_table_type == "departed":
            cols = parse_table_row(stripped, 3)
            if not cols or len(cols) < 3:
                continue
            name, status, notes = cols

            entity_id += 1
            entities[str(entity_id)] = {
                "id": entity_id,
                "name": name.strip('*'),
                "tier": status,
                "tier_normalized": "departed",
                "archetype": "",
                "aspect": "",
                "confidence": "",
                "lands": "",
                "scroll": "",
                "promotion": current_promotion,
                "division": current_division or "unknown",
                "departed": True,
                "departed_status": status,
                "tradition": "other",
                "notes": notes,
                "photo_url": f"images/photos/{slugify(name.strip('*'))}.jpg",
                "archetype_symbol": "",
            }

        elif current_table_type in ("faction", "faction5"):
            if current_table_type == "faction":
                cols = parse_table_row(stripped, 6)
                if not cols or len(cols) < 6:
                    continue
                fname, ftier, farchetype, froles, fstatus, fnotes = cols
            else:
                cols = parse_table_row(stripped, 5)
                if not cols or len(cols) < 5:
                    continue
                fname, ftier, farchetype, fstatus, fnotes = cols
                froles = ""

            faction_id += 1
            factions[str(faction_id)] = {
                "id": faction_id,
                "name": fname.strip('*'),
                "tier": ftier.strip('*'),
                "tier_normalized": normalize_tier(ftier),
                "collective_archetype": farchetype,
                "internal_roles": froles,
                "status": fstatus,
                "promotion": current_promotion,
                "notes": fnotes,
                "tradition": detect_tradition(farchetype),
                "members": [],  # populated in post-processing
            }

    return entities, factions


def resolve_faction_members(entities, factions):
    """Match faction internal roles to entity IDs by name substring."""
    name_index = {}
    for eid, e in entities.items():
        # Index by last name and full name for matching
        name = e["name"]
        name_index[name.lower()] = eid
        parts = name.split()
        if len(parts) > 1:
            name_index[parts[-1].lower()] = eid
            # Also index by first name for short refs like "Moxley", "Dom"
            name_index[parts[0].lower()] = eid

    for fid, f in factions.items():
        roles_str = f["internal_roles"]
        if not roles_str:
            continue

        members = []
        # Parse "Name=role, Name=role" format
        for segment in re.split(r',\s*', roles_str):
            segment = segment.strip()
            if '=' in segment:
                member_name = segment.split('=')[0].strip()
            else:
                member_name = segment.strip()

            # Clean up common patterns
            member_name = re.sub(r'\s*\(.*?\)', '', member_name)  # strip parentheticals
            member_name = member_name.strip('*').strip()

            if not member_name:
                continue

            # Try to match to an entity
            matched = name_index.get(member_name.lower())
            if not matched:
                # Try partial match
                for ename, eid in name_index.items():
                    if member_name.lower() in ename or ename in member_name.lower():
                        matched = eid
                        break

            if matched:
                members.append(int(matched))

        f["members"] = members


def build_archetype_index(entities):
    """Build archetype → carriers mapping."""
    archetypes = defaultdict(lambda: {
        "name": "",
        "tradition": "other",
        "carriers": [],
        "promotions": set(),
    })

    for eid, e in entities.items():
        arch = e["archetype"]
        if not arch or arch == "—":
            continue

        # Use the primary archetype name (before /)
        primary = arch.split('/')[0].strip()
        primary_clean = re.sub(r'\s*\(.*?\)', '', primary).strip()

        if primary_clean not in archetypes:
            archetypes[primary_clean]["name"] = primary_clean
            archetypes[primary_clean]["tradition"] = e["tradition"]

        archetypes[primary_clean]["carriers"].append({
            "id": e["id"],
            "name": e["name"],
            "confidence": e["confidence"],
            "promotion": e["promotion"],
        })
        archetypes[primary_clean]["promotions"].add(e["promotion"])

    # Convert sets to lists for JSON
    result = {}
    for name, data in archetypes.items():
        slug = slugify(name)
        result[slug] = {
            "name": name,
            "slug": slug,
            "tradition": data["tradition"],
            "carriers": data["carriers"],
            "promotions": list(data["promotions"]),
            "symbol": f"images/symbols/{slug}.svg",
        }

    return result


def build_graph(entities, factions, archetypes):
    """Build Cytoscape.js-compatible graph with nodes and edges."""
    nodes = []
    edges = []
    edge_id = 0

    # Nodes from entities
    for eid, e in entities.items():
        nodes.append({
            "id": int(eid),
            "name": e["name"],
            "entity_type": "wrestler",
            "tier": e["tier_normalized"],
            "archetype": e["archetype"],
            "tradition": e["tradition"],
            "promotion": e["promotion"],
            "confidence": e["confidence"],
            "departed": e["departed"],
            "photo_url": e["photo_url"],
            "archetype_symbol": e.get("archetype_symbol", ""),
            "current_titles": e.get("current_titles", []),
            "connection_count": 0,
        })

    # Faction nodes (virtual)
    faction_node_offset = 10000
    for fid, f in factions.items():
        fnode_id = faction_node_offset + int(fid)
        nodes.append({
            "id": fnode_id,
            "name": f["name"],
            "entity_type": "faction",
            "tier": f["tier_normalized"],
            "archetype": f["collective_archetype"],
            "tradition": f["tradition"],
            "promotion": f["promotion"],
            "confidence": "",
            "departed": f["status"].lower() in ("dead", "dissolved", "dead (integrated)"),
            "photo_url": "",
            "current_titles": f.get("current_titles", []),
            "connection_count": 0,
        })

        # Edges: faction membership
        for member_id in f["members"]:
            edge_id += 1
            edges.append({
                "id": edge_id,
                "source": member_id,
                "target": fnode_id,
                "relationship_type": "faction_member",
                "label": f["name"],
            })

    # Edges: archetype kinship (shared primary archetype)
    for slug, arch_data in archetypes.items():
        carriers = arch_data["carriers"]
        if len(carriers) < 2:
            continue
        # Connect each pair
        for i in range(len(carriers)):
            for j in range(i + 1, len(carriers)):
                edge_id += 1
                edges.append({
                    "id": edge_id,
                    "source": carriers[i]["id"],
                    "target": carriers[j]["id"],
                    "relationship_type": "archetype_kin",
                    "label": arch_data["name"],
                })

    # Edges: cross-promotional (same person in multiple promotions)
    # Detect by similar names across different promotions
    name_to_entries = defaultdict(list)
    for eid, e in entities.items():
        name_to_entries[e["name"].lower()].append(e)

    for name, entries in name_to_entries.items():
        if len(entries) < 2:
            continue
        promos = set(e["promotion"] for e in entries)
        if len(promos) > 1:
            for i in range(len(entries)):
                for j in range(i + 1, len(entries)):
                    edge_id += 1
                    edges.append({
                        "id": edge_id,
                        "source": entries[i]["id"],
                        "target": entries[j]["id"],
                        "relationship_type": "cross_promo",
                        "label": "cross-promotional",
                    })

    # Update connection counts
    conn_count = defaultdict(int)
    for e in edges:
        conn_count[e["source"]] += 1
        conn_count[e["target"]] += 1
    for n in nodes:
        n["connection_count"] = conn_count.get(n["id"], 0)

    return {"nodes": nodes, "edges": edges}


def build_layer_assignments(entities):
    """Assign each entity to its promotion branch and ring."""
    assignments = {}
    for eid, e in entities.items():
        assignments[eid] = {
            "branch": e["promotion"],
            "ring": get_ring(e["tier"]),
        }
    return assignments


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Parsing roster.md...")
    entities, factions = parse_roster()
    print(f"  {len(entities)} entities, {len(factions)} factions")

    print("Resolving faction members...")
    resolve_faction_members(entities, factions)
    member_count = sum(len(f["members"]) for f in factions.values())
    print(f"  {member_count} member links resolved")

    print("Applying champions.json title overlay...")
    coverage = apply_champions_overlay(entities, factions)
    held = sum(len(e["current_titles"]) for e in entities.values()) + \
        sum(len(f["current_titles"]) for f in factions.values())
    print(f"  {len(coverage['matched'])} titles matched to rows, {held} title-attachments")

    print("Building archetype index...")
    archetypes = build_archetype_index(entities)
    print(f"  {len(archetypes)} distinct archetypes")

    print("Building graph...")
    graph = build_graph(entities, factions, archetypes)
    print(f"  {len(graph['nodes'])} nodes, {len(graph['edges'])} edges")

    print("Computing layer assignments...")
    assignments = build_layer_assignments(entities)

    # Write outputs
    def write_json(filename, data):
        path = OUTPUT_DIR / filename
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
        print(f"  Wrote {path} ({path.stat().st_size:,} bytes)")

    write_json("entities.json", entities)
    write_json("graph.json", graph)
    write_json("layer_assignments.json", assignments)
    write_json("archetypes.json", archetypes)
    write_json("factions.json", factions)
    write_json("title_coverage.json", coverage)

    # Title-overlay drift report — what champions.json knows that the roster doesn't.
    if coverage.get("missing_rows") or coverage.get("partial"):
        print("\n--- ⚠ Title drift (champions.json holders with no/partial roster row) ---")
        for m in coverage.get("missing_rows", []):
            print(f"  MISSING ROW: {m['holder']} — {m['title']}")
        for p in coverage.get("partial", []):
            print(f"  PARTIAL: {p['title']} — unmatched: {', '.join(p['missing'])}")
    if coverage.get("vacant"):
        print(f"  ({len(coverage['vacant'])} vacant title(s): " +
              ", ".join(v["title"] for v in coverage["vacant"]) + ")")

    # Summary stats
    promos = defaultdict(int)
    tiers = defaultdict(int)
    for e in entities.values():
        if not e["departed"]:
            promos[e["promotion"]] += 1
            tiers[e["tier_normalized"]] += 1

    print("\n--- Summary ---")
    print("Active performers by promotion:")
    for p, c in sorted(promos.items(), key=lambda x: -x[1]):
        print(f"  {p}: {c}")
    print("Active performers by tier:")
    for t, c in sorted(tiers.items(), key=lambda x: -x[1]):
        print(f"  {t}: {c}")


if __name__ == "__main__":
    main()
