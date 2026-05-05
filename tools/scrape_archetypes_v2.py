#!/usr/bin/env python3
"""Second-pass archetype scraper. Smarter strategies than v1:

  1. Generates candidates: full name, each proper noun, with mythology suffix
  2. Falls back to the article's images list when there's no designated pageimage
     (Tyr's article has plenty of images but no pageimage thumbnail set)
  3. Filters out icons, logos, generic Commons assets when picking from the list
  4. Prefers images whose filename mentions the archetype name

Only runs against archetypes still missing after v1.
"""
import argparse
import io
import json
import re
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
API_URL = "https://en.wikipedia.org/w/api.php"

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

JUNK_PATTERNS = re.compile(
    r"(commons-logo|wikiquote|wiktionary|edit-ltr|symbol[-_ ]category|"
    r"oo[-_ ]?ui|category[-_ ]class|disambig|ambox|stub-icon|question_book|"
    r"wikidata-logo|wikisource-logo|wikipedia-logo|vector-toolbar)",
    re.I,
)

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
        "action": "query", "format": "json", "titles": title,
        "prop": "pageimages|extracts", "pithumbsize": THUMB_SIZE,
        "exintro": 1, "explaintext": 1, "exchars": 200, "redirects": 1,
    }
    r = session.get(API_URL, params=params, timeout=15)
    r.raise_for_status()
    pages = r.json().get("query", {}).get("pages", {})
    for page in pages.values():
        if "missing" in page:
            return None, None, None, False
        thumb = page.get("thumbnail", {}).get("source")
        if thumb:
            return thumb, page.get("title"), page.get("extract", ""), True
        # Article exists, no pageimage
        return None, page.get("title"), page.get("extract", ""), True
    return None, None, None, False


def list_article_images(title: str, target_words: set):
    """Return URL of the best non-junk image on the article, ranked by filename
    mentioning the article subject."""
    params = {
        "action": "query", "format": "json", "titles": title,
        "prop": "images", "imlimit": 30, "redirects": 1,
    }
    r = session.get(API_URL, params=params, timeout=15)
    r.raise_for_status()
    pages = r.json().get("query", {}).get("pages", {})
    for page in pages.values():
        candidates = []
        for img in page.get("images", []):
            name = img["title"]
            if JUNK_PATTERNS.search(name):
                continue
            if name.lower().endswith(".svg"):
                continue
            candidates.append(name)
        if not candidates:
            continue

        # Score: more matches with target words = higher score
        def score(filename):
            name_words = set(re.findall(r"\w+", filename.lower()))
            return len(target_words & name_words)

        candidates.sort(key=score, reverse=True)

        for best in candidates[:2]:
            time.sleep(RATE_LIMIT_SEC)
            url = _file_thumb_url(best)
            if url:
                return url, best
    return None, None


def _file_thumb_url(file_title: str):
    params = {
        "action": "query", "format": "json", "titles": file_title,
        "prop": "imageinfo", "iiprop": "url|size", "iiurlwidth": THUMB_SIZE,
    }
    r = session.get(API_URL, params=params, timeout=15)
    r.raise_for_status()
    pages = r.json().get("query", {}).get("pages", {})
    for p in pages.values():
        info = p.get("imageinfo", [{}])
        if info:
            return info[0].get("thumburl") or info[0].get("url")
    return None


def fetch_and_save(image_url: str, slug: str, source_title: str, extract: str):
    r = session.get(image_url, timeout=30)
    r.raise_for_status()
    if len(r.content) < MIN_BYTES:
        return False, f"too small ({len(r.content)} bytes)"

    try:
        img = Image.open(io.BytesIO(r.content))
    except Exception as e:
        return False, f"PIL: {e}"

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


def query_candidates(name: str, tradition: str):
    """Generate ordered list of Wikipedia titles to try."""
    cands = [name]

    # Tokenize on hyphens, spaces, slashes, plus
    tokens = re.split(r"[-\s/+]", name)
    proper = [t for t in tokens if t and t[0].isupper() and len(t) > 2]

    # Prefer longer proper nouns first (more likely to be the actual figure)
    proper.sort(key=len, reverse=True)
    for p in proper:
        if p not in cands:
            cands.append(p)

    # With tradition disambiguation
    qual = TRADITION_QUALIFIERS.get(tradition)
    if qual:
        for p in proper[:2]:
            cands.append(f"{p} ({qual})")

    return cands[:6]


def process_one(slug: str, archetype: dict):
    name = archetype["name"]
    tradition = archetype.get("tradition", "")
    candidates = query_candidates(name, tradition)
    target_words = set(re.findall(r"\w+", name.lower())) | {tradition.lower()}

    try:
        for q in candidates:
            url, resolved, extract, exists = query_pageimage(q)
            if url:
                time.sleep(RATE_LIMIT_SEC)
                return fetch_and_save(url, slug, resolved or q, extract)
            if exists:
                # Article exists but no pageimage — scrape image list
                time.sleep(RATE_LIMIT_SEC)
                url2, file_title = list_article_images(resolved or q, target_words)
                if url2:
                    time.sleep(RATE_LIMIT_SEC)
                    return fetch_and_save(url2, slug, resolved or q, extract or "")
            time.sleep(RATE_LIMIT_SEC)

        return False, "no match across candidates"
    except requests.HTTPError as e:
        return False, f"http {e.response.status_code}"
    except requests.RequestException as e:
        return False, f"network: {e}"
    except Exception as e:
        return False, f"error: {e}"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--tradition", type=str, default="")
    args = ap.parse_args()

    archetypes = json.loads(ARCHETYPES_FILE.read_text())

    # Only process named-tradition archetypes still missing
    candidates = []
    for slug, arch in archetypes.items():
        trad = arch.get("tradition", "")
        if args.tradition and trad != args.tradition:
            continue
        if trad not in NAMED_TRADITIONS:
            continue
        if already_have(slug):
            continue
        candidates.append((slug, arch))

    if args.limit > 0:
        candidates = candidates[: args.limit]

    found = 0
    misses = []

    for i, (slug, arch) in enumerate(candidates, 1):
        prefix = f"[{i:>3}/{len(candidates)}] {arch['name']:<35} ({arch.get('tradition','')})"
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
        report = REVIEW_DIR / "_misses_v2.txt"
        report.write_text("\n".join(misses) + "\n")

    print(f"\nDone. found={found}  missed={len(misses)}")


if __name__ == "__main__":
    sys.exit(main() or 0)
