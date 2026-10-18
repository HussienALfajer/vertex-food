// 1-bit page bitmaps: rows of ceil(width / 8) bytes, most significant bit first, 1 = black dot.
// This is the layout ESC/POS raster commands (GS v 0) expect.

export function fromRgba(rgba, width, height, threshold = 160) {
  const stride = Math.ceil(width / 8);
  const bits = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Transparent counts as white paper.
      const a = rgba[i + 3] / 255;
      const lum = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * a + 255 * (1 - a);
      if (lum < threshold) bits[y * stride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { width, height, stride, bits };
}

// Floyd–Steinberg for photos and logos with gradients; text stays thresholded.
export function dither(rgba, width, height) {
  const g = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const a = rgba[i * 4 + 3] / 255;
    g[i] = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) * a + 255 * (1 - a);
  }
  const stride = Math.ceil(width / 8);
  const bits = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const black = g[i] < 128;
      const err = g[i] - (black ? 0 : 255);
      if (black) bits[y * stride + (x >> 3)] |= 0x80 >> (x & 7);
      if (x + 1 < width) g[i + 1] += (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) g[i + width - 1] += (err * 3) / 16;
        g[i + width] += (err * 5) / 16;
        if (x + 1 < width) g[i + width + 1] += err / 16;
      }
    }
  }
  return { width, height, stride, bits };
}

export function toRgba(mono) {
  const out = new Uint8ClampedArray(mono.width * mono.height * 4);
  for (let y = 0; y < mono.height; y++) {
    for (let x = 0; x < mono.width; x++) {
      const on = mono.bits[y * mono.stride + (x >> 3)] & (0x80 >> (x & 7));
      const i = (y * mono.width + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = on ? 0 : 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

export function blackRatio(mono) {
  let n = 0;
  for (const b of mono.bits) for (let k = b; k; k &= k - 1) n++;
  return n / (mono.width * mono.height);
}

export function diffDots(a, b) {
  if (a.width !== b.width) return { sameSize: false, diff: Number.NaN };
  const h = Math.min(a.height, b.height);
  let diff = 0;
  for (let i = 0; i < h * a.stride; i++) for (let k = a.bits[i] ^ b.bits[i]; k; k &= k - 1) diff++;
  return { sameSize: a.height === b.height, diff, ratio: diff / (a.width * h) };
}
