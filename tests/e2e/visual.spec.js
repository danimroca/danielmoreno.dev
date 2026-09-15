import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 720 },
  { name: "mobile", width: 390, height: 844 },
];

// Freeze reveal animations and CSS motion so baselines are deterministic.
async function stabilize(page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
      .reveal { opacity: 1 !important; transform: none !important; }
    `,
  });
  await page.evaluate(async () => {
    const step = window.innerHeight / 2;
    for (let y = 0; y <= document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 80));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(300);
}

for (const vp of VIEWPORTS) {
  test.describe(`visual regression — ${vp.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");
      await stabilize(page);
    });

    test("full page", async ({ page }) => {
      await expect(page).toHaveScreenshot(`full-page-${vp.name}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
      });
    });

    for (const id of ["hero", "about", "experience", "case-studies", "skills", "projects", "contact"]) {
      test(`section #${id}`, async ({ page }) => {
        const section =
          id === "hero" ? page.locator(".hero") : page.locator(`#${id}`);
        await expect(section).toHaveScreenshot(`${id}-${vp.name}.png`, {
          maxDiffPixelRatio: 0.01,
        });
      });
    }
  });
}
