import { expect, type Page, type TestInfo, test } from '@playwright/test';

/** An RTL screenshot per color scheme, kept in test-results/ (uploaded by CI) and in the report. */
async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}-${testInfo.project.name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test.describe('driver shell', () => {
  test('renders in Arabic, right to left, with Vertex Food always visible', async ({
    page,
  }, testInfo) => {
    await page.goto('/');

    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'ar');
    await expect(html).toHaveAttribute('dir', 'rtl');
    await expect(page).toHaveTitle('فيرتكس فود');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('مرحبًا بك');
    await expect(page.getByRole('banner')).toContainText('فيرتكس فود');
    await expect(page.getByRole('banner')).toContainText('السائق');
    await expect(page.getByRole('contentinfo')).toHaveText('بدعم من فيرتكس فود');
    // The device's color scheme applies (the web export is rendered ahead in light): the surface
    // token is white in light and green-900 in dark (packages/tokens).
    const surface = testInfo.project.name === 'dark' ? 'rgb(11, 45, 40)' : 'rgb(255, 255, 255)';
    await expect(page.getByRole('banner')).toHaveCSS('background-color', surface);

    // Right to left: the mark starts the header at the right edge, the product name follows it
    // to the left, the theme button ends it on the left.
    const header = await page.getByRole('banner').boundingBox();
    const mark = await page.getByRole('banner').locator('svg').first().boundingBox();
    const product = await page.getByRole('banner').getByText('فيرتكس فود').boundingBox();
    const toggle = await page.getByRole('button', { name: /فعّل الوضع/ }).boundingBox();
    if (!(header && mark && product && toggle)) throw new Error('shell not laid out');
    expect(header.x + header.width - (mark.x + mark.width)).toBeLessThan(40);
    expect(product.x + product.width).toBeLessThanOrEqual(mark.x);
    const label = await page.getByRole('banner').getByText('السائق').boundingBox();
    if (!label) throw new Error('shell not laid out');
    expect(label.x + label.width).toBeLessThanOrEqual(product.x);
    expect(toggle.x + toggle.width).toBeLessThanOrEqual(label.x + 1);
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
    // The export is drawn in light, then the device's scheme applies after mounting: wait for it
    // before reading which button shows.
    const deviceSurface =
      testInfo.project.name === 'dark' ? 'rgb(11, 45, 40)' : 'rgb(255, 255, 255)';
    await expect(banner).toHaveCSS('background-color', deviceSurface);
    for (const [button, surface, name] of [
      [toDark, 'rgb(11, 45, 40)', 'dark'],
      [toLight, 'rgb(255, 255, 255)', 'light'],
    ] as const) {
      if (await button.isVisible()) await button.click();
      await expect(banner).toHaveCSS('background-color', surface);
      // Kept on the device (AsyncStorage) and applied again on the next start.
      await page.reload();
      await expect(banner).toHaveCSS('background-color', surface);
      await screenshot(page, testInfo, `theme-${name}`);
    }
  });

  test('shows the not-found state for an unknown route', async ({ page }, testInfo) => {
    const response = await page.goto('/no-such-screen');
    expect(response?.status()).toBe(404);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('الصفحة غير موجودة');
    await page.getByRole('link', { name: 'العودة إلى الرئيسية' }).click();
    await expect(page).toHaveURL('/');

    await page.goto('/no-such-screen');
    await screenshot(page, testInfo, 'not-found');
  });
});

/**
 * The visible controls smaller than 44 px either way (AGENTS.md, responsive: touch targets). The
 * web export draws a Pressable as `role="button"` and a router link as `<a>`; every size is a
 * touch screen here, so the check runs at each one.
 */
async function smallControls(page: Page): Promise<string[]> {
  // A string: this tsconfig has no DOM types.
  return (await page.evaluate(`(() => {
    const selector = 'button, a, [role="button"], [role="link"], input, textarea';
    return [...document.querySelectorAll(selector)]
      .filter((el) => !el.closest('[aria-hidden="true"]'))
      .map((el) => ({ el, box: el.getBoundingClientRect() }))
      .filter(({ el, box }) => box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden')
      .filter(({ box }) => box.width < 43.5 || box.height < 43.5)
      .map(({ el, box }) => el.tagName.toLowerCase() + ' "' +
        (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40) + '" ' +
        Math.round(box.width) + 'x' + Math.round(box.height));
  })()`)) as string[];
}

/** How far the page scrolls sideways. */
async function overflow(page: Page): Promise<number> {
  // A string: this tsconfig has no DOM types.
  return (await page.evaluate(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  )) as number;
}

/**
 * The visible elements that reach past either side of the window. The screens sit in a vertical
 * ScrollView, which clips sideways overflow instead of scrolling the page: `overflow` alone
 * cannot see content cut off there.
 */
async function cutOff(page: Page): Promise<string[]> {
  // A string: this tsconfig has no DOM types.
  return (await page.evaluate(`(() => {
    const width = document.documentElement.clientWidth;
    return [...document.querySelectorAll('body *')]
      .map((el) => ({ el, box: el.getBoundingClientRect() }))
      .filter(({ el, box }) => box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden')
      .filter(({ box }) => box.left < -0.5 || box.right > width + 0.5)
      .map(({ el, box }) => el.tagName.toLowerCase() + ' "' + (el.textContent || '').trim().slice(0, 40) +
        '" ' + Math.round(box.left) + '..' + Math.round(box.right));
  })()`)) as string[];
}

/**
 * The sizes every screen is checked at (AGENTS.md, responsive): phone both ways (the app follows
 * the device's orientation, `app.config.ts`), tablet both ways, desktop.
 */
const viewports = [
  { name: 'phone', width: 360, height: 800 },
  { name: 'phone-landscape', width: 800, height: 360 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'tablet-landscape', width: 1180, height: 820 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

for (const viewport of viewports) {
  test.describe(`driver at ${viewport.name} size (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const screen of [
      { name: 'home', path: '/', heading: 'مرحبًا بك' },
      { name: 'not-found', path: '/no-such-screen', heading: 'الصفحة غير موجودة' },
    ]) {
      test(`lays out ${screen.name} without sideways scrolling, with 44 px targets`, async ({
        page,
      }, testInfo) => {
        await page.goto(screen.path);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(screen.heading);
        await expect(page.getByRole('contentinfo')).toBeInViewport();
        expect(await overflow(page), 'the page scrolls sideways').toBeLessThanOrEqual(0);
        expect(await cutOff(page), 'content cut off at the sides').toEqual([]);
        expect(await smallControls(page), 'controls under 44 px').toEqual([]);
        await screenshot(page, testInfo, `${viewport.name}-${screen.name}`);
      });
    }
  });
}

test('the layout checks catch cut-off content and small controls inside the screen', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // A string: this tsconfig has no DOM types. A row wider than the window, inside the ScrollView.
  await page.evaluate(`(() => {
    const row = document.createElement('div');
    row.style.width = '2000px';
    row.style.height = '10px';
    const small = document.createElement('div');
    small.setAttribute('role', 'button');
    small.style.width = '20px';
    small.style.height = '20px';
    document.querySelector('[role="main"]').querySelector('div').append(row, small);
  })()`);
  expect(await cutOff(page)).not.toEqual([]);
  expect(await smallControls(page)).toEqual(['div "" 20x20']);
});
