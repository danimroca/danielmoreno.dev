import { test, expect } from "@playwright/test";

test.describe("reveal animations", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
  });

  test("below-fold .reveal elements start hidden", async ({ page }) => {
    const about = page.locator("#about .section__title");
    const opacity = await about.evaluate((el) => getComputedStyle(el).opacity);
    expect(parseFloat(opacity)).toBeLessThan(0.5);
  });

  test("scrolling reveals each section and it stays visible", async ({ page }) => {
    for (const id of ["about", "experience", "case-studies", "skills", "education", "projects", "contact"]) {
      await page.evaluate((sectionId) => {
        document.getElementById(sectionId).scrollIntoView();
      }, id);
      await expect(page.locator(`#${id} .reveal`).first()).toHaveClass(/visible/);
    }

    // Scroll back to top: revealed elements must not hide again.
    await page.evaluate(() => window.scrollTo(0, 0));
    const aboutOpacity = await page
      .locator("#about .section__title")
      .evaluate((el) => getComputedStyle(el).opacity);
    expect(parseFloat(aboutOpacity)).toBe(1);
  });

  test("every .reveal element becomes visible after a full scroll", async ({ page }) => {
    await page.evaluate(async () => {
      const step = window.innerHeight / 2;
      for (let y = 0; y <= document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 150));
      }
    });
    const hidden = await page.evaluate(() =>
      [...document.querySelectorAll(".reveal")].filter(
        (el) => !el.classList.contains("visible")
      ).length
    );
    expect(hidden).toBe(0);
  });
});
