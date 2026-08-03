import { buildSharan } from './sharan2006.js';

// Car registry — add new cars here. Locked entries show as "coming soon" in the UI.
export const CARS = [
  {
    id: 'sharan-2006',
    name: 'Volkswagen Sharan 1.8T',
    year: 2006,
    tagline: 'La familiar gris. Indestructible.',
    color: '#9a9da0',
    locked: false,
    physics: {
      topSpeed: 51.5,     // m/s (~185 km/h)
      accel: 6.2,         // m/s^2 engine accel at low speed
      brake: 11.5,
      reverseSpeed: 8,
      grip: 7.5,          // lateral velocity kill rate (1/s)
      driftGrip: 2.2,     // grip while handbraking
      steerMax: 0.62,     // rad at standstill
      steerHighSpeed: 0.09,
      steerSpeed: 3.2,
    },
    stats: { speed: 0.55, accel: 0.45, handling: 0.6 },
    build: (opts) => buildSharan(opts),
  },
  { id: 'locked-1', name: '???', tagline: 'Próximamente', locked: true },
  { id: 'locked-2', name: '???', tagline: 'Próximamente', locked: true },
];

export function getCar(id) {
  return CARS.find((c) => c.id === id && !c.locked) || CARS[0];
}
