#!/usr/bin/env python3
"""Audit which archetypes have live images vs fall back to tradition glyph."""
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARCHETYPES = json.loads((ROOT / "data" / "archetypes.json").read_text())
LIVE = {f.stem for f in (ROOT / "images" / "archetypes").iterdir() if f.suffix == ".jpg"}


def slug(s: str) -> str:
    s = re.sub(r"[^\w\s-]", "", s.lower())
    return re.sub(r"[-\s]+", "-", s).strip("-")


def base_name_candidates(name: str):
    """Possible base mythological names extracted from a composite archetype."""
    s = name.split("/")[0].split("+")[0].split("—")[0].split("-")[0].strip()
    parts = re.split(r"[-\s]+", s)
    proper = [p for p in parts if p and p[0].isupper() and len(p) > 2]
    return proper or [s]


have = []
miss_with_base = []  # composite names where the base IS a famous mythological figure
miss_generic = []    # genuinely composite/abstract names

for slug_id, arch in ARCHETYPES.items():
    name = arch["name"]
    trad = arch.get("tradition", "")

    if slug_id in LIVE:
        have.append((slug_id, name, trad))
        continue

    # Try base-name extraction
    candidates = base_name_candidates(name)
    base_hits = []
    for c in candidates:
        cs = slug(c)
        if cs in LIVE:
            base_hits.append(cs)

    if base_hits:
        miss_with_base.append((slug_id, name, trad, base_hits[0]))
    else:
        miss_generic.append((slug_id, name, trad, candidates))


print(f"=== AUDIT: {len(ARCHETYPES)} total archetypes ===\n")
print(f"  HAVE image:                  {len(have):>4}")
print(f"  MISS but base-name HAS:      {len(miss_with_base):>4}  (could symlink/fallback)")
print(f"  MISS, no obvious base:       {len(miss_generic):>4}\n")

print("=== Group A: composite slug, base-name image already exists ===")
print("(easy win — runtime fallback to base would solve these)\n")
for slug_id, name, trad, base in miss_with_base[:30]:
    print(f"  {slug_id:<40} -> {base}")
if len(miss_with_base) > 30:
    print(f"  ... +{len(miss_with_base) - 30} more")

print("\n=== Group B: missing entirely (need new scrape candidates) ===")
print("(grouped by tradition)\n")
by_trad = {}
for slug_id, name, trad, candidates in miss_generic:
    by_trad.setdefault(trad, []).append((slug_id, name, candidates))

for trad in sorted(by_trad.keys()):
    items = by_trad[trad]
    print(f"  [{trad}] ({len(items)})")
    for slug_id, name, candidates in items[:10]:
        cand_str = " | ".join(candidates[:3])
        print(f"    {name:<35}  candidates: {cand_str}")
    if len(items) > 10:
        print(f"    ... +{len(items) - 10} more in {trad}")
    print()
