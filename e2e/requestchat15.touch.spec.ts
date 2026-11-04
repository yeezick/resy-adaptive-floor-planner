import { expect, test } from "@playwright/test";

// Coarse pointer, iPad landscape: the request review and chat controls are ≥44 × 44.
test("request review and chat controls are ≥44 × 44", async ({ page }) => {
  await page.route("**/api/requests/*/chat", (route) => route.abort());
  await page.goto("/?scenario=party-22-agent");
  const check = async (sel: string) => {
    const boxes = await page.locator(sel).evaluateAll((els) =>
      els
        .filter((e) => (e as HTMLElement).offsetParent !== null)
        .map((e) => e.getBoundingClientRect())
        .map((r) => ({ w: Math.round(r.width), h: Math.round(r.height) })),
    );
    expect(boxes.length, sel).toBeGreaterThan(0);
    for (const b of boxes) {
      expect(b.w, sel).toBeGreaterThanOrEqual(44);
      expect(b.h, sel).toBeGreaterThanOrEqual(44);
    }
  };
  await page.locator(".request-sheet").getByRole("button", { name: "Discuss" }).click();
  for (const sel of [".req-chat .mic-btn", ".chat-form-foot button[type=submit]"]) await check(sel);
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  for (const sel of [
    ".review-go",
    ".review-party button",
    ".review-row .chips button",
    ".review-time select",
    ".review-range input",
    ".review-note input",
  ])
    await check(sel);
});
