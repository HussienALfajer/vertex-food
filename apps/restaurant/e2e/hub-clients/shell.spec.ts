import { expect, test } from '@playwright/test';
import {
  expectNoHorizontalOverflow,
  expectTouchTargets,
  failOnCspViolation,
  screenshot,
  viewports,
} from '../screenshot.js';

// The hub client pages' build (spec S04 screens 6–9), as the hub serves it: Arabic, right to left,
// under the hub's policy, with «Powered by Vertex Food». PR 7 replaces this page with the
// certificate guide, pairing, PIN sign-in and the network check.

test.describe('hub client pages', () => {
  test.beforeEach(({ page }) => {
    failOnCspViolation(page);
  });

  test('render in Arabic, right to left, with Vertex Food visible at every width', async ({
    page,
  }, testInfo) => {
    const response = await page.goto('/');
    expect(response?.headers()['content-security-policy']).toContain("script-src 'self'");
    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'ar');
    await expect(html).toHaveAttribute('dir', 'rtl');
    await expect(page).toHaveTitle('شاشات الفرع');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('شاشات الفرع');
    await expect(page.getByText('حاسوب الفرع يعمل')).toBeVisible();
    await expect(page.locator('[data-slot="powered-by"]')).toHaveText('بدعم من فيرتكس فود');
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await expectNoHorizontalOverflow(page);
      if (viewport.width < 1024) await expectTouchTargets(page);
      await screenshot(page, testInfo, `placeholder-${viewport.name}`);
    }
  });
});
