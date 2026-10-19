'use client';

import { MenuIcon } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { VertexFoodMark } from '../brand/logo';
import { cn } from '../lib/cn';
import { Button } from './button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from './sheet';

/** The width from which the sidebar stays open beside the content (Tailwind's `lg`, 1024 px). */
const sidebarQuery = '(min-width: 64rem)';

/** The column the top bar, the page and the footer share: full width on phones, padded wider up. */
const column = 'mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8';

interface AppLayoutProps {
  /** "Vertex Food", translated by the app (`common:productName`). */
  productName: string;
  /** The app's own name under it ("Restaurant", "Vertex console"). */
  productLabel?: string;
  /**
   * The sidebar's links, given a `close` the links call on navigation (it closes the sheet on
   * phones). Omitted: no sidebar, and the brand stands in the top bar at every width.
   */
  navigation?: ((close: () => void) => ReactNode) | undefined;
  /** The top bar's end: the theme toggle, later the user menu. */
  actions?: ReactNode;
  /** Under every page: "Powered by Vertex Food" (ADR 0018), so it is visible at every width. */
  footer: ReactNode;
  labels: {
    /** The skip link, first on every page (WCAG 2.4.1). */
    skip: string;
    /** The navigation landmark's name. */
    navigation: string;
    /** The menu button that opens the sidebar on phones and tablets. */
    openNavigation: string;
  };
  children: ReactNode;
}

/**
 * The frame of every back-office screen (Vertex Hub's shell): a Vertex Green sidebar beside the
 * content from 1024 px, a sheet behind the menu button below that; a sticky top bar; the page in
 * one column that narrows its padding on phones; the footer under it.
 */
function AppLayout({
  productName,
  productLabel,
  navigation,
  actions,
  footer,
  labels,
  children,
}: AppLayoutProps) {
  const [navOpen, setNavOpen] = useState(false);
  const close = () => setNavOpen(false);

  // A sheet left open while the window widens would cover the sidebar it duplicates.
  useEffect(() => {
    const wide = window.matchMedia(sidebarQuery);
    const onChange = () => {
      if (wide.matches) setNavOpen(false);
    };
    wide.addEventListener('change', onChange);
    return () => wide.removeEventListener('change', onChange);
  }, []);

  return (
    <div data-slot="app-layout" className="flex min-h-dvh bg-background">
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:start-4 focus-visible:top-4 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-surface focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:text-foreground focus-visible:shadow-float"
      >
        {labels.skip}
      </a>
      {navigation && (
        // The green runs the page's full height; the panel stays in view as the page scrolls.
        <aside className="hidden w-64 shrink-0 border-e border-sidebar-border bg-sidebar lg:block">
          <div className="sticky top-0 flex h-dvh">
            <SidebarPanel
              productName={productName}
              productLabel={productLabel}
              label={labels.navigation}
            >
              {navigation(close)}
            </SidebarPanel>
          </div>
        </aside>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 border-b border-border bg-surface">
          <div className={cn(column, 'flex h-16 items-center gap-2')}>
            {navigation && (
              <Sheet open={navOpen} onOpenChange={setNavOpen}>
                <SheetTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="-ms-2 lg:hidden"
                      aria-label={labels.openNavigation}
                    />
                  }
                >
                  <MenuIcon />
                </SheetTrigger>
                <SheetContent>
                  <SheetTitle className="sr-only">{labels.navigation}</SheetTitle>
                  <SidebarPanel
                    productName={productName}
                    productLabel={productLabel}
                    label={labels.navigation}
                  >
                    {navigation(close)}
                  </SidebarPanel>
                </SheetContent>
              </Sheet>
            )}
            <div
              data-slot="app-brand"
              className={cn('flex min-w-0 items-center gap-2', navigation && 'lg:hidden')}
            >
              <VertexFoodMark className="w-7 shrink-0 text-primary" />
              <span className="truncate text-lg font-bold">{productName}</span>
              {productLabel && (
                <span className="hidden truncate text-muted-foreground sm:inline">
                  {productLabel}
                </span>
              )}
            </div>
            <div className="ms-auto flex shrink-0 items-center gap-2">{actions}</div>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="flex-1 py-6 outline-none lg:py-8">
          <div className={column}>{children}</div>
        </main>
        <footer className="border-t border-border">
          <div className={cn(column, 'py-3')}>{footer}</div>
        </footer>
      </div>
    </div>
  );
}

/** Vertex Green navigation with the gold mark and a gold marker on the active link (§2, §7). */
function SidebarPanel({
  productName,
  productLabel,
  label,
  children,
}: {
  productName: string;
  productLabel?: string | undefined;
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      data-slot="sidebar"
      className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground [--ring:var(--sidebar-ring)]"
    >
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-sidebar-border px-5">
        <VertexFoodMark className="w-8 shrink-0 text-sidebar-marker" />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-lg leading-tight font-bold">{productName}</span>
          {productLabel && (
            <span className="truncate text-sm text-sidebar-muted-foreground">{productLabel}</span>
          )}
        </div>
      </div>
      {/* The links scroll under the fixed header on short screens. */}
      <nav aria-label={label} className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
        {children}
      </nav>
    </div>
  );
}

/**
 * A sidebar link: give it to the router's link as its class name. The router marks the current
 * page with `data-status="active"`; it then takes the darker fill and the gold marker.
 */
const sidebarLinkClassName = cn(
  'relative flex h-11 items-center gap-3 rounded-md px-3 text-base lg:pointer-fine:h-10 text-sidebar-muted-foreground transition-colors duration-150 ease-out',
  'hover:bg-sidebar-hover hover:text-sidebar-foreground',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  'data-[status=active]:bg-sidebar-active data-[status=active]:font-medium data-[status=active]:text-sidebar-foreground',
  'before:absolute before:inset-y-2 before:start-0 before:w-0.5 before:bg-sidebar-marker before:opacity-0 data-[status=active]:before:opacity-100',
  '[&_svg]:size-5 [&_svg]:shrink-0',
);

export { AppLayout, type AppLayoutProps, sidebarLinkClassName };
