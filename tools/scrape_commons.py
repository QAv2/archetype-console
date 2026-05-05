#!/usr/bin/env python3
"""Scrape Wikimedia Commons for wrestler portraits.

Used for promotions whose websites we can't scrape directly:
  - AEW (Wix SPA, dynamic-loaded data)
  - NJPW (Akamai-blocked)
  - AAA (no public roster site)

Commons has a much broader photo library than the Wikipedia article infobox
that scrape_photos.py used — including recent AEW-era photos for performers
who left WWE. The MediaWiki API exposes free-text search across File: namespace
plus imageinfo for direct download URLs.

Strategy per slug:
  1. Look up display name in data/entities.json
  2. Query Commons for `"<name>"` (quoted phrase)
  3. Score candidates by keywords (headshot / portrait / cropped / promo bonus,
     drawing / fanart / autograph penalty) and recency
  4. Fetch imageinfo for the top pick → real download URL
  5. Save photos-review/<slug>.<ext> + .source.txt

Usage:
  /home/joseph/archetype-console/.venv/bin/python tools/scrape_commons.py [slug ...]
  /home/joseph/archetype-console/.venv/bin/python tools/scrape_commons.py --from list.json
  /home/joseph/archetype-console/.venv/bin/python tools/scrape_commons.py --aliases m.json --from list.json
"""
import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENTITIES = json.loads((ROOT / "data" / "entities.json").read_text())
REVIEW_DIR = ROOT / "images" / "photos-review"
REVIEW_DIR.mkdir(parents=True, exist_ok=True)

UA = "ArchetypeConsole/1.0 (https://github.com/qav2; joe@archetype-console.local)"
API = "https://commons.wikimedia.org/w/api.php"
DELAY = 1.0  # MediaWiki rate limit is forgiving but be polite

POSITIVE_TERMS = [
    ("headshot", 8), ("portrait", 6), ("(cropped)", 4), ("cropped", 3),
    ("AEW", 3), ("All Elite", 3), ("NJPW", 2), ("TNA", 2), ("Impact", 1),
    ("promo", 2), ("entrance", 1), ("ring", 1),
]
NEGATIVE_TERMS = [
    ("drawing", -10), ("fanart", -10), ("autograph", -8), ("sketch", -8),
    ("logo", -5), ("crowd", -5), ("backstage shot", -2),
    ("group", -3), ("tag team", -2), ("with ", -1),  # " with X" usually means co-pose
    # Common false-positive subjects: art/architecture/places
    ("bust ", -15), ("sculpture", -15), ("statue", -15), ("monument", -10),
    ("glyptothek", -20), ("velletri", -15), ("museum", -8),
    ("by spiridione", -20), ("painting", -12), ("fresco", -15), ("mosaic", -12),
    ("cathedral", -10), ("church", -8), ("temple", -8),
    ("brücke", -15), ("bruecke", -15), ("brucke", -15),  # bridge in German
    ("ponte", -10), ("plaza", -8), ("piazza", -8),
    # Wrong-subject markers (concerts, mascots, etc.)
    ("arena 20", -8), ("concert", -10), ("band", -8),
    ("running double knees", -15), ("vs ", -8),  # action shots involving the subject
]


