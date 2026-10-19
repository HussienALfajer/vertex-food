import { expect, type Locator, type Page, type Request, type TestInfo } from '@playwright/test';

/** An RTL screenshot per color scheme, kept in test-results/ (uploaded by CI) and in the report. */
export async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}-${testInfo.project.name}.png`);
  // Transitions end at once, so a control just pressed shows its final state.
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

/** Fails the test on any CSP violation: `vite preview` sends Electron's policy. */
export function failOnCspViolation(page: Page): void {
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) {
      throw new Error(`CSP violation: ${message.text()}`);
    }
  });
}

/** The widths every screen is checked at (AGENTS.md, responsive): phone, tablet both ways, desktop. */
export const viewports = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'tablet-landscape', width: 1180, height: 820 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

/** Nothing on the page is wider than the window: no sideways scrolling at any width. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  // A string: this tsconfig has no DOM types.
  const overflow = (await page.evaluate(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  )) as number;
  if (overflow > 0) throw new Error(`the page scrolls sideways by ${overflow}px`);
}

/**
 * Hovers a link and waits until the screen's code it preloads has arrived. The router preloads
 * after a short delay, so `waitForLoadState('networkidle')` (already reached) would not wait for
 * it; a test that then cuts the connection would lose the code, which the desktop app ships. Only
 * scripts count: an API call still running from the page's load is not the preload.
 */
export async function preloadOnHover(page: Page, link: Locator): Promise<void> {
  const pending = new Set<Request>();
  let started = false;
  const onRequest = (request: Request) => {
    if (request.resourceType() !== 'script') return;
    pending.add(request);
    started = true;
  };
  const onDone = (request: Request) => pending.delete(request);
  page.on('request', onRequest);
  page.on('requestfinished', onDone);
  page.on('requestfailed', onDone);
  try {
    await link.hover();
    await expect.poll(() => started && pending.size === 0).toBe(true);
  } finally {
    page.off('request', onRequest);
    page.off('requestfinished', onDone);
    page.off('requestfailed', onDone);
  }
}
