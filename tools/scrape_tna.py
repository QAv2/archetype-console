#!/usr/bin/env python3
"""Scrape TNA Wrestling /roster/<slug>/ pages for fighter cutouts.

TNA hosts isolated transparent-PNG portraits at /media/fighters/cutouts/<hash>-1-1.png,
referenced from each roster page's <img class="fighter-cutout">. Same shape as WWE.com
official portraits — high quality, alpha channel intact.

Usage:
  /home/joseph/archetype-console/.venv/bin/python tools/scrape_tna.py [slug ...]
  /home/joseph/archetype-console/.venv/bin/python tools/scrape_tna.py --from list.json
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
BASE = "https://tnawrestling.com"
ROSTER_URL = BASE + "/roster/{slug}/"
DELAY = 1.5


def http_get(url, *, binary=False, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
    return data if binary else data.decode("utf-8", errors="replace")


def find_cutout(html):
    m = re.search(r'<img\s+[^>]*class="[^"]*fighter-cutout[^"]*"[^>]*src="([^"]+)"', html, re.I)
    if not m:
        m = re.search(r'<img\s+[^>]*src="([^"]+)"[^>]*class="[^"]*fighter-cutout[^"]*"', html, re.I)
    return m.group(1) if m else None


def scrape_one(slug, url_slug=None):
    page_url = ROSTER_URL.format(slug=url_slug or slug)
    try:
        html = http_get(page_url)
    except Exception as e:
        return False, f"page fetch failed: {e}"

    img_url = find_cutout(html)
    if not img_url:
        return False, "no fighter-cutout img on page"

    try:
        data = http_get(img_url, binary=True)
    except Exception as e:
        return False, f"image fetch failed: {e}"

    ext = img_url.rsplit(".", 1)[-1].lower().split("?")[0]
    if ext not in ("png", "jpg", "jpeg", "webp"):
        ext = "png"
    out_img = REVIEW_DIR / f"{slug}.{ext}"
    out_img.write_bytes(data)
    out_src = REVIEW_DIR / f"{slug}.source.txt"
    out_src.write_text(
        f"source: {page_url}\n"
        f"image: {img_url}\n"
        f"scraper: tna-com\n"
    )
    return True, f"{out_img.relative_to(ROOT)} ({len(data)} bytes)"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("slugs", nargs="*")
    ap.add_argument("--from", dest="from_file")
    ap.add_argument("--aliases", help="JSON map of {our_slug: tna_url_slug}")
    args = ap.parse_args()

    slugs = list(args.slugs)
    if args.from_file:
        slugs.extend(json.loads(Path(args.from_file).read_text()))
    if not slugs:
        print("no slugs given", file=sys.stderr)
        sys.exit(2)

    aliases = json.loads(Path(args.aliases).read_text()) if args.aliases else {}

    print(f"Scraping {len(slugs)} slug(s) from TNA Wrestling...\n")
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
        report = REVIEW_DIR / "_tna_misses.txt"
        report.write_text("\n".join(f"{s}: {m}" for s, m in fail) + "\n")


if __name__ == "__main__":
    sys.exit(main() or 0)
