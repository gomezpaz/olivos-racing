#!/usr/bin/env python3
"""Bake OSM data (roads, buildings, race circuit) into client/src/data/olivos.json.

Inputs are Overpass API JSON dumps (see tools/fetch_osm.sh). The race circuit is
stitched from named streets: for each leg we collect every point of every OSM way
with that name, sort them along the street's principal axis (these streets are
straight enough for that), clip between the corner intersections, then merge dual
carriageways into a centerline and resample/smooth it.

Usage: python3 tools/bake_map.py <roads.json> <buildings.json> <out.json>
"""
import json, math, sys

# Circuit legs around the Quinta de Olivos, in driving order.
# Each leg: (street name regex-ish exact match set, next street for the corner)
CIRCUIT_STREETS = ["Avenida del Libertador", "Antonio Malaver", "Avenida Maipú", "Corrientes"]
LAPS_DEFAULT = 3

def dist(a, b):
    # meters, equirectangular — fine at this scale
    kx = 111320 * math.cos(math.radians(-34.51))
    ky = 110574
    return math.hypot((a[1]-b[1])*kx, (a[0]-b[0])*ky)

def collect_points(ways, name):
    pts = []
    for w in ways:
        if w.get('tags', {}).get('name') == name and 'geometry' in w:
            for g in w['geometry']:
                pts.append((g['lat'], g['lon']))
    return pts

def principal_sort(pts):
    # farthest pair approximation via lat/lon extremes
    cands = [min(pts), max(pts), min(pts, key=lambda p: p[1]), max(pts, key=lambda p: p[1])]
    best = max(((a, b) for a in cands for b in cands), key=lambda ab: dist(*ab))
    a, b = best
    kx = 111320 * math.cos(math.radians(-34.51)); ky = 110574
    ax, ay = (b[1]-a[1])*kx, (b[0]-a[0])*ky
    n = math.hypot(ax, ay)
    ax, ay = ax/n, ay/n
    def t(p): return ((p[1]-a[1])*kx*ax + (p[0]-a[0])*ky*ay)
    return sorted(set(pts), key=t), t

def closest_pair(pa, pb):
    return min(((a, b) for a in pa for b in pb), key=lambda ab: dist(*ab))

def stitch_circuit(ways):
    streets = {n: collect_points(ways, n) for n in CIRCUIT_STREETS}
    for n, p in streets.items():
        if len(p) < 4:
            raise SystemExit(f"street '{n}' has too few points ({len(p)})")
    loop = []
    k = len(CIRCUIT_STREETS)
    for i, name in enumerate(CIRCUIT_STREETS):
        prev_name = CIRCUIT_STREETS[(i-1) % k]
        next_name = CIRCUIT_STREETS[(i+1) % k]
        pts, t = principal_sort(streets[name])
        c_in, _ = closest_pair(pts, streets[prev_name])
        c_out, _ = closest_pair(pts, streets[next_name])
        t0, t1 = t(c_in), t(c_out)
        lo, hi = min(t0, t1), max(t0, t1)
        leg = [p for p in pts if lo - 5 <= t(p) <= hi + 5]
        if t0 > t1:
            leg.reverse()
        # merge dual carriageways: average points that sit within 12m along-axis
        merged = []
        for p in leg:
            if merged and dist(merged[-1][0], p) < 12:
                grp = merged[-1]; grp.append(p)
            else:
                merged.append([p])
        leg = [(sum(q[0] for q in g)/len(g), sum(q[1] for q in g)/len(g)) for g in merged]
        loop.extend(leg)
    return resample_smooth(loop, step=8.0, passes=3)

def resample_smooth(loop, step, passes):
    # close the loop, resample at fixed step, then moving-average smooth
    pts = loop + [loop[0]]
    out = [pts[0]]
    carry = 0.0
    for a, b in zip(pts, pts[1:]):
        d = dist(a, b)
        if d < 0.01: continue
        pos = carry
        while pos + step <= d:
            pos += step
            f = pos / d
            out.append((a[0] + (b[0]-a[0])*f, a[1] + (b[1]-a[1])*f))
        carry = pos - d
    for _ in range(passes):
        n = len(out)
        out = [((out[(i-1) % n][0] + out[i][0]*2 + out[(i+1) % n][0]) / 4,
                (out[(i-1) % n][1] + out[i][1]*2 + out[(i+1) % n][1]) / 4) for i in range(n)]
    return out

def main(roads_path, buildings_path, out_path):
    roads_raw = json.load(open(roads_path))['elements']
    buildings_raw = json.load(open(buildings_path))['elements']

    circuit = stitch_circuit(roads_raw)
    lat0 = sum(p[0] for p in circuit)/len(circuit)
    lon0 = sum(p[1] for p in circuit)/len(circuit)

    roads = []
    for w in roads_raw:
        tags = w.get('tags', {})
        if 'geometry' not in w: continue
        hw = tags.get('highway', 'residential')
        width = {'primary': 14, 'secondary': 12, 'tertiary': 9}.get(hw, 6.5)
        roads.append({
            'n': tags.get('name', ''), 'w': width,
            'p': [[round(g['lat'], 6), round(g['lon'], 6)] for g in w['geometry']],
        })

    buildings = []
    for w in buildings_raw:
        if 'geometry' not in w or len(w['geometry']) < 4: continue
        tags = w.get('tags', {})
        try:
            h = float(str(tags.get('height', '')).replace('m', '').strip())
        except ValueError:
            lv = tags.get('building:levels')
            h = float(lv) * 3.1 if lv and lv.replace('.', '').isdigit() else 6.0
        buildings.append({'h': round(h, 1),
                          'p': [[round(g['lat'], 6), round(g['lon'], 6)] for g in w['geometry']]})

    total = sum(dist(a, b) for a, b in zip(circuit, circuit[1:] + [circuit[0]]))
    data = {
        'origin': {'lat': round(lat0, 7), 'lon': round(lon0, 7)},
        'tracks': [{
            'id': 'quinta-de-olivos',
            'name': 'Circuito Quinta de Olivos',
            'location': 'Olivos, Vicente López, Buenos Aires',
            'laps': LAPS_DEFAULT,
            'lengthM': round(total),
            'path': [[round(p[0], 7), round(p[1], 7)] for p in circuit],
        }],
        'roads': roads,
        'buildings': buildings,
    }
    with open(out_path, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    print(f"circuit: {len(circuit)} pts, {total:.0f} m | roads: {len(roads)} | buildings: {len(buildings)}")
    print(f"origin: {lat0:.6f},{lon0:.6f} -> {out_path}")

if __name__ == '__main__':
    main(*sys.argv[1:4])
