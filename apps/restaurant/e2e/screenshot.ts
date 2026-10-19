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
  { name: 'phone', width: 360, height: 800 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'tablet-landscape', width: 1180, height: 820 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

/**
 * Every visible control is at least 44 px each way, as below 1024 px screens are touched
 * (AGENTS.md, responsive): buttons, links styled as buttons, sidebar links, inputs and selects. A
 * checkbox or switch draws its 44 px area as a pseudo-element, which a box cannot measure; inline
 * links in text are exempt.
 */
export async function expectTouchTargets(page: Page): Promise<void> {
  // A string: this tsconfig has no DOM types.
  const small = (await page.evaluate(`(() => {
    const selector = 'button, [role="combobox"], a[data-slot="button"], nav a, ' +
      'input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="hidden"])';
    return [...document.querySelectorAll(selector)]
      .filter((el) => !el.closest('[aria-hidden="true"], .sr-only, [data-slot="checkbox"], [data-slot="switch"]'))
      .map((el) => ({ el, box: el.getBoundingClientRect() }))
      .filter(({ el, box }) => box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden')
      .filter(({ box }) => box.width < 43.5 || box.height < 43.5)
      .map(({ el, box }) => el.tagName.toLowerCase() + ' "' +
        (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40) + '" ' +
        Math.round(box.width) + 'x' + Math.round(box.height));
  })()`)) as string[];
  expect(small, 'controls smaller than 44 px').toEqual([]);
}

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
