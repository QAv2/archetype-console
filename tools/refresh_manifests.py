#!/usr/bin/env python3
"""Scan images/photos and images/archetypes, write manifest.json for each.

The browser fetches these manifests at boot to learn which photo files actually
exist; nodes whose photo_url is in the manifest get the real image, others fall
back to the tier/tradition icon.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXTS = {".jpg", ".jpeg", ".png", ".webp", ".svg", ".gif"}


def write_manifest(folder: Path) -> int:
    files = sorted(
        f.name for f in folder.iterdir()
        if f.is_file() and f.suffix.lower() in EXTS and f.name != "manifest.json"
    )
    (folder / "manifest.json").write_text(json.dumps(files, indent=2) + "\n")
    return len(files)


for sub in ("photos", "archetypes"):
    folder = ROOT / "images" / sub
    if not folder.exists():
        continue
    n = write_manifest(folder)
    print(f"images/{sub}/manifest.json: {n} files")
