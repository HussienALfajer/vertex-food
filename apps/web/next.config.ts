import type { NextConfig } from 'next';

// Security headers (CSP and the rest) are set by the host at the first deploy (ADR 0015, 0017).
const config: NextConfig = {
  poweredByHeader: false,
  // The design system ships TypeScript sources (packages/ui).
  transpilePackages: ['@vertex-food/ui'],
};

export default config;
