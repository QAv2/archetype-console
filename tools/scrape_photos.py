#!/usr/bin/env python3
"""Fetch candidate wrestler portraits from Wikipedia/Wikimedia.

Saves to images/photos-review/ for manual approval. Resumable: skips wrestlers
already present in either review or photos folders. Rate-limited (1.2s/req).

Usage:
    python3 tools/scrape_photos.py            # all 239 wrestlers
    python3 tools/scrape_photos.py --limit 20 # first 20 only (for testing)
    python3 tools/scrape_photos.py --only "Cody Rhodes,CM Punk"
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
ENTITIES = ROOT / "data" / "entities.json"
PHOTOS_DIR = ROOT / "images" / "photos"
REVIEW_DIR = ROOT / "images" / "photos-review"
REVIEW_DIR.mkdir(parents=True, exist_ok=True)

UA = (
    "ArchetypeConsole/1.0 "
    "(personal wrestling-archetype mapping tool; non-commercial; "
    "https://github.com/qav2)"
)
RATE_LIMIT_SEC = 1.2
THUMB_SIZE = 480
MIN_BYTES = 4_000  # skip suspiciously tiny images
TARGET_SIZE = 400  # final saved image edge length

session = requests.Session()
session.headers.update({"User-Agent": UA})


def slug_from_url(photo_url: str) -> str:
    return Path(photo_url).stem


def already_have(slug: str) -> bool:
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        if (PHOTOS_DIR / f"{slug}{ext}").exists():
            return True
        if (REVIEW_DIR / f"{slug}{ext}").exists():
            return True
    return False


def query_pageimage(title: str):
    """Return (image_url, resolved_title, extract) or (None, None, None)."""
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


def search_then_image(query: str):
    """Search Wikipedia for `query`, then fetch pageimage of best hit."""
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
        snippet = hit.get("snippet", "").lower()
        if "wrestl" not in snippet and "wwe" not in snippet and "aew" not in snippet:
            continue
        time.sleep(RATE_LIMIT_SEC)
        url, resolved, extract = query_pageimage(title)
        if url:
            return url, resolved, extract
    return None, None, None


def fetch_and_save(image_url: str, slug: str, source_title: str, extract: str):
    """Download `image_url`, transcode to JPG, save to review folder."""
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


def process_one(name: str, slug: str):
    try:
        url, resolved, extract = query_pageimage(name)
        if not url:
            time.sleep(RATE_LIMIT_SEC)
            url, resolved, extract = query_pageimage(f"{name} (wrestler)")
        if not url:
            time.sleep(RATE_LIMIT_SEC)
            url, resolved, extract = search_then_image(f"{name} professional wrestler")

        if not url:
            return False, "no page image found"

        time.sleep(RATE_LIMIT_SEC)
        return fetch_and_save(url, slug, resolved or name, extract)
    except requests.HTTPError as e:
        return False, f"http {e.response.status_code}"
    except requests.RequestException as e:
        return False, f"network: {e}"
    except Exception as e:
        return False, f"error: {e}"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--limit", type=int, default=0, help="cap number of wrestlers to fetch")
    ap.add_argument("--only", type=str, default="", help="comma-separated names to fetch (overrides limit)")
    args = ap.parse_args()

    entities = json.loads(ENTITIES.read_text())
    wrestlers = [e for e in entities.values() if e.get("photo_url") and e.get("name")]

    if args.only:
        wanted = {n.strip().lower() for n in args.only.split(",") if n.strip()}
        wrestlers = [e for e in wrestlers if e["name"].lower() in wanted]

    if args.limit > 0 and not args.only:
        wrestlers = wrestlers[: args.limit]

    found = 0
    skipped = 0
    misses = []

    for i, e in enumerate(wrestlers, 1):
        name = e["name"]
        slug = slug_from_url(e["photo_url"])

        if already_have(slug):
            skipped += 1
            continue

        prefix = f"[{i:>3}/{len(wrestlers)}] {name:<32}"
        print(f"{prefix}", end=" ", flush=True)

        ok, msg = process_one(name, slug)
        if ok:
            found += 1
            print(f"OK   {msg}")
        else:
            misses.append(f"{name} ({slug}): {msg}")
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
