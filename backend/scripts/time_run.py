#!/usr/bin/env python3
"""Create a session, run the graph, stream SSE timing, print financials."""
from __future__ import annotations

import json
import sys
import time
import urllib.request

BASE = "http://localhost:8001"


def post(path: str, body: dict | None = None) -> dict:
    data = json.dumps(body or {}).encode()
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def get(path: str) -> dict:
    with urllib.request.urlopen(f"{BASE}{path}", timeout=30) as resp:
        return json.loads(resp.read())


def stream_run(session_id: str) -> list[dict]:
    import urllib.error

    url = f"{BASE}/sessions/{session_id}/stream"
    events: list[dict] = []
    t0 = time.perf_counter()
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            for raw in resp:
                line = raw.decode().strip()
                if not line.startswith("data:"):
                    continue
                payload = json.loads(line[5:].strip())
                payload["elapsed_s"] = round(time.perf_counter() - t0, 2)
                events.append(payload)
                print(f"  [{payload['elapsed_s']:6.2f}s] {payload['node']:20s} {payload['status']}")
                if payload.get("node") == "done":
                    break
    except urllib.error.HTTPError as exc:
        print(f"stream error: {exc}", file=sys.stderr)
    return events


def main() -> None:
    company = sys.argv[1] if len(sys.argv) > 1 else "Deepseek"
    objective = (
        sys.argv[2]
        if len(sys.argv) > 2
        else "Understand their product-led growth strategy before an enterprise expansion call"
    )

    print(f"Creating session for {company!r}...")
    t_start = time.perf_counter()
    session = post("/sessions", {
        "company_name": company,
        "company_url": "",
        "objective": objective,
    })
    session_id = session["session_id"]
    print(f"Session: {session_id}")

    post(f"/sessions/{session_id}/run", {})
    print("\nWorkflow events:")
    events = stream_run(session_id)
    total_s = round(time.perf_counter() - t_start, 2)

    detail = get(f"/sessions/{session_id}")
    report = detail.get("report") or {}
    financials = report.get("financials") or {}
    meta = report.get("meta") or {}

    print(f"\nTotal wall time: {total_s}s")
    print(f"Company type: {meta.get('company_type')}")
    print(f"Quality score: {meta.get('quality_score')}")
    print(f"\nFinancial snapshot ({len([k for k in financials if k != 'source'])} fields):")
    for key, val in sorted(financials.items()):
        if key == "source":
            continue
        display = ", ".join(val) if isinstance(val, list) else val
        print(f"  {key:16s} {display}")

    # Node timing summary
    if events:
        print("\nNode timing:")
        prev = 0.0
        for ev in events:
            delta = round(ev["elapsed_s"] - prev, 2)
            if ev["node"] != "done":
                print(f"  {ev['node']:20s} +{delta:5.2f}s  (cumulative {ev['elapsed_s']:5.2f}s)")
            prev = ev["elapsed_s"]


if __name__ == "__main__":
    main()
