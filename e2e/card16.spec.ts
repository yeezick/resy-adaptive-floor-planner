import { expect, test, type Page } from "@playwright/test";

// The one request card: Request · summary · Needs · Guest message · "Take it" + fit pill · one rating row; Plan,
// Pros, Cons, the walk-in comparison and the crew footnote behind More ▸. Scenario links only: no model call.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/requests/*/triage", (route) => route.abort());
  await page.route("**/api/requests/*/chat", (route) => route.abort());
  await page.route("**/api/agent", (route) => route.abort());
});

async function openS1(page: Page) {
  await page.goto("/?scenario=party-22-agent");
  const card = page.locator(".request-sheet .req-card");
  await expect(card.locator(".req-overview")).toContainText("Family reunion");
  return card;
}

const top = async (page: Page, sel: string) =>
  (await page.locator(sel).first().boundingBox())?.y ?? Number.NaN;

test("the card reads top to bottom: Request, summary, Needs, guest message, Take it, the rating row", async ({
  page,
}) => {
  const card = await openS1(page);
  await expect(card.locator(".req-via .field-label")).toHaveText("Request");
  await expect(card.locator(".req-via .field-value")).toHaveText("AI agent · MCP");
  await expect(card.locator(".req-needs .field-label")).toHaveText("Needs");
  await expect(card.locator(".req-needs .access-icon")).toBeVisible();
  const needsSize = await card
    .locator(".req-needs .field-value")
    .evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  expect(needsSize).toBe(14);
  await expect(card.locator(".req-message .field-label")).toHaveText("Guest message");
  // verbatim, in quotes
  await expect(card.locator(".req-message q")).toContainText(
    "Booking request on behalf of Sam Whitaker: dinner for 22 on Friday at 6:30 PM, family reunion.",
  );
  await expect(card.locator(".take-it-text")).toHaveText(
    "Take it: a booked 22 beats uncertain walk-ins",
  );
  const take = card.locator(".take-it");
  const look = await take.evaluate((e) => {
    const s = getComputedStyle(e);
    return { size: parseFloat(s.fontSize), weight: Number(s.fontWeight) };
  });
  expect(look.size).toBeGreaterThanOrEqual(16);
  expect(look.size).toBeLessThanOrEqual(18);
  expect(look.weight).toBeGreaterThanOrEqual(600);
  // exactly one capacity-fit pill on the sheet, beside the rule's line
  await expect(page.locator(".request-sheet .fit-pill")).toHaveCount(1);
  await expect(take.locator(".fit-pill")).toHaveText("capacity fit ✓ · Ready");
  const order = [
    ".req-card .req-via",
    ".req-card .req-overview",
    ".req-card .req-needs",
    ".req-card .req-message",
    ".req-card .take-it",
    ".req-card .triage-row",
  ];
  const ys = [];
  for (const sel of order) ys.push(await top(page, sel));
  for (let i = 1; i < ys.length; i++)
    expect(ys[i], `${order[i]} below ${order[i - 1]}`).toBeGreaterThan(ys[i - 1] as number);
  // every label on its own line, the value on the next
  for (const sel of [".req-via", ".req-needs", ".req-message"]) {
    const l = await card.locator(`${sel} .field-label`).boundingBox();
    const v = await card.locator(`${sel} .field-value`).boundingBox();
    expect(l && v && v.y >= l.y + l.height - 1, sel).toBe(true);
  }
  // no duplicates: no second card, no source line in the header, no "Wrong?" prompt
  await expect(page.locator(".request-sheet .req-block:not(.req-chat)")).toHaveCount(1);
  await expect(page.locator(".request-sheet .req-head")).not.toContainText("AI agent");
  await expect(card).not.toContainText("Wrong?");
  await expect(card).not.toContainText("via a chat app or MCP");
});

