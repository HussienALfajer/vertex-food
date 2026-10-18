// Compact location batches. A point is [fix time, lat, lng, accuracy m, speed dm/s, heading deg, callback wall,
// callback mono]. Times are deltas in ms from the previous point; lat and lng are integers of 1e-5 degree
// (about 1.1 m) as deltas from the previous point. The run id is per batch: a batch never mixes runs.

const E5 = 1e5;

export function encodePoints(run, points) {
  const d = [];
  let p = [0, 0, 0, 0, 0];
  for (const x of points) {
    const lat = Math.round(x.lat * E5);
    const lng = Math.round(x.lng * E5);
    d.push([
      x.t - p[0],
      lat - p[1],
      lng - p[2],
      Math.round(x.acc ?? 0),
      Math.round((x.speed ?? 0) * 10),
      Math.round(x.heading ?? 0),
      x.cbWall - p[3],
      x.cbMono - p[4],
    ]);
    p = [x.t, lat, lng, x.cbWall, x.cbMono];
  }
  return { run, d };
}

export function decodePoints(batch) {
  const out = [];
  let p = [0, 0, 0, 0, 0];
  for (const r of batch.d) {
    const t = p[0] + r[0];
    const lat = p[1] + r[1];
    const lng = p[2] + r[2];
    const cbWall = p[3] + r[6];
    const cbMono = p[4] + r[7];
    out.push({ t, lat: lat / E5, lng: lng / E5, acc: r[3], speed: r[4] / 10, heading: r[5], cbWall, cbMono, run: batch.run });
    p = [t, lat, lng, cbWall, cbMono];
  }
  return out;
}
