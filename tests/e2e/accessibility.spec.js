import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Force every reveal element fully visible so axe measures final colors,
    // not mid-transition opacity (which skews contrast ratios).
    await page.evaluate(() => {
      document.querySelectorAll(".reveal").forEach((el) => el.classList.add("visible"));
    });
    await page.waitForTimeout(800);
  });

  test("no WCAG 2.1 AA violations at desktop size", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations).toEqual([]);
  });

  test("no WCAG 2.1 AA violations at mobile size", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations).toEqual([]);
  });

  test("keyboard-only navigation reaches all nav links and CTAs", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");

    // Tab through the header; every interactive element should be focusable.
    const focused = [];
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        return el ? { tag: el.tagName, text: el.textContent?.trim().slice(0, 40) } : null;
      });
      if (info) focused.push(info);
    }

    const texts = focused.map((f) => f.text).join("|");
    expect(texts).toContain("daniel"); // logo
    expect(texts).toContain("About");
    expect(texts).toContain("Contact");

    // Enter on the About link navigates to #about.
    await page.locator('#navLinks a[href="#about"]').focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#about$/);
  });

  test("focus is visible on interactive elements", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    // Keyboard focus triggers :focus-visible.
    await page.keyboard.press("Tab");
    const hasFocusRing = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return false;
      const style = getComputedStyle(el);
      return (
        style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0
      );
    });
    expect(hasFocusRing).toBe(true);
  });

  test("mobile menu is operable by keyboard", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.locator("#navToggle").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#navLinks")).toHaveClass(/open/);

    // Tab from the toggle reaches the next focusable nav link (DOM order: links first).
    await page.keyboard.press("Tab");
    const activeHref = await page.evaluate(() => document.activeElement?.getAttribute("href"));
    expect(["#about", "#contact"]).toContain(activeHref);

    // Shift+Tab returns to the toggle button.
    await page.keyboard.press("Shift+Tab");
    const isToggle = await page.evaluate(
      () => document.activeElement?.id === "navToggle"
    );
    expect(isToggle).toBe(true);
  });
});
