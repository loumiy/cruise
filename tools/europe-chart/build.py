#!/usr/bin/env python3
# Builds the Europe chart data: region, ports and sea lanes. Lanes are generated from the waypoints:
# every clear straight run between nearby points becomes a lane, then lanes with a near-straight detour
# through another waypoint are dropped, so the chart keeps a sparse net.
import json, math, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from geo import LAND, WATER, PORTS, NODES, MANUAL, MANUAL_ONLY

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'data')

def pip(pt, poly):
    x, y = pt; c = False; j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]; xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: c = not c
        j = i
    return c

def on_land(pt):
    if any(pip(pt, w) for w in WATER.values()): return False
    return any(pip(pt, p) for p in LAND.values())

def nm(a, b):
    R = 3440.065; r = math.pi / 180
    dlat = (b[1] - a[1]) * r; dlon = (b[0] - a[0]) * r
    h = math.sin(dlat / 2) ** 2 + math.cos(a[1] * r) * math.cos(b[1] * r) * math.sin(dlon / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))

pts = {k: (v[2], v[3]) for k, v in PORTS.items()}
pts.update(NODES)

def clear(a, b, port_a, port_b):
    pa, pb = pts[a], pts[b]
    d = nm(pa, pb); n = max(40, int(d / 0.5))
    skip = 7.0 / d if d > 0 else 0
    for k in range(1, n):
        f = k / n
        if port_a and f < skip: continue
        if port_b and f > 1 - skip: continue
        p = (pa[0] + (pb[0] - pa[0]) * f, pa[1] + (pb[1] - pa[1]) * f)
        if on_land(p): return False
    return True

bad = [k for k, p in NODES.items() if on_land(p)]
if bad: print('NODES ON LAND', bad)

ids = [k for k in pts if k not in MANUAL_ONLY]
cand = {}
for i, a in enumerate(ids):
    for b in ids[i + 1:]:
        d = nm(pts[a], pts[b])
        lim = 260 if (a in PORTS and b in PORTS) else 420
        if d > lim: continue
        if clear(a, b, a in PORTS, b in PORTS): cand[(a, b)] = d

adj = {}
for (a, b), d in cand.items():
    adj.setdefault(a, {})[b] = d; adj.setdefault(b, {})[a] = d
for e in MANUAL:
    a, b = e[0], e[1]
    adj.setdefault(a, {})[b] = 1; adj.setdefault(b, {})[a] = 1

# Prune: drop a lane when two other lanes via a waypoint (not a port) cover it within 4%.
SLACK = 1.04
for (a, b), d in sorted(cand.items(), key=lambda kv: -kv[1]):
    if b not in adj.get(a, {}): continue
    for k in list(adj[a].keys()):
        if k == b or k in PORTS: continue
        if b in adj.get(k, {}) and adj[a][k] + adj[k][b] <= SLACK * d:
            del adj[a][b]; del adj[b][a]; break

edges, seen = [], set()
for (a, b), d in cand.items():
    if b in adj.get(a, {}) and (a, b) not in seen:
        seen.add((a, b)); edges.append([a, b])
edges += MANUAL

# Every port reachable
for k in PORTS:
    if not any(k in e[:2] for e in edges): print('UNREACHABLE', k)
print(len(edges), 'edges,', len(NODES), 'nodes,', len(PORTS), 'ports')

ports = {}
for k, (name, country, lon, lat, area, appeal, tags, extra) in PORTS.items():
    p = {'name': name, 'country': country, 'lon': lon, 'lat': lat, 'area': area, 'appeal': appeal, 'tags': tags, 'berth': extra.pop('berth', 'pier')}
    label = extra.pop('label')
    p.update(extra); p['label'] = label
    ports[k] = p
    extra['label'] = label
json.dump(ports, open(ROOT + '/ports/europe.json', 'w'), indent=1, ensure_ascii=False)

lanes = {'edges': edges, 'canals': {'kiel': {'label': [9.5, 54.1, -6, -8, 'end']}}}
json.dump(lanes, open(ROOT + '/lanes/europe.json', 'w'), indent=1, ensure_ascii=False)

region = json.load(open(os.path.join(os.path.dirname(__file__), 'region.json')))
region['land'] = {k: [list(p) for p in v] for k, v in LAND.items()}
region['water'] = {k: [list(p) for p in v] for k, v in WATER.items()}
region['nodes'] = {k: list(v) for k, v in NODES.items()}
json.dump(region, open(ROOT + '/regions/europe.json', 'w'), indent=1, ensure_ascii=False)
