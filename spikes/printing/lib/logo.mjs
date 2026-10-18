// A synthetic tenant logo (colour, gradient) standing in for an uploaded one, and its one-time conversion
// to a 1-bit bitmap for a paper width. The product converts at upload and caches per width.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { FAMILY, registerCanvasFonts } from './fonts.mjs';
import { dither } from './mono.mjs';

export async function syntheticLogoPng() {
  await registerCanvasFonts();
  const c = createCanvas(480, 200);
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 480, 200);
  grad.addColorStop(0, '#d9480f');
  grad.addColorStop(1, '#fab005');
  g.fillStyle = grad;
  g.beginPath();
  g.roundRect(8, 8, 464, 184, 36);
  g.fill();
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(100, 100, 64, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#d9480f';
  g.font = `bold 64px ${FAMILY}`;
  g.textAlign = 'center';
  g.fillText('VF', 100, 122);
  g.fillStyle = '#fff';
  g.direction = 'rtl';
  g.textAlign = 'right';
  g.font = `bold 58px ${FAMILY}`;
  g.fillText('الشام', 440, 92);
  g.font = `40px ${FAMILY}`;
  g.fillText('مطعم تجريبي', 440, 150);
  return c.encode('png');
}

export async function prepareLogo(png, maxWidth) {
  const img = await loadImage(png);
  const w = Math.min(maxWidth, img.width);
  const h = Math.round((img.height * w) / img.width);
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  g.drawImage(img, 0, 0, w, h);
  return dither(g.getImageData(0, 0, w, h).data, w, h);
}
