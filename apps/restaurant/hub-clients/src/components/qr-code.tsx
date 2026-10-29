import { cn } from '@vertex-food/ui';
import { encode } from 'uqr';

/**
 * A QR code drawn as SVG modules (the console's `QrCode`): the branch certificate's download.
 * Dark on white in both themes: phone scanners expect it, so its colors do not follow the theme.
 */
export function QrCode({
  value,
  label,
  className,
}: {
  value: string;
  /** What the code is, for screen readers. */
  label: string;
  className?: string;
}) {
  const { size, data } = encode(value, { ecc: 'M', border: 2 });
  const modules = data.flatMap((row, y) =>
    row.flatMap((dark, x) => (dark ? [`M${x} ${y}h1v1h-1z`] : [])),
  );
  return (
    <svg
      data-slot="qr-code"
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={cn('size-48 rounded-md bg-white text-green-950', className)}
    >
      <path d={modules.join('')} fill="currentColor" />
    </svg>
  );
}