test("the rating row: 👍 👎, More ▸ and Mark as junk on one line, vertically centred", async ({
  page,
}) => {
  const card = await openS1(page);
  const row = card.locator(".triage-row");
  const parts = [
    row.getByRole("button", { name: "Helpful", exact: true }),
    row.getByRole("button", { name: "Not helpful" }),
    row.getByRole("button", { name: "More ▸" }),
    row.getByRole("button", { name: "Mark as junk" }),
  ];
  const mids: number[] = [];
  for (const p of parts) {
    const b = await p.boundingBox();
    expect(b).not.toBeNull();
    mids.push((b?.y ?? 0) + (b?.height ?? 0) / 2);
  }
  for (const m of mids) expect(Math.abs(m - (mids[0] ?? 0))).toBeLessThanOrEqual(2);
  // Mark as junk sits at the right end of the row
  const junk = await parts[3]?.boundingBox();
  const rowBox = await row.boundingBox();
  expect(junk && rowBox && rowBox.x + rowBox.width - (junk.x + junk.width)).toBeLessThanOrEqual(4);
  // same behaviour as before: one tap marks it, the card says so, and it can be undone
  await parts[3]?.click();
  await expect(card.locator(".verdict").first()).toHaveText("Junk (manager)");
  await expect(card).toContainText("You marked this as junk.");
  await card.getByRole("button", { name: "Mark as real" }).click();
  await expect(card.locator(".verdict").first()).toHaveText("Real (manager)");
});

for (const vp of [
  { width: 1180, height: 820 },
  { width: 1600, height: 1000 },
]) {
  test(`More ▸ at ${vp.width}: Plan, then Pros above Cons in one column, the walk-in comparison, the crew footnote`, async ({
    page,
  }) => {
    await page.setViewportSize(vp);
    const card = await openS1(page);
    await expect(card.locator(".req-more")).toHaveCount(0);
    // one tap
    await card.getByRole("button", { name: "More ▸" }).click();
    const more = card.locator(".req-more");
    await expect(more.locator(".req-plan .field-label")).toHaveText("Plan");
    await expect(more.locator(".req-plan .field-value")).toHaveText(
      "Combine: tables 57–61, 63–66 into two long tables seating 22 (Garden Room + Library, divider open).",
    );
    const pros = await more.getByRole("list", { name: "Pros" }).boundingBox();
    const cons = await more.getByRole("list", { name: "Cons" }).boundingBox();
    expect(pros && cons).toBeTruthy();
    // one column: cons start below the last pro, at the same left edge
    expect((cons?.y ?? 0) >= (pros?.y ?? 0) + (pros?.height ?? 0)).toBe(true);
    expect(Math.abs((cons?.x ?? 0) - (pros?.x ?? 0))).toBeLessThanOrEqual(1);
    // the walk-in yes/no comparison, one tap away
    await expect(more.locator(".net-hero")).toHaveText("+22 booked vs up to ~24 possible walk-ins");
    await expect(more.locator(".net-held")).toHaveText("· held 5:00–6:30 PM");
    await expect(more.locator(".capacity-line")).toContainText(
      "Reservations moved 1 · cancelled 0",
    );
    await expect(more.locator(".crew-foot")).toHaveText(/^Crew build: ~\d+ min, starts ~5:28 PM$/);
    // gone from the card: the per-booking list, the per-table ready list, the room line
    await expect(card).not.toContainText("already on Fri");
    await expect(card.locator(".ready-list")).toHaveCount(0);
    await expect(card).not.toContainText("built by");
    const ys = [];
    for (const sel of [".req-plan", ".req-pros", ".req-cons", ".req-covers", ".crew-foot"])
      ys.push((await more.locator(sel).boundingBox())?.y ?? Number.NaN);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1] as number);
  });
}

test("taps to done: the 22-top is accepted in 2 taps (Accept → Accept · hold tables)", async ({
  page,
}) => {
  await openS1(page);
  const sheet = page.locator(".request-sheet");
  await sheet.getByRole("button", { name: "Accept", exact: true }).click();
  await sheet.getByRole("button", { name: "Accept · hold tables" }).click();
  await expect(page.locator(".accepted-result")).toContainText("crew plan applied");
});

test("an older request without the Request field reads 'not recorded'", async ({ page }) => {
  await page.route("**/api/requests", async (route) => {
    const res = await route.fetch();
    const book = (await res.json()) as { requests: Record<string, unknown>[] };
    for (const r of book.requests) delete r.via;
    await route.fulfill({ response: res, json: book });
  });
  const card = await openS1(page);
  await expect(card.locator(".req-via .field-value")).toHaveText("not recorded");
});
