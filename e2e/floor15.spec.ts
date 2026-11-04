import { expect, test, type Locator, type Page } from "@playwright/test";

// Floor polish: one key line, party-size bubbles on the tiles, no cut-off labels, a one-line venue name.

const fitTables = ["T57", "T58", "T59", "T60", "T61", "T63", "T64", "T65", "T66"];

test.beforeEach(async ({ page }) => {
  await page.route("**/api/requests/*/triage", (route) => route.abort());
  await page.route("**/api/requests/*/chat", (route) => route.abort());
  await page.route("**/api/agent", (route) => route.abort());
});

/** Rendered font size (px) of an SVG text: its font-size in grid units × screen px per unit. */
async function renderedPx(text: Locator): Promise<number> {
  return text.evaluate((el) => {
    const svg = (el as SVGTextElement).ownerSVGElement as SVGSVGElement;
    const vb = svg.viewBox.baseVal;
    const r = svg.getBoundingClientRect();
    const ppu = Math.min(r.width / vb.width, r.height / vb.height);
    return Number(el.getAttribute("font-size")) * ppu;
  });
}

/** WCAG contrast between a bubble's text fill and its pill fill. */
async function bubbleContrast(bubble: Locator): Promise<number> {
  return bubble.evaluate((g) => {
    const rgb = (s: string) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const lum = ([r, g2, b]: number[]) => {
      const c = [r, g2, b].map((v) => {
        const x = (v ?? 0) / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
    };
    const fg = lum(rgb(getComputedStyle(g.querySelector("text") as Element).fill));
    const bg = lum(rgb(getComputedStyle(g.querySelector("rect") as Element).fill));
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  });
}

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function expectBubble(page: Page, id: string, size: string) {
  const bubble = page.locator(`.party-bubble[data-table="${id}"]`);
  await expect(bubble).toHaveText(size);
  // never over the table number
  const num = await page.locator(`g.table[data-id="${id}"] .t-id`).boundingBox();
  const b = await bubble.locator("rect").boundingBox();
  expect(num && b && !overlaps(num, b)).toBe(true);
  return bubble;
}

for (const theme of ["dark", "light"] as const) {
  test(`s1 (${theme}): the 22-top's nine tables read 22 at Fit, readable and clear of the numbers`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/?scenario=party-22-agent");
    await page
      .getByRole("button", { name: theme === "dark" ? "Dark" : "Light", exact: true })
      .click();
    await page.getByRole("button", { name: "Fit to panel" }).click();
    for (const id of fitTables) {
      const bubble = await expectBubble(page, id, "22");
      expect(await renderedPx(bubble.locator("text"))).toBeGreaterThanOrEqual(10);
      expect(await bubbleContrast(bubble)).toBeGreaterThanOrEqual(4.5);
    }
    // a table with no party has no bubble
    await expect(page.locator('.party-bubble[data-table="T71"]')).toHaveCount(0);
  });
}

test("s1: the party the 22-top moves reads 12 on its new tables", async ({ page }) => {
  await page.goto("/?scenario=party-22-agent");
  await page.getByRole("tab", { name: "West suite" }).click();
  for (const id of ["T77", "T78", "T79", "T80"]) await expectBubble(page, id, "12");
});

test("s2: held tables read 22; the join label sits above the Held tags; Held clears the numbers", async ({
  page,
}) => {
  await page.goto("/?scenario=party-22-accepted");
  // Accept applied the crew plan in the same confirm: the floor shows it, the tables joined and held
  await expect(page.locator(".accepted-result")).toContainText("crew plan applied");
  for (const id of fitTables) await expectBubble(page, id, "22");
  const labels = page.locator(".combo-badge rect");
  await expect(labels.first()).toBeVisible();
  const lbs = await labels.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
  for (const id of fitTables) {
    const held = page.locator(`g.table[data-id="${id}"] .ready-bubble.is-held rect`);
    const hb = await held.boundingBox();
    const num = await page.locator(`g.table[data-id="${id}"] .t-id`).boundingBox();
    for (const lb of lbs) expect(hb && !overlaps(lb as never, hb), `${id} label`).toBe(true);
    expect(hb && num && !overlaps(hb, num)).toBe(true);
  }
});

test("s4: the request-chat scenario still shows the 22-top's tables", async ({ page }) => {
  await page.goto("/?scenario=request-chat");
  for (const id of fitTables.slice(0, 2)) await expectBubble(page, id, "22");
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
