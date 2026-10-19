"""Summarize opt-in captures after the first racing transition + five warmup seconds.
Usage: python3 scripts/performance/summarize.py CAPTURE_DIRECTORY
Raw evidence remains local; output is a compact, reproducible summary.
"""
import json
import math
from pathlib import Path
import sys


def distribution(values):
    values = sorted(values)
    if not values:
        return None
    return {"count": len(values), **{
        name: round(values[math.ceil(len(values) * p) - 1], 3)
        for name, p in [("p50", .5), ("p95", .95), ("p99", .99)]
    }, "max": round(values[-1], 3)}


def summarize(path):
    data = json.loads(path.read_text())
    racing = next((e["at"] for e in data["events"]
                   if e["kind"] == "phase" and e["detail"]["phase"] == "racing"), None)
    if racing is None and data['context']['phase'] != 'paused':
        return None
    start = 5000 if racing is None else racing + 5000
    frames = [f for f in data["frames"] if f[0] >= start and f[6] == 0 and f[1] > 0]
    events = [e for e in data["events"] if e["at"] >= start]
    render = [e["detail"] for e in events if e["kind"] == "render"]
    return {
        "file": path.name, "segment": "paused-render" if racing is None else "racing",
        "renderDiagnostics": data.get("renderDiagnostics"), "settings": data["context"]["settings"],
        "environment": data["environment"], "dropped": data["dropped"],
        "visibilityChanges": sum(e["kind"] == "visibility" for e in data["events"]),
        "warmupCutoffMs": start, "durationMs": data["durationMs"],
        "analyzedDurationMs": round(sum(f[1] for f in frames), 3),
        "frameMs": distribution([f[1] for f in frames]),
        "stalls": {str(n): sum(f[1] > n for f in frames) for n in [33, 50, 100]},
        "simulationMs": distribution([f[3] for f in frames]),
        "renderCpuMs": distribution([f[4] for f in frames]),
        "fixedSteps": distribution([f[2] for f in frames]),
        "eventDurationsMs": {kind: distribution([e["duration"] for e in events if e["kind"] == kind])
                             for kind in ["gpu", "longtask", "chunk-integration", "chunk-fetch-decode", "chunk-adopt"]},
        "renderDprChanges": sum(a["pixelRatio"] != b["pixelRatio"] for a, b in zip(render, render[1:])),
        "drawCalls": distribution([e["calls"] for e in render]),
        "triangles": distribution([e["triangles"] for e in render]),
        "renderDprRange": [min(e["pixelRatio"] for e in render), max(e["pixelRatio"] for e in render)] if render else None,
        "outliers": sorted(frames, key=lambda f: f[1], reverse=True)[:5],
    }


if __name__ == "__main__":
    results = [summarize(p) for p in sorted(Path(sys.argv[1]).glob("*.json"))]
    print(json.dumps([r for r in results if r is not None], indent=2))
