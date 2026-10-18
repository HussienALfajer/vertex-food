// A battery model for the sampling and upload policy (modelled, not measured: the emulator has no real battery).
// What costs energy on a driver's phone with the screen off:
// - the radio: every upload wakes it, and it stays in a high-power state for a "tail" after the last byte;
//   for small batches the tail, not the bytes, is the cost;
// - the GNSS receiver while the fused provider asks for high accuracy, less in balanced mode;
// - CPU wake-ups for each location callback (small next to the two above, left out).
// Radio figures are from published measurements of older phones (cited in docs/spikes/C-driver-location.md);
// GNSS power is a low-to-high range because cheap phones vary. The point of the model is the ratio between
// policies; absolute drain must be measured on the pilot's phones (owner test).

export const RADIO = {
  // Huang et al., MobiSys 2012 (LTE): promotion 0.26 s, tail 11.6 s at about 1.06 W.
  lte: { promoS: 0.26, promoW: 1.2, tailS: 11.6, tailW: 1.06 },
  // Qian et al., IMC 2010 (3G/UMTS): promotion about 2 s; DCH tail 5 s at about 0.8 W, then FACH 12 s at 0.46 W.
  '3g': { promoS: 2.0, promoW: 0.6, tailS: 17, tailW: (5 * 0.8 + 12 * 0.46) / 17 },
};
export const GNSS_W = { high: [0.15, 0.35], balanced: [0.03, 0.08] };
export const BATTERY_J = 5000e-3 * 3.85 * 3600; // a 5000 mAh phone at 3.85 V, about 69 kJ

// Joules per hour of radio for uploads every `intervalS` seconds (the radio stays up when the tail outlasts the gap).
export function radioJPerHour(intervalS, net) {
  const r = RADIO[net];
  const uploads = 3600 / intervalS;
  const busyS = Math.min(intervalS, r.promoS + r.tailS);
  const w = (r.promoS * r.promoW + (busyS - r.promoS) * r.tailW) / busyS;
  return uploads * busyS * w;
}

export function model() {
  const rows = [];
  const pct = (j) => Math.round((j / BATTERY_J) * 1000) / 10;
  const policies = [
    { name: 'active job, send every fix (15 s)', interval: 15, gnss: 'high' },
    { name: 'active job, batch every 30 s (recommended)', interval: 30, gnss: 'high' },
    { name: 'active job, batch every 120 s', interval: 120, gnss: 'high' },
    { name: 'on duty, no job, batch every 120 s (recommended)', interval: 120, gnss: 'balanced' },
  ];
  for (const p of policies) {
    for (const net of ['3g', 'lte']) {
      const radio = radioJPerHour(p.interval, net);
      const [glo, ghi] = GNSS_W[p.gnss].map((w) => w * 3600);
      rows.push({ policy: p.name, net, uploadsPerHour: 3600 / p.interval, radioJ: Math.round(radio), gnssJ: [glo, ghi], batteryPctPerHour: [pct(radio + glo), pct(radio + ghi)] });
    }
  }
  // A 10-hour shift: 5 hours with an active job, 5 hours waiting, on 3G.
  const shift = (activeInterval) => {
    const lo = 5 * (radioJPerHour(activeInterval, '3g') + GNSS_W.high[0] * 3600) + 5 * (radioJPerHour(120, '3g') + GNSS_W.balanced[0] * 3600);
    const hi = 5 * (radioJPerHour(activeInterval, '3g') + GNSS_W.high[1] * 3600) + 5 * (radioJPerHour(120, '3g') + GNSS_W.balanced[1] * 3600);
    return [pct(lo), pct(hi)];
  };
  return { rows, shift10h: { everyFix: shift(15), batch30: shift(30), batch120: shift(120) } };
}
