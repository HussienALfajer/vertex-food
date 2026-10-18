// UUIDv7 from the device (ADR 0008): 48-bit Unix milliseconds, version 7, variant 10, random rest.
// `randomBytes(n)` is injected: node:crypto in Node, expo-crypto in the app.
export function uuidv7(nowMs, randomBytes) {
  const b = randomBytes(16);
  let ms = Math.floor(nowMs);
  for (let i = 5; i >= 0; i--) {
    b[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
