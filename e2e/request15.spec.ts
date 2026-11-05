import { expect, test, type Page } from "@playwright/test";

// The large-party request sheet: walk-in capacity wording, a short card per section, one footer row, and a
// decline note. Scenario links only: no model call.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/requests/*/triage", (route) => route.abort());
  await page.route("**/api/requests/*/chat", (route) => route.abort());
  await page.route("**/api/agent", (route) => route.abort());
});

async function openS1(page: Page) {
  await page.goto("/?scenario=party-22-agent");
  const sheet = page.locator(".request-sheet");
  await expect(sheet.locator(".req-title")).toContainText("Sam Whitaker · party of 22");
  return sheet;
}

test("the capacity check reads booked covers vs walk-in capacity, and recommends taking it by rule", async ({
  page,
}) => {
  const sheet = await openS1(page);
  // the rule's line is on the card; the covers comparison is one tap away, inside More
  await expect(sheet.locator(".take-it .take-it-text")).toHaveText(
    "Take it: a booked 22 beats uncertain walk-ins",
  );
  await sheet.getByRole("button", { name: "More ▸" }).click();
  await expect(sheet.locator(".net-hero")).toHaveText("+22 booked vs up to ~24 possible walk-ins");
  await expect(sheet.locator(".net-held")).toHaveText("· held 5:00–6:30 PM");
  await expect(sheet.locator(".capacity-line")).toHaveText(
    "Booked +22 (guaranteed) · Walk-in capacity held: up to ~24 (only if every held seat would turn) · Reservations moved 1 · cancelled 0",
  );
  // no "net −2" headline and no "covers lost" anywhere on the sheet
  await expect(sheet).not.toContainText("Net −2");
  await expect(sheet).not.toContainText("covers lost");
});

test("a request with no capacity fit gets no 'Take it' line", async ({ page }) => {
  await page.goto("/");
  const rail = page.getByRole("region", { name: /Requests/ });
  // the Thursday 30-top that wants a private room at 7:30 PM
  await rail.locator(".row-request .row-btn").nth(2).click();
  const sheet = page.locator(".request-sheet");
  await expect(sheet.locator(".cant-fit-line")).toBeVisible();
  await expect(sheet.locator(".take-it")).toHaveCount(0);
});

test("one card: a short summary, Needs and the guest message up front, the rest behind More ▸", async ({
  page,
}) => {
  const sheet = await openS1(page);
  const card = sheet.locator(".req-card");
  await expect(sheet.locator(".req-block:not(.req-chat)")).toHaveCount(1);
  await expect(card.locator(".req-overview li")).toHaveCount(1);
  await expect(card.locator(".req-overview")).toContainText("Family reunion");
  // one font step larger than the 14px body text
  const size = await card
    .locator(".req-overview")
    .evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  expect(size).toBeGreaterThanOrEqual(16);
  await expect(card.locator(".req-needs")).toContainText("Step-free access");
  await expect(card.getByRole("button", { name: "Mark as junk" })).toBeVisible();
  // pros and cons are on the card without expanding; More holds the plan
  await expect(card.getByRole("list", { name: "Pros" })).toBeAttached();
  await expect(card.locator(".req-plan")).toHaveCount(0);
  await card.getByRole("button", { name: "More ▸" }).click();
  await expect(card.locator(".req-plan")).toBeVisible();
});

test("the footer is one row: Decline · Message · Discuss · Accept, Accept the only filled button", async ({
  page,
}) => {
  const sheet = await openS1(page);
  const row = sheet.locator(".decision-footer .btn-row");
  const buttons = row.locator("button");
  await expect(buttons).toHaveText(["Decline", "Message", "Discuss", "Accept"]);
  const boxes = await buttons.evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { y: Math.round(r.y), bottom: Math.round(r.bottom), right: Math.round(r.right) };
    }),
  );
  const first = boxes[0];
  for (const b of boxes) expect(Math.abs(b.y - (first?.y ?? 0))).toBeLessThanOrEqual(2);
  // nothing spills past the panel
  const panel = await page.locator(".side-col").boundingBox();
  for (const b of boxes) expect(b.right).toBeLessThanOrEqual((panel?.x ?? 0) + (panel?.width ?? 0));
  await expect(row.locator("button.primary")).toHaveText(["Accept"]);
  // Discuss: surface fill, accent outline, accent sparkle (not filled)
  const discuss = row.getByRole("button", { name: "Discuss" });
  await expect(discuss.locator("svg.sparkle")).toBeVisible();
  const look = await discuss.evaluate((e) => {
    const s = getComputedStyle(e);
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    return {
      border: s.borderTopColor,
      bw: parseFloat(s.borderTopWidth),
      accent,
      bg: s.backgroundColor,
    };
  });
  expect(look.bw).toBeGreaterThanOrEqual(1);
  expect(look.border).not.toBe("rgba(0, 0, 0, 0)");
  const acceptBg = await row
    .getByRole("button", { name: "Accept" })
    .evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(look.bg).not.toBe(acceptBg);
});