def http_get(url, *, binary=False, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
    return data if binary else data.decode("utf-8", errors="replace")


def commons_search(query, limit=20):
    params = {
        "action": "query", "list": "search",
        "srsearch": query, "srnamespace": "6",
        "srlimit": str(limit), "format": "json",
        "srprop": "timestamp|wordcount",
    }
    return json.loads(http_get(API + "?" + urllib.parse.urlencode(params)))


def commons_imageinfo(titles):
    params = {
        "action": "query",
        "titles": "|".join(titles),
        "prop": "imageinfo",
        "iiprop": "url|size|mime|extmetadata",
        "iiurlwidth": "1200",
        "format": "json",
    }
    return json.loads(http_get(API + "?" + urllib.parse.urlencode(params)))


def slug_to_name(slug):
    for e in ENTITIES.values():
        if not e.get("photo_url"):
            continue
        s = e["photo_url"].rsplit("/", 1)[-1].rsplit(".", 1)[0]
        if s == slug:
            return e["name"]
    return None


def score_candidate(title, name):
    """Score a Commons File: title for fit. Higher = better."""
    s = 0
    low = title.lower()
    name_low = name.lower()

    # Must contain the name (allow first or last name match for multi-word)
    name_tokens = [t for t in re.split(r"\s+", name_low) if len(t) > 2]
    if not any(t in low for t in name_tokens):
        return -1000  # disqualify
    if all(t in low for t in name_tokens):
        s += 5  # full-name match

    for term, pts in POSITIVE_TERMS:
        if term.lower() in low:
            s += pts
    for term, pts in NEGATIVE_TERMS:
        if term.lower() in low:
            s += pts  # already negative

    # Recency: 4-digit year in title (2018-2026 range)
    years = re.findall(r"\b(20\d{2})\b", title)
    if years:
        try:
            s += min(int(years[-1]) - 2018, 8)
        except ValueError:
            pass

    return s


def find_best(name):
    # Strip embedded nickname quotes that come from entity names like
    # `"Hangman" Adam Page` — those literal quotes confuse the Commons search.
    cleaned = re.sub(r'["“”]', '', name).strip()
    r = commons_search(f'"{cleaned}"')
    hits = r.get("query", {}).get("search", [])
    if not hits:
        return None, None
    scored = [(score_candidate(h["title"], name), h) for h in hits]
    scored.sort(key=lambda x: x[0], reverse=True)
    if not scored or scored[0][0] < 0:
        return None, None
    return scored[0][1]["title"], scored[0][0]


def scrape_one(slug, alias=None, explicit_file=None):
    if explicit_file:
        title = explicit_file if explicit_file.startswith("File:") else f"File:{explicit_file}"
        score = "explicit"
    else:
        name = alias or slug_to_name(slug)
        if not name:
            return False, f"no name for slug; pass --aliases"
        title, score = find_best(name)
        if not title:
            return False, f"no candidate matched (queried '{name}')"

    info = commons_imageinfo([title])
    pages = info.get("query", {}).get("pages", {})
    page = next(iter(pages.values()))
    iinfo = (page.get("imageinfo") or [{}])[0]
    img_url = iinfo.get("thumburl") or iinfo.get("url")
    if not img_url:
        return False, f"no URL in imageinfo for {title}"

    try:
        data = http_get(img_url, binary=True)
    except Exception as e:
        return False, f"image fetch failed: {e}"

    # Resolve extension from URL or MIME
    ext_match = re.search(r"\.(jpg|jpeg|png|webp)(\?|$)", img_url, re.I)
    ext = ext_match.group(1).lower() if ext_match else "jpg"
    out_img = REVIEW_DIR / f"{slug}.{ext}"
    out_img.write_bytes(data)
    out_src = REVIEW_DIR / f"{slug}.source.txt"
    out_src.write_text(
        f"source: https://commons.wikimedia.org/wiki/{title.replace(' ', '_')}\n"
        f"image: {img_url}\n"
        f"scraper: wikimedia-commons\n"
        f"queried: {alias if explicit_file else (alias or slug_to_name(slug))}\n"
        f"score: {score}\n"
    )
    return True, f"{out_img.relative_to(ROOT)} ({len(data)}b, score={score}, file={title})"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("slugs", nargs="*")
    ap.add_argument("--from", dest="from_file")
    ap.add_argument("--aliases", help="JSON {our_slug: 'name to query'} for cases where the entity name differs from Commons convention")
    ap.add_argument("--files", help="JSON {our_slug: 'File:Title.jpg'} to bypass search and pull a specific file")
    args = ap.parse_args()

    slugs = list(args.slugs)
    if args.from_file:
        slugs.extend(json.loads(Path(args.from_file).read_text()))
    slugs = list(dict.fromkeys(slugs))
    if not slugs:
        print("no slugs given", file=sys.stderr); sys.exit(2)

    aliases = json.loads(Path(args.aliases).read_text()) if args.aliases else {}
    explicit = json.loads(Path(args.files).read_text()) if args.files else {}

    print(f"Scraping {len(slugs)} slug(s) from Wikimedia Commons...\n")
    ok, fail = [], []
    for i, slug in enumerate(slugs, 1):
        alias = aliases.get(slug)
        ef = explicit.get(slug)
        if ef:
            label = f"{slug} → file:{ef}"
        elif alias:
            label = f"{slug} → {alias!r}"
        else:
            label = slug
        print(f"[{i:>2}/{len(slugs)}] {label:<58}", end=" ", flush=True)
        success, msg = scrape_one(slug, alias=alias, explicit_file=ef)
        if success:
            ok.append(slug); print(f"OK   {msg}")
        else:
            fail.append((slug, msg)); print(f"MISS {msg}")
        if i < len(slugs):
            time.sleep(DELAY)

    print(f"\nDone. ok={len(ok)}  miss={len(fail)}")
    if fail:
        report = REVIEW_DIR / "_commons_misses.txt"
        report.write_text("\n".join(f"{s}: {m}" for s, m in fail) + "\n")
        print(f"Misses → {report.relative_to(ROOT)}")


if __name__ == "__main__":
    sys.exit(main() or 0)
