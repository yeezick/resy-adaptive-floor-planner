import { expect, test } from "@playwright/test";

// Touch project only (coarse pointer, iPad landscape): the request footer stays one row of ≥44 px buttons.
test("request footer: Decline · Message · Discuss · Accept on one row, each at least 44 × 44", async ({
  page,
}) => {
  await page.route("**/api/requests/*/triage", (route) => route.abort());
  await page.goto("/?scenario=party-22-agent");
  const buttons = page.locator(".decision-footer .btn-row button");
  await expect(buttons).toHaveText(["Decline", "Message", "Discuss", "Accept"]);
  const boxes = await buttons.evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    }),
  );
  for (const b of boxes) {
    expect(b.w).toBeGreaterThanOrEqual(44);
    expect(b.h).toBeGreaterThanOrEqual(44);
    expect(Math.abs(b.y - (boxes[0]?.y ?? 0))).toBeLessThanOrEqual(2);
  }
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  const note = page.getByRole("textbox", { name: "Add a note for the guest or the log" });
  const box = await note.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});
