import { expect, type Page } from '@playwright/test';

/**
 * The page's work in flight: its `fetch` calls (the API's answers), counted in the page, where
 * one the app aborts settles too (Playwright reports no end for an intercepted request the page
 * cancels). `settled` waits until none is open. Copied from Vertex Shifa's console.
 */
const tracked = new WeakSet<Page>();

// Strings: the E2E is typed for Node, without the DOM's globals.
const countFetches = `{
  const calls = { open: 0, started: 0 };
  const fetch = window.fetch;
  window.fetch = function (...args) {
    calls.open += 1;
    calls.started += 1;
    return fetch.apply(this, args).finally(() => { calls.open -= 1; });
  };
  window.vertexFoodE2eFetches = () => ({ ...calls });
}`;

// No fetch open before or after two frames and none started between them, the fonts in, and the
// document the same size: React has drawn the last answer.
const stillPage = `document.fonts.ready.then(() => {
  const size = () => document.documentElement.scrollWidth + 'x' + document.documentElement.scrollHeight;
  const before = { ...window.vertexFoodE2eFetches(), size: size() };
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const after = { ...window.vertexFoodE2eFetches(), size: size() };
      resolve(before.open === 0 && after.open === 0 && after.started === before.started && after.size === before.size);
    })),
  );
})`;

/** Follows `page`'s requests from its first document on. */
export async function trackActivity(page: Page): Promise<void> {
  tracked.add(page);
  await page.addInitScript(countFetches);
}

/**
 * Waits until the screen is drawn from every answer it asked for: no request open, none started
 * while two frames are drawn, the fonts loaded and the layout still. Measure or capture the page
 * only then: a full-page screenshot whose page changes size while it is taken fails ("Unable to
 * capture screenshot"), and a box measured mid-render is the wrong one.
 */
export async function settled(page: Page): Promise<void> {
  if (!tracked.has(page)) throw new Error('settled() needs mockConsoleApi(page) first');
  await expect
    .poll(() => page.evaluate<boolean>(stillPage), {
      message: 'the page never settled: a request is still open',
    })
    .toBe(true);
}
