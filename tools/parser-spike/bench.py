#!/usr/bin/env python3
"""
Benchmark runner: TS adapter vs Go parser, N iterations per fixture.

Captures wall-clock, peak RSS, CPU%, exit status. Produces structured JSON
results and a markdown table.

Usage:
    python3 tools/parser-spike/bench.py <fixture-path> [<fixture-path> ...]
        [--iterations 5] [--out tools/parser-spike/results.json]
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
TIME_BIN = "/usr/bin/time"

TIME_FORMAT = "wall=%e\trss_kb=%M\tcpu=%P\texit=%x"


def run_once(cmd):
    """Run cmd under /usr/bin/time -f, return parsed metrics."""
    proc = subprocess.run(
        [TIME_BIN, "-f", TIME_FORMAT] + cmd,
        capture_output=True,
        text=True,
        cwd=str(REPO_ROOT),
    )
    # /usr/bin/time writes to stderr; the last line is the format
    last_line = proc.stderr.strip().splitlines()[-1] if proc.stderr.strip() else ""
    metrics = {}
    for kv in last_line.split("\t"):
        if "=" in kv:
            k, v = kv.split("=", 1)
            metrics[k] = v
    if "wall" not in metrics:
        return None
    cpu_str = metrics.get("cpu", "0%")
    cpu_pct = float(cpu_str.rstrip("%")) if cpu_str else 0.0
    return {
        "wall_s": float(metrics["wall"]),
        "rss_kb": int(metrics["rss_kb"]),
        "cpu_pct": cpu_pct,
        "exit": int(metrics["exit"]),
    }


def stats(values):
    if not values:
        return {"mean": 0, "min": 0, "max": 0, "stdev": 0}
    n = len(values)
    mean = sum(values) / n
    var = sum((v - mean) ** 2 for v in values) / n
    return {
        "mean": round(mean, 3),
        "min": round(min(values), 3),
        "max": round(max(values), 3),
        "stdev": round(var ** 0.5, 3),
    }


def bench_fixture(fixture, iterations):
    fixture_path = Path(fixture).resolve()
    if not fixture_path.exists():
        print(f"  ! missing fixture: {fixture}", file=sys.stderr)
        return None
    size = fixture_path.stat().st_size
    with fixture_path.open("rb") as f:
        lines = sum(1 for _ in f)
    print(f"\n=== {fixture_path.name}  ({size/1024/1024:.2f} MB, {lines} lines) ===", file=sys.stderr)

    ts_cmd = [
        "bun", "run", "tools/parser-spike/ts-bench.ts",
        str(fixture_path), "/tmp/bundle-ts-bench.json",
    ]
    go_cmd = [
        "./tools/parser-spike/go-parser-bin",
        "-out=/tmp/bundle-go-bench.json",
        str(fixture_path),
    ]

    runs = {"ts": [], "go": []}
    for impl, cmd in [("ts", ts_cmd), ("go", go_cmd)]:
        for i in range(iterations):
            r = run_once(cmd)
            if r is None or r["exit"] != 0:
                print(f"  ! {impl} run {i+1} failed", file=sys.stderr)
                continue
            runs[impl].append(r)
            print(f"  {impl} run {i+1}: wall={r['wall_s']*1000:.1f}ms rss={r['rss_kb']/1024:.1f}MB cpu={r['cpu_pct']:.0f}%", file=sys.stderr)

    summary = {
        "fixture": str(fixture_path),
        "size_mb": round(size / 1024 / 1024, 3),
        "lines": lines,
        "iterations": iterations,
    }
    for impl in ["ts", "go"]:
        rs = runs[impl]
        summary[impl] = {
            "wall_ms": stats([r["wall_s"] * 1000 for r in rs]),
            "rss_mb": stats([r["rss_kb"] / 1024 for r in rs]),
            "cpu_pct": stats([r["cpu_pct"] for r in rs]),
            "n": len(rs),
        }

    if summary["ts"]["n"] and summary["go"]["n"]:
        summary["speedup_wall"] = round(
            summary["ts"]["wall_ms"]["mean"] / summary["go"]["wall_ms"]["mean"], 2
        )
        summary["rss_reduction"] = round(
            summary["ts"]["rss_mb"]["mean"] / summary["go"]["rss_mb"]["mean"], 2
        )
    return summary


def to_markdown(results):
    lines = []
    lines.append("| Fixture | Size | Lines | TS wall (mean ± σ) | Go wall (mean ± σ) | TS RSS | Go RSS | Speedup | RSS× lower |")
    lines.append("|---|---|---|---|---|---|---|---|---|")
    for r in results:
        if r is None:
            continue
        ts_w = r["ts"]["wall_ms"]
        go_w = r["go"]["wall_ms"]
        ts_r = r["ts"]["rss_mb"]
        go_r = r["go"]["rss_mb"]
        name = Path(r["fixture"]).name
        lines.append(
            f"| `{name}` | {r['size_mb']:.2f} MB | {r['lines']} "
            f"| {ts_w['mean']:.1f} ± {ts_w['stdev']:.1f} ms "
            f"| **{go_w['mean']:.1f} ± {go_w['stdev']:.1f} ms** "
            f"| {ts_r['mean']:.1f} MB "
            f"| **{go_r['mean']:.1f} MB** "
            f"| **{r['speedup_wall']:.2f}×** "
            f"| **{r['rss_reduction']:.2f}×** |"
        )
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("fixtures", nargs="+")
    ap.add_argument("--iterations", "-n", type=int, default=5)
    ap.add_argument("--out", default="tools/parser-spike/results.json")
    ap.add_argument("--md", default=None, help="optional markdown output path")
    args = ap.parse_args()

    results = []
    for f in args.fixtures:
        res = bench_fixture(f, args.iterations)
        if res:
            results.append(res)

    out_path = REPO_ROOT / args.out
    out_path.write_text(json.dumps(results, indent=2))
    print(f"\nresults written: {out_path}", file=sys.stderr)

    md = to_markdown(results)
    print("\n" + md)
    if args.md:
        (REPO_ROOT / args.md).write_text(md + "\n")
        print(f"\nmarkdown written: {args.md}", file=sys.stderr)


if __name__ == "__main__":
    main()
