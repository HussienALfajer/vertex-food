import type { HubSession } from '@vertex-food/contracts';
import { Badge, Button, Card, cn, PoweredBy, ThemeToggle, VertexFoodMark } from '@vertex-food/ui';
import { LogOutIcon, WifiIcon, WifiOffIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConnectionState } from '../connection';

/**
 * The frame of every hub client page, phone first: the header with the branch's pages' name, the
 * connection badge, the member's session and the theme toggle, and «Powered by Vertex Food»
 * always visible at the foot (ADR 0018). The restaurant's own name and logo join the header when
 * the hub serves its branding (S08).
 */
export function PageShell({
  connection,
  session,
  onSignOut,
  children,
}: {
  /** Null before pairing: there is no branch to be connected to. */
  connection: ConnectionState | null;
  session: HubSession | null;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation('hubClients');
  const { t: common } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface px-4 py-2">
        <p className="flex min-w-0 flex-1 items-center gap-2 font-semibold">
          <VertexFoodMark aria-hidden className="w-7 shrink-0 text-primary" />
          <span className="truncate">{t('title')}</span>
        </p>
        {connection && <ConnectionBadge connected={connection.hub !== null} />}
        {session && (
          <Button variant="ghost" size="sm" onClick={onSignOut} aria-label={t('session.signOut')}>
            <LogOutIcon aria-hidden />
            <span className="max-w-32 truncate">{session.name}</span>
          </Button>
        )}
        <ThemeToggle labels={{ toDark: common('theme.toDark'), toLight: common('theme.toLight') }} />
      </header>
      <main className="flex flex-1 justify-center px-4 py-6">{children}</main>
      <footer className="flex justify-center px-4 py-4">
        <PoweredBy label={common('poweredBy')} />
      </footer>
    </div>
  );
}

export function ConnectionBadge({ connected }: { connected: boolean }) {
  const { t } = useTranslation('hubClients');
  return (
    <Badge tone={connected ? 'success' : 'warning'} data-testid="connection" role="status">
      {connected ? <WifiIcon aria-hidden /> : <WifiOffIcon aria-hidden />}
      {connected ? t('connection.connected') : t('connection.reconnecting')}
    </Badge>
  );
}

/** One page's content: its heading (the page's `<h1>`), description and body on a card. */
export function Screen({
  heading,
  description,
  wide = false,
  children,
}: {
  heading: string;
  description?: ReactNode;
  /** The network check: two columns from 1024 px. */
  wide?: boolean;
  children?: ReactNode;
}) {
  return (
    <Card className={cn('h-fit w-full p-4 sm:p-6', wide ? 'max-w-4xl' : 'max-w-md')}>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">{heading}</h1>
        {description && <p className="text-base text-muted-foreground">{description}</p>}
      </div>
      {children}
    </Card>
  );
}
