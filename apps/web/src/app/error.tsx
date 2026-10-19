'use client';

import { useEffect } from 'react';
import { ErrorState } from '../components/error-state';
import { logErrorLabel } from '../lib/error-logging';

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => logErrorLabel(error), [error]);
  return <ErrorState onRetry={retry} />;
}
