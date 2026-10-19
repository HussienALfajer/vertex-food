import { expect, type Page, type TestInfo, test } from '@playwright/test';

/** An RTL screenshot per color scheme, kept in test-results/ (uploaded by CI) and in the report. */
async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}-${testInfo.project.name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test.describe('console shell', () => {
  test('renders in Arabic, right to left, with Vertex Food always visible', async ({
    page,
  }, testInfo) => {
    await page.goto('/');

    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'ar');
    await expect(html).toHaveAttribute('dir', 'rtl');
    await expect(page).toHaveTitle('فيرتكس فود');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('لوحة فريق فيرتكس');
    await expect(page.getByRole('banner')).toContainText('فيرتكس فود');
    await expect(page.getByRole('banner')).toContainText('لوحة فيرتكس');
    await expect(page.getByRole('contentinfo')).toHaveText('بدعم من فيرتكس فود');

    // Right to left: the product name starts at the right edge of the header.
    const header = await page.getByRole('banner').boundingBox();
    const product = await page.getByRole('banner').getByText('فيرتكس فود').boundingBox();
    expect(header && product).toBeTruthy();
    if (header && product) {
      expect(header.x + header.width - (product.x + product.width)).toBeLessThan(40);
    }
    await expect(page.locator('body')).not.toHaveText(/[٠-٩]/);

    await screenshot(page, testInfo, 'home');
  });

  test('shows the not-found state for an unknown route', async ({ page }, testInfo) => {
    await page.goto('/no-such-screen');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('الصفحة غير موجودة');
    await page.getByRole('link', { name: 'العودة إلى الرئيسية' }).click();
    await expect(page).toHaveURL('/');

    await page.goto('/no-such-screen');
    await screenshot(page, testInfo, 'not-found');
  });
});
