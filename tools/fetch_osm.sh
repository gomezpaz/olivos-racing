#!/bin/bash
# Fetch OSM data for the Olivos play area from Overpass API.
set -e
BBOX="-34.520,-58.494,-34.503,-58.472"
API="https://overpass-api.de/api/interpreter"
curl -s --max-time 60 "$API" --data-urlencode "data=[out:json][timeout:25];(way[\"highway\"](${BBOX}););out geom tags;" > /tmp/olivos_roads.json
curl -s --max-time 60 "$API" --data-urlencode "data=[out:json][timeout:25];(way[\"building\"](${BBOX}););out geom;" > /tmp/olivos_buildings.json
echo "roads: $(python3 -c "import json;print(len(json.load(open('/tmp/olivos_roads.json'))['elements']))")"
echo "buildings: $(python3 -c "import json;print(len(json.load(open('/tmp/olivos_buildings.json'))['elements']))")"
