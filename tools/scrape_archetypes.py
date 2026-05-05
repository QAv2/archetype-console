#!/usr/bin/env python3
"""Fetch candidate archetype depictions from Wikipedia/Wikimedia.

Scrapes images for mythological archetype figures (Loki, Telemachus, Apophis,
etc.). Composite wrestling archetypes (e.g., "Aerial-trickster") rarely have
clean Wikipedia matches and are skipped without error.

Saves to images/archetypes-review/ for manual approval. Resumable.
Rate-limited (1.2s/req).

Usage:
    python3 tools/scrape_archetypes.py
    python3 tools/scrape_archetypes.py --limit 20
    python3 tools/scrape_archetypes.py --tradition norse
"""
import argparse
import io
import json
import sys
import time
from pathlib import Path
from urllib.parse import quote

import requests
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ARCHETYPES_FILE = ROOT / "data" / "archetypes.json"
APPROVED_DIR = ROOT / "images" / "archetypes"
REVIEW_DIR = ROOT / "images" / "archetypes-review"
REVIEW_DIR.mkdir(parents=True, exist_ok=True)

UA = (
    "ArchetypeConsole/1.0 "
    "(personal wrestling-archetype mapping tool; non-commercial; "
    "https://github.com/qav2)"
)
RATE_LIMIT_SEC = 1.2
THUMB_SIZE = 480
MIN_BYTES = 4_000
TARGET_SIZE = 400

# Traditions that are likely to have Wikipedia mythological matches.
NAMED_TRADITIONS = {
    "greek", "norse", "celtic", "egyptian", "japanese", "mesoamerican",
    "polynesian", "yoruba", "slavic", "sumerian", "chinese", "hindu",
}

TRADITION_QUALIFIERS = {
    "greek": "Greek mythology",
    "norse": "Norse mythology",
    "celtic": "Celtic mythology",
    "egyptian": "Egyptian mythology",
    "japanese": "Japanese mythology",
    "mesoamerican": "Aztec mythology",
    "polynesian": "Polynesian mythology",
    "yoruba": "Yoruba religion",
    "slavic": "Slavic mythology",
    "sumerian": "Mesopotamian mythology",
    "chinese": "Chinese mythology",
    "hindu": "Hindu mythology",
}

session = requests.Session()
session.headers.update({"User-Agent": UA})


def already_have(slug: str) -> bool:
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        if (APPROVED_DIR / f"{slug}{ext}").exists():
            return True
        if (REVIEW_DIR / f"{slug}{ext}").exists():
            return True
    return False


def query_pageimage(title: str):
    params = {
        "action": "query",
        "format": "json",
        "titles": title,
        "prop": "pageimages|extracts",
        "pithumbsize": THUMB_SIZE,
        "exintro": 1,
        "explaintext": 1,
        "exchars": 200,
        "redirects": 1,
    }
    r = session.get("https://en.wikipedia.org/w/api.php", params=params, timeout=15)
    r.raise_for_status()
    data = r.json()
    pages = data.get("query", {}).get("pages", {})
    for page in pages.values():
        if "missing" in page:
            continue
        thumb = page.get("thumbnail", {}).get("source")
        if thumb:
            return thumb, page.get("title"), page.get("extract", "")
    return None, None, None


def search_then_image(query: str, must_contain: str = ""):
    params = {
        "action": "query",
        "format": "json",
        "list": "search",
        "srsearch": query,
        "srlimit": 3,
    }
    r = session.get("https://en.wikipedia.org/w/api.php", params=params, timeout=15)
    r.raise_for_status()
    hits = r.json().get("query", {}).get("search", [])
    for hit in hits:
        title = hit.get("title")
        snippet = (hit.get("snippet") or "").lower()
        if must_contain and must_contain.lower() not in snippet and must_contain.lower() not in title.lower():
            continue
        time.sleep(RATE_LIMIT_SEC)
        url, resolved, extract = query_pageimage(title)
        if url:
            return url, resolved, extract
    return None, None, None


