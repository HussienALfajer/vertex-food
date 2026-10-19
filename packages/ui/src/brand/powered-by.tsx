import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';
import { VertexFoodMark } from './logo';

type PoweredByProps = Omit<ComponentProps<'p'>, 'children'> & {
  /** "Powered by Vertex Food", translated by the app (`common:poweredBy`). */
  label: string;
};

/**
 * "Powered by Vertex Food" with the mark (ADR 0018): always visible on every app shell and on
 * every restaurant-branded page, screen and receipt. A restaurant's identity never removes or
 * restyles it (ADR 0010 layer 3). The mark is decorative: the label names the product.
 */
function PoweredBy({ label, className, ...props }: PoweredByProps) {
  return (
    <p
      data-slot="powered-by"
      className={cn('inline-flex items-center gap-2 text-sm text-muted-foreground', className)}
      {...props}
    >
      <VertexFoodMark className="w-6 text-primary" />
      <span>{label}</span>
    </p>
  );
}

export { PoweredBy, type PoweredByProps };
