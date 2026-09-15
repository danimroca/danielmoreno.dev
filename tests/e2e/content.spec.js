import { test, expect } from "@playwright/test";

test.describe("content smoke", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("title and meta description are present", async ({ page }) => {
    await expect(page).toHaveTitle(/Daniel Moreno Roca/);
    const desc = await page.locator('meta[name="description"]').getAttribute("content");
    expect(desc.length).toBeGreaterThan(50);
  });

  test("Open Graph and Twitter card tags are present", async ({ page }) => {
    for (const prop of [
      'meta[property="og:type"]',
      'meta[property="og:title"]',
      'meta[property="og:description"]',
      'meta[property="og:image"]',
      'meta[name="twitter:card"]',
    ]) {
      const content = await page.locator(prop).getAttribute("content");
      expect(content, `${prop} should be non-empty`).toBeTruthy();
    }
  });

  test("all major sections render", async ({ page }) => {
    for (const id of ["about", "experience", "case-studies", "skills", "education", "projects", "contact"]) {
      await expect(page.locator(`#${id}`)).toBeVisible();
    }
  });

  test("expected counts: jobs, case studies, skill cards, projects, education", async ({ page }) => {
    await expect(page.locator(".job")).toHaveCount(5);
    await expect(page.locator(".case-card")).toHaveCount(3);
    await expect(page.locator(".skill-card")).toHaveCount(6);
    await expect(page.locator(".project-card")).toHaveCount(4);
    await expect(page.locator(".edu-card")).toHaveCount(2);
  });

  test("footer year matches the current year", async ({ page }) => {
    const year = await page.locator("#year").textContent();
    expect(year).toBe(String(new Date().getFullYear()));
  });

  test("no console errors on load", async ({ page }) => {
    const errors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto("/");
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test("all local assets load without 404s", async ({ page }) => {
    const failed = [];
    page.on("response", (res) => {
      if (res.status() >= 400 && res.url().startsWith("http://localhost:3000")) {
        failed.push(`${res.status()} ${res.url()}`);
      }
    });
    await page.goto("/");
    await expect(page.locator(".terminal")).toBeVisible();
    expect(failed).toEqual([]);
  });
});
