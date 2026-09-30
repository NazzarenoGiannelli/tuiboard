"""Print a captured frame as text, to see what a scene did without rendering it.

    python demo/shots/peek.py <scene> [frame ...]
"""
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent / "out" / "frames" / sys.argv[1]
files = sorted(root.glob("*.json"))
want = [int(a) for a in sys.argv[2:]] or range(len(files))
for i in want:
    f = json.loads(files[i].read_text(encoding="utf-8"))
    print(f"--- frame {i} · {f['caption']!r} · hold {f['hold']}")
    for line in f["lines"]:
        print("".join(s["t"] for s in line).rstrip())
