import { expect, test, type Page } from "@playwright/test";

// The AI Planner as a host uses it mid-service: option → review → Seat/Waitlist, results in the thread.
async function openS3(page: Page) {
  // the scenario is recorded: any live AI Planner call is a failure here
  let calls = 0;
  await page.route("**/api/agent", (route) => {
    calls++;
    return route.abort();
  });
  await page.goto("/?scenario=walkin-8-peak");
  await expect(page.locator(".rec-card")).toHaveCount(3);
  return () => calls;
}

test.describe("AI Planner options", () => {
  test("cards lead with the reason tag and the wait pill; one filled action, no extra choosers", async ({
    page,
  }) => {
    await openS3(page);
    const first = page.locator(".rec-card").first();
    await expect(first.locator(".rec-head")).toContainText("#1table 41· Fastest~11 min");
    await expect(first.locator(".wait-pill")).toHaveText("~11 min");
    await expect(page.locator(".rec-card").nth(1).locator(".rec-tag")).toHaveText(
      "· Quiet section",
    );
    await expect(first.getByRole("button", { name: "Waitlist · ~11 min" })).toHaveClass(/primary/);
    for (const i of [1, 2])
      await expect(page.locator(".rec-card").nth(i).locator(".rec-go")).toHaveClass(/outline/);
    const panel = page.locator(".side-col");
    await expect(
      panel.getByRole("button", { name: /Select tables|Hide on floor|Show on floor|^Join / }),
    ).toHaveCount(0);
    await expect(panel.getByRole("group", { name: "Example prompts" })).toHaveCount(0);
    // the pill sits top-right, on the header's line
    const head = await first.locator(".rec-head").boundingBox();
    const pill = await first.locator(".wait-pill").boundingBox();
    expect(pill && head && pill.y + pill.height <= head.y + head.height + 1).toBe(true);
    expect(pill && head && pill.x + pill.width >= head.x + head.width - 2).toBe(true);
  });

  test("two taps: option → review → Waitlist; the thread shows the result, the others clear, Undo reverts", async ({
    page,
  }) => {
    await openS3(page);
    await page
      .locator(".rec-card")
      .first()
      .getByRole("button", { name: "Waitlist · ~11 min" })
      .click();
    const review = page.locator(".review");
    await expect(page.locator("#panel-title")).toHaveText("Review and confirm");
    await expect(review).toContainText("table 41");
    await expect(review.locator(".fit-pill")).toContainText("capacity fit ✓");
    await expect(review.locator(".review-count")).toContainText("8");
    await review.getByRole("button", { name: "Waitlist · ~11 min" }).click();

    await expect(page.locator("#panel-title")).toContainText("AI Planner");
    const done = page.locator(".rec-done");
    await expect(done).toContainText("Party of 8 waitlisted · quoted ~11 min");
    await expect(page.locator(".rec-card")).toHaveCount(1);
    await expect(page.locator(".recs")).toContainText("2 other options cleared");
    // inside the panel: no toast
    await expect(page.locator(".toast")).toHaveCount(0);
    await expect(page.locator(".floor-highlight-tag")).not.toContainText("AI option");
    await expect(page.locator(".rail")).toContainText("quoted ~11 min · for table 41");

    await done.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator(".rec-card")).toHaveCount(3);
    await expect(page.locator(".rail")).not.toContainText("quoted ~11 min");
  });

  test("the review screen re-runs the capacity check on an edit and shows the change", async ({
    page,
  }) => {
    await openS3(page);
    await page.locator(".rec-card").first().locator(".rec-go").click();
    const review = page.locator(".review");
    await review.getByRole("button", { name: "One more guest" }).click();
    await review.getByRole("button", { name: "One more guest" }).click();
    await expect(review.locator(".review-diff")).toContainText("Party: 8 → 10");
    await expect(review.locator(".review-diff")).toContainText("capacity fit ✓ →");
    // an edit to an illegal set (short seats) can't be waitlisted
    await expect(review.getByRole("button", { name: /^Waitlist/ })).toBeDisabled();
    await review.getByRole("button", { name: "One fewer guest" }).click();
    await review.getByRole("button", { name: "One fewer guest" }).click();
    await expect(review.getByRole("button", { name: /^Waitlist/ })).toBeEnabled();
    await review.getByRole("button", { name: "‹ Back to AI Planner" }).click();
    await expect(page.locator(".rec-card")).toHaveCount(3);
    await expect(page.locator(".rec-done")).toHaveCount(0);
  });

  test("“go ahead with option 1” answers with the action on this device; no model call", async ({
    page,
  }) => {
    const calls = await openS3(page);
    await page.locator("#agent-input").fill("go ahead with option 1");
    await page.keyboard.press("Enter");
    const action = page.getByRole("button", { name: "Waitlist party of 8 · table 41 · ~11 min" });
    await expect(action).toBeVisible();
    await action.click();
    await expect(page.locator(".review")).toContainText("table 41");
    expect(calls()).toBe(0);
  });

  test("words that match more than one option get a question; the combine refusal still goes to the AI", async ({
    page,
  }) => {
    const calls = await openS3(page);
    await page.locator("#agent-input").fill("put them on the waitlist");
    await page.keyboard.press("Enter");
    await expect(page.locator(".bubble.assistant").last()).toContainText("Which one?");
    await expect(page.locator(".local-actions button")).toHaveCount(3);
    await page.locator("#agent-input").fill("combine tables 1 and 4, rotate them");
    await page.keyboard.press("Enter");
    await expect.poll(calls).toBe(1);
  });

  test("New chat starts a fresh thread; the message box is pinned and focused", async ({
    page,
  }) => {
    await openS3(page);
    const box = page.locator("#agent-input");
    await expect(box).toBeFocused();
    const r = await box.boundingBox();
    const vh = page.viewportSize()?.height ?? 0;
    expect(r && r.y + r.height).toBeLessThanOrEqual(vh);
    await page.locator(".panel-head").getByRole("button", { name: "New chat" }).click();
    await expect(page.locator(".rec-card")).toHaveCount(0);
    await expect(page.locator(".bubble.user")).toHaveCount(0);
  });

  test("the mic is a labelled future idea: it does nothing but explain", async ({ page }) => {
    await openS3(page);
    const mic = page.getByRole("button", { name: "Dictate (future idea)" });
    await expect(mic).toHaveAttribute("aria-disabled", "true");
    await expect(mic).toHaveAttribute("title", /Future: dictate instead of typing/);
    await mic.click({ force: true }); // aria-disabled: Playwright would wait for it to enable
    await expect(page.locator(".mic-hint")).toBeVisible();
    await expect(page.locator(".bubble.user")).toHaveCount(1);
  });

  test("Table details stacks over the thread; Back returns to it", async ({ page }) => {
    await openS3(page);
    await page.locator("[data-id='T41']").first().click();
    await expect(page.locator("#panel-title")).toHaveText("Table details");
    await page.getByRole("button", { name: "‹ Back to AI Planner" }).click();
    await expect(page.locator("#panel-title")).toContainText("AI Planner");
    await expect(page.locator(".rec-card")).toHaveCount(3);
    // Close from details also returns to the thread
    await page.locator("[data-id='T41']").first().click();
    await page.locator(".panel-head").getByRole("button", { name: "Close" }).click();
    await expect(page.locator("#panel-title")).toContainText("AI Planner");
  });

  test("the demo info callout and the Proposed feature tag", async ({ page }) => {
    await openS3(page);
    const note = page.locator(".principle.info-callout");
    await expect(note).toContainText("ⓘ");
    const tag = page.locator(".panel-head .proposed-tag");
    const bg = await tag.evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    // outside a scenario the demo callout is not shown
    await page.goto("/");
    await page.locator(".cb-actions").getByRole("button", { name: "AI Planner" }).click();
    await expect(page.locator(".principle")).toHaveCount(0);
  });
});
