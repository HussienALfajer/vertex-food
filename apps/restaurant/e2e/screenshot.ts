import type { Page, TestInfo } from '@playwright/test';

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
