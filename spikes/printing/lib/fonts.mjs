// Bundled fonts: the product ships its own Arabic font so receipts never depend on the fonts of a Windows install.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const dir = join(dirname(require.resolve('@fontsource/noto-sans-arabic/package.json')), 'files');

export const FAMILY = '"VF Arabic", "VF Latin", "VF Latin Ext"';
export const fontFiles = [];
const FAMILIES = { arabic: 'VF Arabic', latin: 'VF Latin', 'latin-ext': 'VF Latin Ext' };
for (const subset of Object.keys(FAMILIES)) {
  for (const weight of [400, 700]) {
    fontFiles.push({
      family: FAMILIES[subset],
      weight,
      path: join(dir, `noto-sans-arabic-${subset}-${weight}-normal.woff2`),
    });
  }
}

let registered = false;
export async function registerCanvasFonts() {
  if (registered) return;
  const { GlobalFonts } = await import('@napi-rs/canvas');
  for (const f of fontFiles) GlobalFonts.registerFromPath(f.path, f.family);
  registered = true;
}
