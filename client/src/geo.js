// Local flat-earth projection around a track origin.
// World frame: +X = east, +Y = up, +Z = south (so north is -Z).
// Car yaw 0 faces +Z; forward = (sin(yaw), 0, cos(yaw)).
export function makeProjector(origin) {
  const kx = 111320 * Math.cos((origin.lat * Math.PI) / 180);
  const ky = 110574;
  return {
    origin,
    toWorld(lat, lon) {
      return { x: (lon - origin.lon) * kx, z: -(lat - origin.lat) * ky };
    },
    toLatLon(x, z) {
      return { lat: origin.lat - z / ky, lon: origin.lon + x / kx };
    },
  };
}
