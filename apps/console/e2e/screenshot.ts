import { expect, type Page, type TestInfo } from '@playwright/test';
import { settled } from './settle.js';

/**
 * An RTL screenshot per color scheme, kept in test-results/ (uploaded by CI) and in the report,
 * once the page has `settled`.
 */
export async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await settled(page);
  const path = testInfo.outputPath(`${name}-${testInfo.project.name}.png`);
  // Transitions end at once, so a control just pressed shows its final state.
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

/** The widths every screen is checked at (AGENTS.md, responsive): phone, tablet both ways, desktop. */
export const viewports = [
  { name: 'phone', width: 360, height: 800 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'tablet-landscape', width: 1180, height: 820 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

/**
 * The visible controls smaller than 44 px either way (AGENTS.md, responsive: touch targets below
 * 1024 px). A checkbox or switch draws its touch area as a pseudo-element; inline links are exempt.
 */
export async function expectTouchTargets(page: Page): Promise<void> {
  // A dialog grows in from 95%: its controls are measured once it is drawn at full size (endless
  // animations, a spinner's, never end and are not waited for).
  await page.waitForFunction(`document.getAnimations().every((animation) =>
    animation.playState !== 'running' || animation.effect?.getComputedTiming().endTime === Infinity)`);
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
  expect(overflow, 'the page scrolls sideways').toBeLessThanOrEqual(0);
}
