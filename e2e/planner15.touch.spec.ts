import { expect, test } from "@playwright/test";

// Coarse pointer, iPad landscape: the AI Planner's actions and ratings are ≥44 × 44.
test("AI Planner actions, ratings, mic and review controls are ≥44 × 44", async ({ page }) => {
  await page.route("**/api/agent", (route) => route.abort());
  await page.goto("/?scenario=walkin-8-peak");
  await expect(page.locator(".rec-card")).toHaveCount(3);
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
  for (const sel of [
    ".rec-go",
    ".bubble.assistant .fb-thumb",
    ".mic-btn",
    ".composer button[type=submit]",
    ".panel-head .new-chat",
  ])
    await check(sel);
  // the rating icon itself stays small and muted
  const icon = await page.locator(".bubble.assistant .fb-thumb svg").first().boundingBox();
  expect(icon && icon.width).toBeLessThanOrEqual(16);
  await page.locator(".rec-go").first().click();
  for (const sel of [".review-go", ".review-party button", ".review-row .chips button"])
    await check(sel);
});
