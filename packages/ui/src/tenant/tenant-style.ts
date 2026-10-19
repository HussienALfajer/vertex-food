import { readableOn, type TenantIdentity, tenantAccent } from '@vertex-food/tokens';
import type { CSSProperties } from 'react';

type TenantStyle = CSSProperties &
  Partial<Record<'--tenant-accent' | '--tenant-accent-foreground', string>>;

/**
 * The style a restaurant-branded surface sets on its root element (ADR 0010, identity §10): the
 * restaurant's accent and the text color that reads on it, as the `--tenant-accent` variables
 * behind `bg-tenant-accent` and `text-tenant-accent-foreground`. Without a valid accent it sets
 * nothing, and the variables keep `theme.css`'s defaults: the theme's primary in light and dark.
 */
export function tenantStyle(identity: TenantIdentity | undefined): TenantStyle {
  const accent = tenantAccent(identity);
  if (accent === undefined) return {};
  return { '--tenant-accent': accent, '--tenant-accent-foreground': readableOn(accent) };
}
