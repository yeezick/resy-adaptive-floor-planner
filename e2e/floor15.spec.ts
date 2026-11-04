import { expect, test } from "@playwright/test";

// Floor polish: one key line, plain tiles (number + seats, no party-size badge), no cut-off labels, a one-line venue name.

const fitTables = ["T57", "T58", "T59", "T60", "T61", "T63", "T64", "T65", "T66"];

test.beforeEach(async ({ page }) => {
  await page.route("**/api/requests/*/triage", (route) => route.abort());
  await page.route("**/api/requests/*/chat", (route) => route.abort());
  await page.route("**/api/agent", (route) => route.abort());
});

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test("s1 and s4: the 22-top's tables show their number and seats, no party-size badge", async ({
  page,
}) => {
  for (const sc of ["party-22-agent", "request-chat"]) {
    await page.goto(`/?scenario=${sc}`);
    await expect(page.locator('g.table[data-id="T57"] .t-id')).toBeVisible();
    await expect(page.locator(".party-bubble")).toHaveCount(0);
  }
});

test("s2: the join label sits above the Held tags; Held clears the numbers; no party-size badge", async ({
  page,
}) => {
  await page.goto("/?scenario=party-22-accepted");
  // Accept applied the crew plan in the same confirm: the floor shows it, the tables joined and held
  await expect(page.locator(".accepted-result")).toContainText("crew plan applied");
  const labels = page.locator(".combo-badge rect");
  await expect(labels.first()).toBeVisible();
  await expect(page.locator(".party-bubble")).toHaveCount(0);
  const lbs = await labels.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
  for (const id of fitTables) {
    const held = page.locator(`g.table[data-id="${id}"] .ready-bubble.is-held rect`);
    const num = page.locator(`g.table[data-id="${id}"] .t-id`);
    await expect(num).toBeVisible();
    await expect
      .poll(async () => {
        const hb = await held.boundingBox();
        const nb = await num.boundingBox();
        return !!hb && !!nb && !overlaps(hb, nb) && lbs.every((lb) => !overlaps(lb as never, hb));
      }, `${id}: Held tag clear of the number and the join label`)
      .toBe(true);
  }
});

test("live floor: one key line under the meal-phase bar, no Key block", async ({ page }) => {
  await page.goto("/?scenario=walkin-8-peak");
  const key = page.locator(".floor-legend");
  await expect(key.locator(".phase-strip")).toBeVisible();
  await expect(key.locator(".legend-line")).toHaveText(
    "Open · Held · free ~Nm = est. until free · Dessert/Check amber = about to leave",
  );
  await expect(page.getByText("just sat → about to leave")).toHaveCount(0);
  await expect(page.locator(".legend-key")).toHaveCount(0);
  await expect(page.getByText("Key", { exact: true })).toHaveCount(0);
});

test("planning night: the key line at the top of the floor reads Open · Held only", async ({
  page,
}) => {
  await page.goto("/?scenario=party-22-agent");
  await expect(page.locator(".floor-legend .phase-strip")).toHaveCount(0);
  await expect(page.locator(".floor-legend .legend-line")).toHaveText("Open · Held");
  // inside the floor card, above the canvas
  const line = await page.locator(".floor-legend").boundingBox();
  const canvas = await page.locator("svg.floor").boundingBox();
  expect(line && canvas && line.y < canvas.y).toBe(true);
});

test("live floor: no room name is cut off at the edge of the view (Terrace under table 27)", async ({
  page,
}) => {
  await page.goto("/?scenario=walkin-8-peak");
  await page.getByRole("tab", { name: "Dining room" }).click();
  await page.waitForTimeout(300);
  // the floor shown on screen: the canvas inside its scroll panel, inside the room's view box
  const cut = await page.evaluate(() => {
    const svg = document.querySelector("svg.floor") as SVGSVGElement;
    const panel = (document.querySelector(".floor-scroll") as HTMLElement).getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const r = svg.getBoundingClientRect();
    const ppu = Math.min(r.width / vb.width, r.height / vb.height);
    const vx = r.left + (r.width - vb.width * ppu) / 2;
    const vy = r.top + (r.height - vb.height * ppu) / 2;
    const top = Math.max(panel.top, vy);
    const bottom = Math.min(panel.bottom, vy + vb.height * ppu);
    const left = Math.max(panel.left, vx);
    const right = Math.min(panel.right, vx + vb.width * ppu);
    return [...svg.querySelectorAll(".area-label")]
      .map((l) => ({ name: l.textContent, b: l.getBoundingClientRect() }))
      .filter(({ b }) => b.right > left && b.left < right && b.bottom > top && b.top < bottom)
      .filter(({ b }) => b.top < top - 1 || b.bottom > bottom + 1)
      .map(({ name }) => name);
  });
  expect(cut).toEqual([]);
});

test("the venue name stays on one line with Edited · Reset showing", async ({ page }) => {
  await page.goto("/?scenario=walkin-8-peak");
  await page.getByRole("tab", { name: "Dining room" }).click();
  await page.locator('g.table[data-id="T41"]').click();
  await page
    .locator(".side-col")
    .getByRole("button", { name: /^Finish/ })
    .click();
  await expect(page.getByRole("button", { name: "Reset", exact: true })).toBeVisible();
  const m = await page.evaluate(() => {
    const name = document.querySelector(".console-bar .room-name") as HTMLElement;
    const bar = document.querySelector(".console-bar") as HTMLElement;
    const select = document.querySelector(".room-select select") as HTMLSelectElement;
    const clock = document.querySelector(".cb-clock") as HTMLElement;
    const lh = parseFloat(getComputedStyle(name).lineHeight) || 16;
    return {
      lines: Math.round(name.getBoundingClientRect().height / lh),
      overflow: bar.scrollWidth - bar.clientWidth,
      gap: clock.getBoundingClientRect().left - select.getBoundingClientRect().right,
    };
  });
  expect(m.lines).toBe(1);
  expect(m.overflow).toBeLessThanOrEqual(0);
  expect(m.gap).toBeGreaterThanOrEqual(0);
});
