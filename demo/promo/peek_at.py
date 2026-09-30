"""Print the promo frame nearest a beat, as text: python demo/promo/peek_at.py 25 34.4"""
import glob
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent / "out" / "frames" / "promo"
frames = [json.loads(f.read_text(encoding="utf-8")) for f in sorted(root.glob("*.json"))]
sys.stdout.reconfigure(encoding="utf-8")
for a in map(float, sys.argv[1:]):
    d = min(frames, key=lambda x: abs(x["at"] - a))
    print(f"=== at {d['at']:.2f}  {d['cols']}x{d['rows']}")
    for line in d["lines"]:
        print("".join(s["t"] for s in line).rstrip()[:150])
