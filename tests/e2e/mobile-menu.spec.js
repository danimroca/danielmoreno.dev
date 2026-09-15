import { test, expect } from "@playwright/test";

test.describe("mobile menu", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("hamburger is visible on mobile", async ({ page }) => {
    await expect(page.locator("#navToggle")).toBeVisible();
  });

  test("tapping the hamburger opens and closes the menu", async ({ page }) => {
    const links = page.locator("#navLinks");
    await expect(links).not.toHaveClass(/open/);

    await page.locator("#navToggle").tap();
    await expect(links).toHaveClass(/open/);
    await expect(links).toBeVisible();

    await page.locator("#navToggle").tap();
    await expect(links).not.toHaveClass(/open/);
  });

  test("all eight links are fully visible when the menu is open", async ({ page }) => {
    await page.locator("#navToggle").tap();
    const anchors = page.locator("#navLinks a");
    await expect(anchors).toHaveCount(8);

    for (let i = 0; i < 8; i++) {
      const box = await anchors.nth(i).boundingBox();
      expect(box, `link ${i} should be visible`).toBeTruthy();
      // The menu panel ends at top var(--nav-h) + max-height 600px.
      expect(box.y + box.height, `link ${i} should not be clipped`).toBeLessThanOrEqual(
        68 + 600 + 1
      );
    }
  });

  test("tapping a link closes the menu and scrolls to the section", async ({ page }) => {
    await page.locator("#navToggle").tap();
    await page.locator('#navLinks a[href="#skills"]').tap();
    await expect(page.locator("#navLinks")).not.toHaveClass(/open/);
    await expect(page).toHaveURL(/#skills$/);
    await expect(page.locator("#skills")).toBeInViewport();
  });

  test("contact buttons fit without horizontal overflow", async ({ page }) => {
    await page.evaluate(() => document.getElementById("contact").scrollIntoView());
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
  });
});