test("at iPad width the Accept preview sits on its own line above the buttons", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  const sheet = await openS1(page);
  const preview = await sheet.locator(".decision-footer .feedforward").boundingBox();
  const row = await sheet.locator(".decision-footer .btn-row").boundingBox();
  expect(preview && row && preview.y + preview.height).toBeLessThanOrEqual(row?.y ?? 0);
});

test("at 1180 × 820 the header, Request, Needs, guest message, Recommendation and Accept show without scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  const sheet = await openS1(page);
  const footerTop = (await sheet.locator(".decision-footer").boundingBox())?.y ?? 0;
  for (const l of [
    sheet.locator(".req-title"),
    sheet.locator(".req-via"),
    sheet.locator(".req-needs"),
    sheet.locator(".req-message"),
    sheet.locator(".take-it"),
    sheet.locator(".fit-pill"),
    sheet.getByRole("button", { name: "Accept" }),
  ])
    await expect(l).toBeInViewport({ ratio: 1 });
  for (const sel of [".req-via", ".req-needs", ".req-message", ".take-it"]) {
    const b = await sheet.locator(sel).boundingBox();
    expect(b && b.y + b.height, sel).toBeLessThanOrEqual(footerTop);
  }
  // the page never scrolls. Pros and Cons are on the card without expanding (Erick, 17:47) and run on below
  // the sticky footer: the sheet scrolls by about the length of the cons list (~200 px measured on macOS).
  // Everything above, and Accept, needs no scrolling.
  const scroll = await page.evaluate(() => {
    const side = document.querySelector(".side-col") as HTMLElement;
    const inner = [...side.querySelectorAll<HTMLElement>("*")].filter(
      (e) =>
        e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY),
    );
    return {
      page: document.documentElement.scrollHeight - window.innerHeight,
      overflow: inner.map((e) => e.scrollHeight - e.clientHeight),
    };
  });
  expect(scroll.page).toBeLessThanOrEqual(0);
  expect(scroll.overflow.length).toBeLessThanOrEqual(1);
  for (const px of scroll.overflow) expect(px).toBeLessThanOrEqual(320);
  const pros = await sheet.getByRole("list", { name: "Pros" }).boundingBox();
  const take = await sheet.locator(".take-it").boundingBox();
  expect(pros && take && pros.y > take.y).toBe(true);
});

test("Decline takes an optional note: saved with the decision and shown on /activity", async ({
  page,
}) => {
  const sheet = await openS1(page);
  await sheet.getByRole("button", { name: "Decline", exact: true }).click();
  await sheet.getByRole("radio", { name: /Other/ }).check();
  const note = sheet.getByRole("textbox", { name: "Add a note for the guest or the log" });
  await note.fill("Private event in the Garden Room that night");
  await sheet.getByRole("button", { name: "Decline: other" }).click();
  await expect(sheet.locator(".req-decided")).toContainText("Declined: other");
  await expect(sheet.locator(".req-decided")).toContainText(
    "Private event in the Garden Room that night",
  );
  await page.getByRole("link", { name: "Activity" }).click();
  await expect(page.locator(".activity-table")).toContainText(
    "Private event in the Garden Room that night",
  );
});

test("the decline note can go into the draft reply in one tap", async ({ page }) => {
  const sheet = await openS1(page);
  await sheet.getByRole("button", { name: "Decline", exact: true }).click();
  await sheet
    .getByRole("textbox", { name: "Add a note for the guest or the log" })
    .fill("We could host 22 on Sunday instead.");
  await sheet.getByRole("button", { name: "Message guest" }).click();
  const reply = sheet.getByRole("textbox", { name: /Draft reply/ });
  await expect(reply).not.toContainText("Sunday");
  await sheet.getByRole("button", { name: "Insert note" }).click();
  await expect(reply).toHaveValue(/We could host 22 on Sunday instead\.$/);
  // once in, it can't be added twice; the sheet says it went in as written
  await expect(sheet.getByRole("button", { name: "Insert note" })).toBeDisabled();
  await expect(sheet).toContainText("Your note is added as you wrote it.");
  expect((await reply.inputValue()).split("Sunday").length).toBe(2);
});
