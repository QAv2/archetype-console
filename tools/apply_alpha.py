#!/usr/bin/env python3
"""Promote alpha-reframed PNGs to live photos/, removing stale .jpg/.webp.

For each images/photos-reframed/<slug>.png, this script:
  - deletes any images/photos/<slug>.{jpg,jpeg,webp} (so the .png is the only winner)
  - copies the PNG to images/photos/<slug>.png

Run after `tools/reframe_alpha.py` has produced the cropped PNGs.

Usage:
  /home/joseph/archetype-console/.venv/bin/python tools/apply_alpha.py [slug ...]
  /home/joseph/archetype-console/.venv/bin/python tools/apply_alpha.py --all
  /home/joseph/archetype-console/.venv/bin/python tools/apply_alpha.py --all --dry-run
"""
import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PHOTOS_DIR = ROOT / "images" / "photos"
REFRAME_DIR = ROOT / "images" / "photos-reframed"

STALE_EXTS = (".jpg", ".jpeg", ".webp")


def apply_one(slug, dry_run=False):
    src = REFRAME_DIR / f"{slug}.png"
    if not src.exists():
        return False, f"missing reframe: {src.relative_to(ROOT)}"
    removed = []
    # Stale in live photos/ (any older format being replaced by the new .png)
    for ext in STALE_EXTS:
        stale = PHOTOS_DIR / f"{slug}{ext}"
        if stale.exists():
            removed.append(stale.name)
            if not dry_run:
                stale.unlink()
    # Stale prior-round reframe in photos-reframed/ (the .jpg superseded by the new .png)
    for ext in STALE_EXTS:
        stale = REFRAME_DIR / f"{slug}{ext}"
        if stale.exists():
            removed.append(f"reframed/{stale.name}")
            if not dry_run:
                stale.unlink()
    dst = PHOTOS_DIR / f"{slug}.png"
    if not dry_run:
        shutil.copy2(src, dst)
    return True, f"applied{' (dry-run)' if dry_run else ''}, removed={removed or 'none'}"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("slugs", nargs="*")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    slugs = list(args.slugs)
    if args.all:
        slugs.extend(sorted(p.stem for p in REFRAME_DIR.glob("*.png")))
    slugs = list(dict.fromkeys(slugs))
    if not slugs:
        print("no slugs given", file=sys.stderr)
        sys.exit(2)

    print(f"Applying {len(slugs)} alpha PNG(s)\n")
    ok = fail = 0
    for i, slug in enumerate(slugs, 1):
        success, msg = apply_one(slug, dry_run=args.dry_run)
        prefix = "[OK  ]" if success else "[FAIL]"
        print(f"{prefix} {slug:<28} {msg}")
        if success:
            ok += 1
        else:
            fail += 1
    print(f"\nDone. ok={ok} fail={fail}")


if __name__ == "__main__":
    sys.exit(main() or 0)
