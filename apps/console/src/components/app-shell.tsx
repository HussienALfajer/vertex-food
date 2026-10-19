import { PageContainer, PoweredBy, ThemeToggle, VertexFoodMark } from '@vertex-food/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The frame of every screen. "Powered by Vertex Food" is always visible (ADR 0018). The header
 * and every page share one column (`PageContainer`), so their edges line up.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation(['common', 'console']);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-surface">
        <PageContainer className="flex items-center gap-3 py-3">
          <VertexFoodMark className="w-7 text-primary" />
          <span className="text-lg font-bold">{t('productName')}</span>
          <span className="text-muted-foreground">{t('console:productLabel')}</span>
          <ThemeToggle
            className="ms-auto"
            labels={{ toDark: t('theme.toDark'), toLight: t('theme.toLight') }}
          />
        </PageContainer>
      </header>
      <main className="flex-1 py-6">
        <PageContainer>{children}</PageContainer>
      </main>
      <footer className="border-t border-border">
        <PageContainer className="py-2">
          <PoweredBy label={t('poweredBy')} />
        </PageContainer>
      </footer>
    </div>
  );
}
