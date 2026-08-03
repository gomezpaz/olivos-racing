# 🏁 Olivos GP

Multiplayer street racing in **Olivos, Vicente López, Buenos Aires** — race a 2006 VW Sharan
around the Quinta de Olivos on real streets, with friends, in the browser.

- **Track**: Circuito Quinta de Olivos (3.35 km) — Av. del Libertador → Antonio Malaver → Av. Maipú → Corrientes, stitched from real OpenStreetMap geometry.
- **Multiplayer**: share the room link, friends join instantly (WebSocket).
- **Two render modes**:
  - **Photorealistic** — Google Maps Photorealistic 3D Tiles (real Google Earth imagery of Olivos). Needs an API key.
  - **OSM fallback** — real street network + extruded buildings, no key needed.

## Run locally

```bash
npm install
npm run build
GOOGLE_MAPS_API_KEY=your_key npm start   # key optional
# open http://localhost:8080
```

## Google Maps API key (photorealistic mode)

1. [Google Cloud Console](https://console.cloud.google.com/) → create/select a project.
2. Enable **Map Tiles API**.
3. Create an API key (restrict it to Map Tiles API + your domain).
4. Provide it either as the `GOOGLE_MAPS_API_KEY` env var on the server, or visit
   `https://your-host/?key=YOUR_KEY` once (stored in the browser).

Free tier: photorealistic tiles are ~$0 for casual use (root tile requests are billed;
a play session uses one session token).

## Deploy (share a link)

Any Node host with WebSocket support works. One-click-ish on [Render](https://render.com):
this repo includes `render.yaml` — "New → Blueprint" → point it at this repo. Set
`GOOGLE_MAPS_API_KEY` in the dashboard. Railway/Fly.io work the same way
(`npm run build` then `npm start`, port from `PORT`).

## Adding cars

Add an entry in `client/src/cars/index.js` (physics + stats) and a builder like
`client/src/cars/sharan2006.js` (procedural) or load a glTF. Unlock by setting `locked: false`.

## Adding tracks

1. Edit `CIRCUIT_STREETS` in `tools/bake_map.py` (ordered street names forming a loop) and
   the Overpass bbox in `tools/fetch_osm.sh`.
2. Re-bake: `./tools/fetch_osm.sh && python3 tools/bake_map.py /tmp/olivos_roads.json /tmp/olivos_buildings.json client/src/data/olivos.json`
3. Tracks land in `mapData.tracks[]` — track selection UI reads from there.

## Controls

WASD / arrows drive · Space handbrake · R reset to track · C camera · 9/0 align tiles (photorealistic mode)
