import { expect, test, type Page } from "@playwright/test";

// The request chat in plain language, and Accept through "Review and confirm" (s1 = party-22-agent).
async function openDiscuss(page: Page) {
  let calls = 0;
  await page.route("**/api/requests/*/chat", (route) => {
    calls++;
    return route.abort();
  });
  await page.goto("/?scenario=party-22-agent");
  await page.locator(".request-sheet").getByRole("button", { name: "Discuss" }).click();
  const chat = page.getByRole("region", { name: "Adjust this request" });
  return { chat, calls: () => calls };
}
const say = async (page: Page, text: string) => {
  const box = page.getByRole("textbox", { name: "Message about this request" });
  await box.fill(text);
  await box.press("Enter");
};

test.describe("request chat", () => {
  test("natural language only: no manual controls, needs noted first, a large box and a future mic", async ({
    page,
  }) => {
    const { chat } = await openDiscuss(page);
    for (const label of ["First table", "Last table", "Headcount", "Time"])
      await expect(chat.getByLabel(label)).toHaveCount(0);
    await expect(chat.getByRole("group", { name: "Needs" })).toHaveCount(0);
    await expect(chat.locator(".chat-noted .chat-out").first()).toHaveText(
      "Noted: wheelchair + stroller, aisle clearance kept.",
    );
    // the plan splits two rooms: the one-room answer (with storage) is offered up front
    await expect(chat.locator(".chat-offer")).toHaveText(
      "This plan spans Garden Room + Library. No single room fits 22, even with tables from storage (closest: Garden Room, 20 seats).",
    );
    const box = chat.getByRole("textbox", { name: "Message about this request" });
    await expect(box).toBeFocused();
    expect(await box.evaluate((e) => e.tagName)).toBe("TEXTAREA");
    await expect(chat.getByRole("button", { name: "Dictate (future idea)" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("“a single table for all 22” gets a plain answer and the nearest plan on the floor; no model call", async ({
    page,
  }) => {
    const { chat, calls } = await openDiscuss(page);
    await say(
      page,
      "The guest may want a single table for all 22 guests. Where could we find the space?",
    );
    const last = chat.locator(".chat-log > li").last();
    await expect(last).toContainText(
      "No single room fits 22, even with tables from storage (closest: Garden Room, 20 seats). The nearest is the current plan: Garden Room + Library with the divider open.",
    );
    await expect(page.locator(".floor-highlight-tag")).toContainText(
      "Nearest · Garden Room + Library",
    );
    expect(calls()).toBe(0);
  });

  test("“bring tables from the back” names storage; a need already set says “Already covered”", async ({
    page,
  }) => {
    const { chat, calls } = await openDiscuss(page);
    await say(page, "bring tables from the back if available");
    await expect(chat.locator(".chat-log > li").last()).toContainText(
      /Storage tonight: \d+ of 6 spare tables free, \d+ of 6 extenders, \d+ of 40 chairs\./,
    );
    await say(page, "make room for the wheelchair");
    await expect(chat.locator(".chat-log > li").last()).toContainText(
      /Already covered: wheelchair \+ stroller, aisle \d+ in \(needs \d+ in\)\./,
    );
    expect(calls()).toBe(0);
  });

  test("an answer that takes over 8 s ends in a plain error", async ({ page }) => {
    test.setTimeout(30_000);
    await page.route("**/api/requests/*/chat", () => {
      // never answers
    });
    await page.goto("/?scenario=party-22-agent");
    await page.locator(".request-sheet").getByRole("button", { name: "Discuss" }).click();
    await say(page, "headcount is now 26");
    await expect(page.locator(".chat-log > li").last()).toContainText("That took too long", {
      timeout: 12_000,
    });
  });

  test("s4: the proposal is numbered and shows covers and hold before → after", async ({
    page,
  }) => {
    await page.goto("/?scenario=request-chat");
    const diff = page.getByRole("group", { name: "Change proposed in chat" });
    await expect(diff).toContainText("Proposed changes");
    await expect(diff.locator("ol.chat-diff-rows > li")).toHaveText(["Tables: any → 30–50"]);
    await expect(diff.locator(".chat-diff-impact")).toContainText(
      "+22 booked vs up to ~24 possible walk-ins · held 5:00–6:30 PM → no fit",
    );
    await expect(diff.getByRole("button", { name: /Confirm/ })).toHaveCount(0);
  });
});

test.describe("Accept through Review and confirm", () => {
  test("two taps: Accept → Accept · hold tables; tables held and crew plan applied; one Undo", async ({
    page,
  }) => {
    await page.goto("/?scenario=party-22-agent");
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    const review = page.locator(".review");
    await expect(review).toContainText("Sam Whitaker");
    await expect(review.locator(".review-count")).toContainText("22");
    await expect(review).toContainText("tables 57–61 and 63–66");
    await expect(review.locator(".fit-pill")).toHaveText("capacity fit ✓");
    await expect(review.locator(".review-impact")).toHaveText(
      "+22 booked vs up to ~24 possible walk-ins · held 5:00–6:30 PM",
    );
    // the Friday request on the Friday floor: no date
    await expect(review.locator(".review-date")).toHaveCount(0);
    // one screen, no scrolling at 1180×820 / 1440×900
    const go = await review.getByRole("button", { name: "Accept · hold tables" }).boundingBox();
    expect(go && go.y + go.height).toBeLessThanOrEqual(page.viewportSize()?.height ?? 0);
    await review.getByRole("button", { name: "Accept · hold tables" }).click();
    await expect(page.locator(".accepted-result")).toContainText(
      "Accepted · tables held · crew plan applied",
    );
    await expect(page.locator(".cb-stats")).toContainText("9 from 5:00 PM");
    await page.locator(".accepted-result").getByRole("button", { name: "Undo" }).click();
    await expect(page.locator(".request-sheet .req-actions")).toContainText("Accept");
  });

  test("an edit re-runs the capacity check and shows the change; Back keeps it on the request", async ({
    page,
  }) => {
    await page.goto("/?scenario=party-22-agent");
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    const review = page.locator(".review");
    await review.getByRole("button", { name: "quiet corner" }).click();
    await expect(review.locator(".review-diff")).toContainText("needs quiet");
    await review.getByLabel("Add a note for the crew").fill("birthday cake");
    await review.getByLabel("Add a note for the crew").press("Enter");
    await expect(review.getByRole("button", { name: "Remove note birthday cake" })).toBeVisible();
    await review.getByRole("button", { name: "‹ Back to the request" }).click();
    await expect(page.locator(".request-sheet .changed-line")).toContainText("Changed by hand");
  });

  test("a request for another night shows its date on the review screen", async ({ page }) => {
    await page.goto("/");
    const rail = page.getByRole("region", { name: /Requests/ });
    await rail.locator(".row-request .row-btn", { hasText: "AI agent" }).first().click();
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(page.locator(".review .review-date")).toHaveText("Fri, Nov 6");
  });
});
