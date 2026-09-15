import { test, expect } from "@playwright/test";

test.describe("links", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("every in-page anchor resolves to an existing element id", async ({ page }) => {
    const broken = await page.evaluate(() => {
      const missing = [];
      document.querySelectorAll('a[href^="#"]').forEach((a) => {
        const id = a.getAttribute("href").slice(1);
        if (!id) return; // href="#" alone
        if (!document.getElementById(id)) missing.push(a.getAttribute("href"));
      });
      return missing;
    });
    expect(broken).toEqual([]);
  });

  test("nav links cover every major section on the page", async ({ page }) => {
    const navTargets = await page.evaluate(() =>
      [...document.querySelectorAll("#navLinks a")].map((a) =>
        a.getAttribute("href")
      )
    );
    for (const id of ["about", "experience", "case-studies", "skills", "projects", "education", "contact"]) {
      expect(navTargets, `nav should link to #${id}`).toContain(`#${id}`);
    }
  });

  test("external links open in a new tab with rel=noopener", async ({ page }) => {
    const external = page.locator('a[href^="http"]').filter({ hasNot: page.locator('a[rel="noopener"]') });
    // All http(s) links except the canonical/og meta (those are not anchors).
    const allExternal = await page.evaluate(() =>
      [...document.querySelectorAll('a[href^="http"]')].map((a) => ({
        href: a.href,
        target: a.target,
        rel: a.rel,
      }))
    );
    expect(allExternal.length).toBeGreaterThan(0);
    for (const link of allExternal) {
      expect(link.target, `${link.href} should have target=_blank`).toBe("_blank");
      expect(link.rel, `${link.href} should have rel=noopener`).toContain("noopener");
    }
  });

  test("mailto and CV download links are well-formed", async ({ page }) => {
    const mailto = page.locator('a[href^="mailto:"]');
    await expect(mailto).toHaveCount(1);
    await expect(mailto).toHaveAttribute("href", "mailto:danim.roca@gmail.com");

    const cv = page.locator('a[download]');
    await expect(cv).toHaveCount(1);
    await expect(cv).toHaveAttribute("href", "CV.pdf");
  });
});
