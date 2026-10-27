import { expect, test } from '@playwright/test';
import { mockConsoleApi } from './mock-api.js';
import {
  expectNoHorizontalOverflow,
  expectTouchTargets,
  screenshot,
  viewports,
} from './screenshot.js';

/** The surface token of a color scheme: white in light, green-900 in dark (packages/tokens). */
const surface = (scheme: string) => (scheme === 'dark' ? 'rgb(11, 45, 40)' : 'rgb(255, 255, 255)');

test.describe('console shell', () => {
  test('renders in Arabic, right to left, with Vertex Food always visible', async ({
    page,
  }, testInfo) => {
    await mockConsoleApi(page, { signedIn: 'admin' });
    await page.goto('/');

    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'ar');
    await expect(html).toHaveAttribute('dir', 'rtl');
    await expect(page).toHaveTitle('فيرتكس فود');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('لوحة فريق فيرتكس');
    const sidebar = page.locator('[data-slot="sidebar"]');
    await expect(sidebar).toContainText('فيرتكس فود');
    await expect(sidebar).toContainText('لوحة فيرتكس');
    await expect(sidebar.getByRole('link', { name: 'الرئيسية' })).toHaveAttribute(
      'data-status',
      'active',
    );
    await expect(page.getByRole('contentinfo')).toHaveText('بدعم من فيرتكس فود');

    // Right to left: the sidebar stands on the right of the content, the theme button ends the top
    // bar on the left, and the page's card starts at the content's right edge.
    const side = await sidebar.boundingBox();
    const main = await page.locator('main').boundingBox();
    const toggle = await page.locator('[data-slot="theme-toggle"]').boundingBox();
    const card = await page.locator('[data-slot="card"]').first().boundingBox();
    if (!(side && main && toggle && card)) throw new Error('shell not laid out');
    expect(main.x + main.width).toBeLessThanOrEqual(side.x + 1);
    expect(toggle.x).toBeLessThan(main.x + main.width / 2);
    expect(card.x + card.width).toBeLessThanOrEqual(side.x);
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
    await mockConsoleApi(page, { signedIn: 'admin' });
    await page.goto('/');
    const banner = page.getByRole('banner');
    const toDark = page.getByRole('button', { name: 'فعّل الوضع الداكن' });
    const toLight = page.getByRole('button', { name: 'فعّل الوضع الفاتح' });
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

  test('shows the not-found state for an unknown route', async ({ page }, testInfo) => {
    await mockConsoleApi(page, { signedIn: 'admin' });
    await page.goto('/no-such-screen');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('الصفحة غير موجودة');
    await page.getByRole('link', { name: 'العودة إلى الرئيسية' }).click();
    await expect(page).toHaveURL('/');

    await page.goto('/no-such-screen');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('الصفحة غير موجودة');
    await screenshot(page, testInfo, 'not-found');
  });
});

for (const viewport of viewports) {
  test.describe(`console at ${viewport.name} width (${viewport.width}px)`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    const wide = viewport.width >= 1024;

    test('keeps the sidebar in reach without sideways scrolling', async ({ page }, testInfo) => {
      await mockConsoleApi(page, { signedIn: 'admin' });
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('لوحة فريق فيرتكس');
      const menu = page.getByRole('button', { name: 'افتح القائمة' });
      await expect(page.locator('aside [data-slot="sidebar"]')).toBeVisible({ visible: wide });
      await expect(menu).toBeVisible({ visible: !wide });
      await expectNoHorizontalOverflow(page);
      if (!wide) await expectTouchTargets(page);
      await screenshot(page, testInfo, `${viewport.name}-home`);

      if (!wide) {
        // The sheet holds the same links and closes once one is chosen.
        await menu.click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expectTouchTargets(page);
        await screenshot(page, testInfo, `${viewport.name}-menu`);
        await page.getByRole('navigation').getByRole('link', { name: 'الرئيسية' }).click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
      }
    });
  });
}