def fetch_and_save(image_url: str, slug: str, source_title: str, extract: str):
    r = session.get(image_url, timeout=30)
    r.raise_for_status()
    if len(r.content) < MIN_BYTES:
        return False, f"too small ({len(r.content)} bytes)"

    try:
        img = Image.open(io.BytesIO(r.content))
    except Exception as e:
        return False, f"PIL open failed: {e}"

    if img.mode in ("RGBA", "P", "LA"):
        bg = Image.new("RGB", img.size, (10, 10, 15))
        bg.paste(img, mask=img.split()[-1] if img.mode in ("RGBA", "LA") else None)
        img = bg
    elif img.mode != "RGB":
        img = img.convert("RGB")

    img.thumbnail((TARGET_SIZE, TARGET_SIZE), Image.LANCZOS)

    target = REVIEW_DIR / f"{slug}.jpg"
    img.save(target, "JPEG", quality=88, optimize=True)

    sidecar = REVIEW_DIR / f"{slug}.source.txt"
    sidecar.write_text(
        f"source: en.wikipedia.org/wiki/{quote(source_title.replace(' ', '_'))}\n"
        f"image: {image_url}\n"
        f"extract: {extract}\n"
    )
    return True, str(target.relative_to(ROOT))


def first_name(archetype_name: str) -> str:
    """Strip composite suffixes like '-singular', '+ X', '/ Y' to get the
    core mythological figure name."""
    name = archetype_name.split("/")[0].split("+")[0].strip()
    # Drop trailing qualifiers after hyphen for composites like "Telemachus-arc"
    # but keep multi-word names like "Baba Yaga".
    if "-" in name and not name[0].islower():
        parts = name.split("-")
        # If the first segment is capitalized and the rest looks like modifiers, take just the first.
        if all(p and p[0].islower() for p in parts[1:]):
            name = parts[0]
    return name


def process_one(slug: str, archetype: dict):
    name = archetype["name"]
    tradition = archetype.get("tradition", "")
    core = first_name(name)

    candidates = [core]
    if tradition in TRADITION_QUALIFIERS:
        candidates.append(f"{core} ({TRADITION_QUALIFIERS[tradition]})")

    try:
        for q in candidates:
            url, resolved, extract = query_pageimage(q)
            if url:
                time.sleep(RATE_LIMIT_SEC)
                return fetch_and_save(url, slug, resolved or q, extract)
            time.sleep(RATE_LIMIT_SEC)

        # Last resort: search with mythology context
        if tradition in TRADITION_QUALIFIERS:
            url, resolved, extract = search_then_image(
                f"{core} {TRADITION_QUALIFIERS[tradition]}",
                must_contain=core,
            )
            if url:
                time.sleep(RATE_LIMIT_SEC)
                return fetch_and_save(url, slug, resolved or core, extract)

        return False, "no match"
    except requests.HTTPError as e:
        return False, f"http {e.response.status_code}"
    except requests.RequestException as e:
        return False, f"network: {e}"
    except Exception as e:
        return False, f"error: {e}"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--tradition", type=str, default="", help="restrict to one tradition (e.g. 'norse')")
    ap.add_argument("--include-other", action="store_true", help="also try composite/'other' archetypes")
    args = ap.parse_args()

    archetypes = json.loads(ARCHETYPES_FILE.read_text())

    candidates = []
    for slug, arch in archetypes.items():
        trad = arch.get("tradition", "")
        if args.tradition and trad != args.tradition:
            continue
        if not args.include_other and trad not in NAMED_TRADITIONS:
            continue
        candidates.append((slug, arch))

    if args.limit > 0:
        candidates = candidates[: args.limit]

    found = 0
    skipped = 0
    misses = []

    for i, (slug, arch) in enumerate(candidates, 1):
        if already_have(slug):
            skipped += 1
            continue

        prefix = f"[{i:>3}/{len(candidates)}] {arch['name']:<30} ({arch.get('tradition','')})"
        print(prefix, end=" ", flush=True)

        ok, msg = process_one(slug, arch)
        if ok:
            found += 1
            print(f"OK   {msg}")
        else:
            misses.append(f"{arch['name']} ({slug}): {msg}")
            print(f"MISS {msg}")

        time.sleep(RATE_LIMIT_SEC)

    if misses:
        report = REVIEW_DIR / "_misses.txt"
        report.write_text("\n".join(misses) + "\n")
        print(f"\nMiss report: {report.relative_to(ROOT)}")

    print(f"\nDone. found={found}  skipped={skipped}  missed={len(misses)}")
    print(f"Review folder: {REVIEW_DIR.relative_to(ROOT)}")


if __name__ == "__main__":
    sys.exit(main() or 0)
