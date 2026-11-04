import { expect, test } from "@playwright/test";

// Runs only in the "touch" project (coarse pointer, iPad landscape): the named host controls are ≥44 × 44.
const MIN = 44;

async function sizes(page: import("@playwright/test").Page, selector: string) {
  return page.locator(selector).evaluateAll((els) =>
    els
      .filter((e) => (e as HTMLElement).offsetParent !== null)
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), text: e.textContent?.trim() };
      }),
  );
}

test("planner controls are at least 44 × 44 under a coarse pointer", async ({ page }) => {
  await page.route("**/api/requests/*/triage", (route) => route.abort());
  await page.goto("/?scenario=party-22-agent");
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
  await expect(page.locator(".request-sheet")).toBeVisible();
  for (const sel of [
    ".topbar nav a",
    ".theme-toggle button",
    ".panel-head .link-btn",
    ".cb-actions button",
    ".room-tabs button",
    ".seg button",
    ".decision-footer .btn-row button",
    ".topbar .scenario-menu summary",
    ".decision-footer .ask-ai",
    ".request-sheet .triage-row .more-toggle",
  ]) {
    const all = await sizes(page, sel);
    expect(all.length, sel).toBeGreaterThan(0);
    for (const s of all) {
      expect(s.w, `${sel} "${s.text}" width`).toBeGreaterThanOrEqual(MIN);
      expect(s.h, `${sel} "${s.text}" height`).toBeGreaterThanOrEqual(MIN);
    }
  }
  await page.getByRole("button", { name: "Close" }).click();
  for (const s of await sizes(page, "#rail-search")) expect(s.h).toBeGreaterThanOrEqual(MIN);
});

test("Use / Edit and the activity thumbs are at least 44 × 44", async ({ page }) => {
  await page.goto("/?scenario=party-22-accepted");
  await page.getByText("Layouts ▸").click();
  for (const s of await sizes(page, ".layout-list .btn-row button")) {
    expect(s.w).toBeGreaterThanOrEqual(MIN);
    expect(s.h).toBeGreaterThanOrEqual(MIN);
  }
  await page.goto("/activity?scenario=activity-log");
  const thumbs = await sizes(page, ".fb-thumb");
  expect(thumbs.length).toBeGreaterThan(0);
  for (const s of thumbs) {
    expect(s.w).toBeGreaterThanOrEqual(MIN);
    expect(s.h).toBeGreaterThanOrEqual(MIN);
  }
});

test("table details: Seat walk-in here and Finish are at least 44 tall", async ({ page }) => {
  await page.goto("/");
  await page.locator('svg.floor g[data-id="T3"]').focus();
  await page.keyboard.press("Enter");
  for (const s of await sizes(page, ".table-card .finish-btn"))
    expect(s.h).toBeGreaterThanOrEqual(MIN);
  await page.getByRole("button", { name: "Close" }).click();
  await page.locator('svg.floor g[data-id="T10"]').focus();
  await page.keyboard.press("Enter");
  const seat = await sizes(page, ".table-card .seat-here-btn");
  expect(seat.length).toBeGreaterThan(0);
  for (const s of seat) expect(s.h).toBeGreaterThanOrEqual(MIN);
});
