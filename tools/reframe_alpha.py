#!/usr/bin/env python3
"""Reframe RGBA PNG portraits to square crops while preserving alpha.

Used for sources like WWE.com talent portraits that ship with isolated
backgrounds. We want the alpha channel to survive into the final image so
the subject free-floats against the console's dark UI (apophis pattern).

Workflow:
  - Read photos-review/<slug>.png (RGBA expected)
  - Run face detection on the RGB channel
  - Square crop centered on face
  - Save photos-reframed/<slug>.png with alpha preserved

Usage:
  /home/joseph/archetype-console/.venv/bin/python tools/reframe_alpha.py [slug ...]
  /home/joseph/archetype-console/.venv/bin/python tools/reframe_alpha.py --all  # every PNG in photos-review/
"""
import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
REVIEW_DIR = ROOT / "images" / "photos-review"
REFRAME_DIR = ROOT / "images" / "photos-reframed"
REFRAME_DIR.mkdir(parents=True, exist_ok=True)

CASCADE = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
PROFILE = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_profileface.xml")

TARGET = 600          # output square size (larger than reframe_photos.py since alpha is cheap)
PAD_RATIO = 1.85
FACE_Y_BIAS = 0.50    # centered face — Joe's preference after Rhea round 4


def detect_face(rgb_img):
    gray = cv2.cvtColor(rgb_img, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)
    img_h, img_w = gray.shape

    # Wrestler portraits always have the head in the upper portion. The Haar
    # cascade is happy to find "faces" in skin-toned chest regions or muscle
    # contours — reject any candidate whose center sits below 50% of image
    # height. Also reject tiny detections, which are usually buttons/logos.
    def upper_half(faces):
        if not len(faces):
            return []
        min_dim = max(40, img_h // 12)
        return [f for f in faces
                if (f[1] + f[3] // 2) / img_h < 0.50
                and max(f[2], f[3]) >= min_dim]

    fr = upper_half(CASCADE.detectMultiScale(gray, 1.15, 5, minSize=(40, 40)))
    if not fr:
        fr = upper_half(PROFILE.detectMultiScale(gray, 1.15, 5, minSize=(40, 40)))
    if not fr:
        flipped = cv2.flip(gray, 1)
        fp = PROFILE.detectMultiScale(flipped, 1.15, 5, minSize=(40, 40))
        mirrored = [(img_w - x - w, y, w, h) for (x, y, w, h) in fp]
        fr = upper_half(mirrored)

    if not fr:
        return None
    fr = sorted(fr, key=lambda f: f[2] * f[3], reverse=True)
    x, y, w, h = fr[0]
    return x + w // 2, y + h // 2, max(w, h)


def square_crop(img, face):
    """Return a square crop preserving all channels (RGB or RGBA)."""
    h, w = img.shape[:2]
    if face:
        cx, cy, face_size = face
        crop_size = int(face_size * PAD_RATIO)
        crop_size = max(crop_size, min(w, h) // 2)
        crop_size = min(crop_size, min(w, h))
        x0 = cx - crop_size // 2
        y0 = cy - int(crop_size * FACE_Y_BIAS)
    else:
        crop_size = min(w, h)
        x0 = (w - crop_size) // 2
        y0 = int(h * 0.05)

    x0 = max(0, min(x0, w - crop_size))
    y0 = max(0, min(y0, h - crop_size))
    return img[y0:y0 + crop_size, x0:x0 + crop_size]


def reframe_one(slug):
    # Prefer PNG (likely RGBA from WWE/TNA scrapers), fall back to JPG
    # (Commons scraper output — no alpha, but face-detect + crop still apply).
    src = None
    for ext in (".png", ".jpg", ".jpeg", ".webp"):
        candidate = REVIEW_DIR / f"{slug}{ext}"
        if candidate.exists():
            src = candidate
            break
    if not src:
        return False, f"source not found: photos-review/{slug}.{{png,jpg,jpeg,webp}}"

    img = cv2.imread(str(src), cv2.IMREAD_UNCHANGED)
    if img is None:
        return False, "imread failed"

    has_alpha = img.ndim == 3 and img.shape[2] == 4
    rgb_for_detect = img[:, :, :3] if has_alpha else img

    face = detect_face(rgb_for_detect)
    method = "face-detected" if face else "centered fallback"

    cropped = square_crop(img, face)
    cropped = cv2.resize(cropped, (TARGET, TARGET), interpolation=cv2.INTER_LANCZOS4)

    out = REFRAME_DIR / f"{slug}.png"
    # cv2.imwrite preserves alpha when input has 4 channels
    cv2.imwrite(str(out), cropped, [cv2.IMWRITE_PNG_COMPRESSION, 6])
    return True, f"{out.relative_to(ROOT)} ({method}, alpha={'yes' if has_alpha else 'no'})"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("slugs", nargs="*")
    ap.add_argument("--all", action="store_true", help="reframe every PNG in photos-review/")
    args = ap.parse_args()

    slugs = list(args.slugs)
    if args.all:
        # Pick up any image in photos-review/, regardless of extension
        for ext in ("*.png", "*.jpg", "*.jpeg", "*.webp"):
            slugs.extend(sorted(p.stem for p in REVIEW_DIR.glob(ext)))
    slugs = list(dict.fromkeys(slugs))  # dedup, preserve order

    if not slugs:
        print("no slugs given. pass on cli or use --all", file=sys.stderr)
        sys.exit(2)

    print(f"Reframing {len(slugs)} slug(s) (alpha-preserving)\n")
    ok = fail = 0
    for i, slug in enumerate(slugs, 1):
        print(f"[{i:>2}/{len(slugs)}] {slug:<28}", end=" ", flush=True)
        success, msg = reframe_one(slug)
        if success:
            ok += 1
            print(f"OK   {msg}")
        else:
            fail += 1
            print(f"FAIL {msg}")

    print(f"\nDone. ok={ok}  fail={fail}")
    print(f"Output: {REFRAME_DIR.relative_to(ROOT)}/<slug>.png")


if __name__ == "__main__":
    sys.exit(main() or 0)
