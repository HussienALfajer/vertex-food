import { useMemo } from 'react';
import { encode } from 'uqr';

/**
 * A QR code drawn as one SVG path (no image, so nothing for the CSP to allow). Dark modules on the
 * accent surface in both themes: a phone's camera needs dark on light, which the theme's own
 * foreground and surface invert in dark mode.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { path, size } = useMemo(() => {
    const { data } = encode(value, { ecc: 'M', border: 2 });
    const parts: string[] = [];
    data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) parts.push(`M${x} ${y}h1v1h-1z`);
      });
    });
    return { path: parts.join(''), size: data.length };
  }, [value]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className="size-48 shrink-0 rounded-md bg-accent text-accent-foreground"
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}
