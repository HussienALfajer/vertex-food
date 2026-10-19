import type { NextConfig } from 'next';

// Security headers (CSP and the rest) are set by the host at the first deploy (ADR 0015, 0017).
const config: NextConfig = {
  poweredByHeader: false,
};

export default config;
