import { expect, test } from "@playwright/test";

// Coarse pointer: Send keeps its 44 × 44 target, and the move request gets its own reply by touch.
test("request chat by touch: Send ≥44 × 44 while pending; a table move is answered on its turn", async ({
  page,
}) => {
  await page.route("**/api/requests/*/triage", (route) => route.abort());
  await page.route("**/api/requests/*/chat", () => {
    // never answers: the turn stays working
  });
  await page.goto("/?scenario=party-22-agent");
  await page.locator(".request-sheet").getByRole("button", { name: "Discuss" }).tap();
  const box = page.getByRole("textbox", { name: "Message about this request" });
  await box.fill("pull table 56 into the Library");
  await page.locator(".req-chat button[type=submit]").tap();
  const out = page.locator(".req-chat .chat-log > li:not(.chat-noted) .chat-out");
  await expect(out.nth(0)).toContainText("I can't move tables between rooms yet.");
  await box.fill("Headcount is now 26");
  await page.locator(".req-chat button[type=submit]").tap();
  await expect(out.nth(1).locator(".typing-dots")).toBeVisible();
  const send = await page.locator(".req-chat button[type=submit]").boundingBox();
  expect(send && send.width >= 44 && send.height >= 44).toBe(true);
  await expect(out.nth(0)).toContainText("I can't move tables between rooms yet.");
});
