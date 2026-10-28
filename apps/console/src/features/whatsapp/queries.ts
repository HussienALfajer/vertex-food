import { queryOptions, useQueryClient } from '@tanstack/react-query';
import type { WhatsAppQr } from '@vertex-food/contracts';
import { api, unwrap, unwrapEmpty } from '../../lib/api';

// Vertex's platform WhatsApp numbers (spec S03, screens 1–5): read with `console.messaging.read`;
// every change needs `console.messaging.manage` and a TOTP in the last 5 minutes (S02 rule 40),
// except reading the QR while linking.

const sessionsKey = ['console', 'whatsapp-sessions'] as const;

export const whatsappSessionsQuery = queryOptions({
  queryKey: sessionsKey,
  queryFn: () => unwrap(api.GET('/api/console/whatsapp-sessions')),
});

export function whatsappSessionQuery(id: string) {
  return queryOptions({
    queryKey: [...sessionsKey, id],
    queryFn: () =>
      unwrap(api.GET('/api/console/whatsapp-sessions/{id}', { params: { path: { id } } })),
  });
}

/** Screen 4: the banner on every page reads it every 30 s. */
export const messagingHealthQuery = queryOptions({
  queryKey: ['console', 'messaging', 'health'],
  queryFn: () => unwrap(api.GET('/api/console/messaging/health')),
  refetchInterval: 30_000,
});

/**
 * Screen 2, rule 4: the current QR, renewed every 2 s while the session is `linking`. The code is
 * not kept once the dialog closes (`gcTime: 0`).
 */
export function whatsappQrQuery(id: string) {
  return queryOptions({
    queryKey: [...sessionsKey, id, 'qr'],
    queryFn: () =>
      unwrap(api.GET('/api/console/whatsapp-sessions/{id}/qr', { params: { path: { id } } })),
    gcTime: 0,
    refetchInterval: (query) =>
      (query.state.data as WhatsAppQr | undefined)?.state === 'linking' ? 2000 : false,
  });
}

export function createWhatsAppSession(label: string) {
  return unwrap(api.POST('/api/console/whatsapp-sessions', { body: { label } }));
}

export function relinkWhatsAppSession(id: string) {
  return unwrap(
    api.POST('/api/console/whatsapp-sessions/{id}/relink', { params: { path: { id } } }),
  );
}

export function pauseWhatsAppSession(id: string, pause: boolean) {
  return pause
    ? unwrap(api.POST('/api/console/whatsapp-sessions/{id}/pause', { params: { path: { id } } }))
    : unwrap(api.POST('/api/console/whatsapp-sessions/{id}/resume', { params: { path: { id } } }));
}

export function unlinkWhatsAppSession(id: string) {
  return unwrapEmpty(
    api.POST('/api/console/whatsapp-sessions/{id}/unlink', { params: { path: { id } } }),
  );
}

/** After a change: the list, the numbers' details and the health banner read again. */
export function useWhatsAppSessionsChanged(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: sessionsKey }),
      queryClient.invalidateQueries({ queryKey: messagingHealthQuery.queryKey }),
    ]);
  };
}
