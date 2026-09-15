import { test, expect } from "@playwright/test";

const NAV_SECTIONS = [
  ["#about", "About"],
  ["#experience", "Experience"],
  ["#case-studies", "Case Studies"],
  ["#skills", "Skills"],
  ["#education", "Education"],
  ["#projects", "Side Projects"],
  ["#contact", "Let's talk"],
];

test.describe("desktop navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
  });

  test("hamburger is hidden and inline links are visible on desktop", async ({ page }) => {
    await expect(page.locator("#navToggle")).toBeHidden();
    await expect(page.locator("#navLinks a").first()).toBeVisible();
  });

  test("nav gains .scrolled after scrolling past 10px", async ({ page }) => {
    const nav = page.locator(".nav");
    await expect(nav).not.toHaveClass(/scrolled/);
    await page.evaluate(() => window.scrollTo(0, 200));
    await expect(nav).toHaveClass(/scrolled/);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(nav).not.toHaveClass(/scrolled/);
  });

  test("every nav link scrolls to its section", async ({ page }) => {
    for (const [hash] of NAV_SECTIONS) {
      await page.locator(`#navLinks a[href="${hash}"]`).click();
      await expect(page).toHaveURL(new RegExp(`${hash}$`));
      const section = page.locator(hash);
      await expect(section).toBeInViewport();
    }
  });

  test("logo and back-to-top return to the top", async ({ page }) => {
    // Disable smooth scrolling so the assertions are not racing a long animation.
    await page.addStyleTag({ content: "html { scroll-behavior: auto !important; }" });

    // Scroll past every .reveal element first: IntersectionObserver marks them
    // visible and removes transform, otherwise the hidden sections leave the
    // document shorter than expected and the back-to-top jump lands mid-page.
    await page.evaluate(async () => {
      for (let y = 0; y <= document.body.scrollHeight; y += 400) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 30));
      }
    });

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.locator(".footer__top").click();
    await expect
      .poll(() => page.evaluate(() => window.scrollY), { timeout: 10_000 })
      .toBeLessThan(50);

    await page.evaluate(() => window.scrollTo(0, 500));
    await page.locator(".nav__logo").click();
    await expect
      .poll(() => page.evaluate(() => window.scrollY), { timeout: 10_000 })
      .toBeLessThan(50);
  });
});
