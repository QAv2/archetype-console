#!/usr/bin/env python3
"""Scrape WWE.com /superstars/<slug> pages for official portraits.

WWE.com hosts square 1:1 talent portraits at /f/styles/talent_champion_xl/...
These are higher quality than Wikipedia and come pre-cropped to a portrait
frame (face + upper body, often on isolated backgrounds).

For each slug, we fetch /superstars/<slug>, parse for talent_champion_xl
URLs whose filename matches the slug, download to images/photos-review/<slug>.png,
and write a .source.txt sidecar.

Usage:
    /home/joseph/archetype-console/.venv/bin/python tools/scrape_wwe.py [slug1 slug2 ...]
    # Or with --from FILE to read slugs from a JSON list of strings
"""
import argparse
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REVIEW_DIR = ROOT / "images" / "photos-review"
REVIEW_DIR.mkdir(parents=True, exist_ok=True)

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
BASE = "https://www.wwe.com"
SUPERSTAR_URL = BASE + "/superstars/{slug}"
DELAY = 1.5  # seconds between requests


def http_get(url, *, binary=False, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
    return data if binary else data.decode("utf-8", errors="replace")


def slug_tokens(slug):
    return [t for t in re.split(r"[-_]+", slug.lower()) if t]


def find_portrait(html, slug):
    """Pick the best talent_champion_xl URL from page HTML.

    Strategy: collect all /f/styles/talent_champion_xl/ URLs. If only one
    unique URL exists, trust the page filter and return it (handles cases
    where WWE's filename uses a different spelling — Jakob vs Jacob, just
    "CHELSEA" without surname, etc.). If multiple, require all slug tokens
    to appear in the filename.
    """
    pattern = re.compile(r'/f/styles/talent_champion_xl/[^"\s]+\.(?:png|jpe?g|webp)', re.I)
    candidates = sorted(set(pattern.findall(html)))
    if not candidates:
        return None

    if len(candidates) == 1:
        return BASE + candidates[0]

    tokens = slug_tokens(slug)
    matched = []
    for path in candidates:
        fname = path.rsplit("/", 1)[-1].lower()
        norm = re.sub(r"[^a-z0-9]+", " ", fname)
        if all(t in norm for t in tokens):
            matched.append(path)
    if not matched:
        return None
    return BASE + sorted(matched)[-1]


def scrape_one(slug, url_slug=None):
    page_url = SUPERSTAR_URL.format(slug=url_slug or slug)
    try:
        html = http_get(page_url)
    except Exception as e:
        return False, f"page fetch failed: {e}"

    # We rely on /superstars/<slug> 404'ing for non-existent slugs; the page
    # title may differ from our slug (Nattie vs Natalya, ring-name vs real-name).
    portrait_url = find_portrait(html, slug)
    if not portrait_url:
        return False, "no matching talent_champion_xl portrait found"

    try:
        img_data = http_get(portrait_url, binary=True)
    except Exception as e:
        return False, f"image fetch failed: {e}"

    ext = portrait_url.rsplit(".", 1)[-1].lower().split("?")[0]
    if ext not in ("png", "jpg", "jpeg", "webp"):
        ext = "png"
    out_img = REVIEW_DIR / f"{slug}.{ext}"
    out_img.write_bytes(img_data)

    out_src = REVIEW_DIR / f"{slug}.source.txt"
    out_src.write_text(
        f"source: {page_url}\n"
        f"image: {portrait_url}\n"
        f"scraper: wwe-com\n"
    )
    return True, f"{out_img.relative_to(ROOT)} ({len(img_data)} bytes)"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("slugs", nargs="*", help="slugs to scrape")
    ap.add_argument("--from", dest="from_file", help="path to JSON list of slugs")
    ap.add_argument("--aliases", help="path to JSON map of {our_slug: wwe_url_slug} for cases where WWE.com uses a different URL spelling")
    args = ap.parse_args()

    slugs = list(args.slugs)
    if args.from_file:
        slugs.extend(json.loads(Path(args.from_file).read_text()))
    if not slugs:
        print("no slugs given. pass on cli or via --from list.json", file=sys.stderr)
        sys.exit(2)

    aliases = {}
    if args.aliases:
        aliases = json.loads(Path(args.aliases).read_text())

    print(f"Scraping {len(slugs)} slug(s) from WWE.com...\n")
    ok, fail = [], []
    for i, slug in enumerate(slugs, 1):
        url_slug = aliases.get(slug)
        label = slug if not url_slug else f"{slug} → {url_slug}"
        print(f"[{i:>2}/{len(slugs)}] {label:<36}", end=" ", flush=True)
        success, msg = scrape_one(slug, url_slug=url_slug)
        if success:
            ok.append(slug)
            print(f"OK   {msg}")
        else:
            fail.append((slug, msg))
            print(f"MISS {msg}")
        if i < len(slugs):
            time.sleep(DELAY)

    print(f"\nDone. ok={len(ok)}  miss={len(fail)}")
    if fail:
        report = REVIEW_DIR / "_wwe_misses.txt"
        report.write_text("\n".join(f"{s}: {m}" for s, m in fail) + "\n")
        print(f"Misses written to {report.relative_to(ROOT)}")


if __name__ == "__main__":
    sys.exit(main() or 0)
