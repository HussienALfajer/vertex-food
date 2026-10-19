import { expect, type Page, type TestInfo, test } from '@playwright/test';

/** An RTL screenshot per color scheme, kept in test-results/ (uploaded by CI) and in the report. */
async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}-${testInfo.project.name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

/** The surface token of a color scheme: white in light, green-900 in dark (packages/tokens). */
const surface = (scheme: string) => (scheme === 'dark' ? 'rgb(11, 45, 40)' : 'rgb(255, 255, 255)');

test.describe('web shell', () => {
  test('renders in Arabic, right to left, with Vertex Food always visible', async ({
    page,
  }, testInfo) => {
    await page.goto('/');

    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'ar');
    await expect(html).toHaveAttribute('dir', 'rtl');
    await expect(page).toHaveTitle('فيرتكس فود');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('مرحبًا بك في فيرتكس فود');
    await expect(page.getByRole('banner')).toContainText('فيرتكس فود');
    await expect(page.getByRole('banner')).toContainText('قوائم المطاعم');
    await expect(page.getByRole('contentinfo')).toHaveText('بدعم من فيرتكس فود');

    // Right to left: the Vertex Food mark starts the header on the right, the product name follows
    // it to the left, the theme button ends it on the left; the page's card shares the mark's edge.
    const mark = await page.getByRole('banner').locator('svg').first().boundingBox();
    const product = await page.getByRole('banner').getByText('فيرتكس فود').boundingBox();
    const toggle = await page.locator('[data-slot="theme-toggle"]').boundingBox();
    const card = await page.locator('[data-slot="card"]').first().boundingBox();
    if (!(mark && product && toggle && card)) throw new Error('shell not laid out');
    expect(product.x + product.width).toBeLessThanOrEqual(mark.x);
    expect(toggle.x + toggle.width).toBeLessThanOrEqual(product.x);
    expect(Math.abs(mark.x + mark.width - (card.x + card.width))).toBeLessThan(1);
    // The device's color scheme applies before the first paint: the surface token is white in
    // light and green-900 in dark (packages/tokens).
    await expect(page.getByRole('banner')).toHaveCSS(
      'background-color',
      surface(testInfo.project.name),
    );
    await expect(page.locator('body')).not.toHaveText(/[٠-٩]/);

    await screenshot(page, testInfo, 'home');
  });

  test('switches between light and dark with one button and keeps the choice', async ({
    page,
  }, testInfo) => {
    await page.goto('/');
    const banner = page.getByRole('banner');
    const toDark = page.getByRole('button', { name: 'فعّل الوضع الداكن' });
    const toLight = page.getByRole('button', { name: 'فعّل الوضع الفاتح' });
    // A server render (apps/web) names the light theme's button: wait for the device's theme.
    await expect(testInfo.project.name === 'dark' ? toLight : toDark).toBeVisible();
    for (const [button, name] of [
      [toDark, 'dark'],
      [toLight, 'light'],
    ] as const) {
      if (await button.isVisible()) await button.click();
      await expect(banner).toHaveCSS('background-color', surface(name));
      // Kept on the device (localStorage) and applied again before the next paint.
      await page.reload();
      await expect(banner).toHaveCSS('background-color', surface(name));
      await screenshot(page, testInfo, `theme-${name}`);
    }
  });

  test('shows the not-found state for an unknown page', async ({ page }, testInfo) => {
    const response = await page.goto('/no-such-page');
    expect(response?.status()).toBe(404);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('الصفحة غير موجودة');
    await page.getByRole('link', { name: 'العودة إلى الرئيسية' }).click();
    await expect(page).toHaveURL('/');

    await page.goto('/no-such-page');
    await screenshot(page, testInfo, 'not-found');
  });
});

/**
 * The visible controls smaller than 44 px either way (AGENTS.md, responsive: touch targets below
 * 1024 px). A checkbox or switch draws its touch area as a pseudo-element; inline links are exempt.
 */
async function smallControls(page: Page): Promise<string[]> {
  // A string: this tsconfig has no DOM types.
  return (await page.evaluate(`(() => {
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
}

/** The widths every page is checked at (AGENTS.md, responsive): phone, tablet both ways, desktop. */
const viewports = [
  { name: 'phone', width: 360, height: 800 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'tablet-landscape', width: 1180, height: 820 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

for (const viewport of viewports) {
  test.describe(`web at ${viewport.name} width (${viewport.width}px)`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('lays out the page without sideways scrolling', async ({ page }, testInfo) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('contentinfo')).toBeVisible();
      // A string: this tsconfig has no DOM types.
      const overflow = (await page.evaluate(
        'document.documentElement.scrollWidth - document.documentElement.clientWidth',
      )) as number;
      expect(overflow, 'the page scrolls sideways').toBeLessThanOrEqual(0);
      if (viewport.width < 1024) {
        expect(await smallControls(page), 'controls under 44 px').toEqual([]);
      }
      await screenshot(page, testInfo, `${viewport.name}-home`);
    });
  });
}
