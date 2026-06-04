// run once: node scripts/generate_hyperplanes.js
const crypto = require('crypto');

const BANDS = 4;
const PLANES_PER_BAND = 6;
const DIMS = 128;

const hyperplanes = [];
for (let b = 0; b < BANDS; b++) {
  const band = [];
  for (let p = 0; p < PLANES_PER_BAND; p++) {
    // Sample from standard normal distribution using Box-Muller
    const raw = [];
    for (let d = 0; d < DIMS; d++) {
      const u1 = crypto.randomBytes(4).readUInt32BE(0) / 0xFFFFFFFF;
      const u2 = crypto.randomBytes(4).readUInt32BE(0) / 0xFFFFFFFF;
      raw.push(Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2));
    }
    // L2-normalise to unit vector
    const norm = Math.sqrt(raw.reduce((s, x) => s + x * x, 0));
    band.push(raw.map(x => x / norm));
  }
  hyperplanes.push(band);
}

console.log(JSON.stringify(hyperplanes, null, 2));
