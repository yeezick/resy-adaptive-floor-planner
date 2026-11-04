import { expect, test } from "@playwright/test";

// Touch project only (coarse pointer, iPad landscape): the one request card fits above the footer with no
// scrolling, and its rating row's targets are at least 44 × 44.
test("touch: header, Request, Needs, guest message, Take it and Accept show without scrolling", async ({
  page,
}) => {
  await page.route("**/api/requests/*/triage", (route) => route.abort());
  await page.route("**/api/requests/*/chat", (route) => route.abort());
  await page.goto("/?scenario=party-22-agent");
  const sheet = page.locator(".request-sheet");
  await expect(sheet.locator(".req-overview")).toContainText("Family reunion");
  const footerTop = (await sheet.locator(".decision-footer").boundingBox())?.y ?? 0;
  for (const sel of [".req-title", ".req-via", ".req-needs", ".req-message", ".take-it"]) {
    await expect(sheet.locator(sel)).toBeInViewport({ ratio: 1 });
    const b = await sheet.locator(sel).boundingBox();
    expect(b && b.y + b.height, sel).toBeLessThanOrEqual(footerTop);
  }
  await expect(sheet.getByRole("button", { name: "Accept" })).toBeInViewport({ ratio: 1 });
  const row = sheet.locator(".req-card .triage-row");
  for (const name of ["Helpful", "Not helpful", "More ▸", "Mark as junk"]) {
    const b = await row.getByRole("button", { name, exact: true }).boundingBox();
    expect(b?.height ?? 0, name).toBeGreaterThanOrEqual(44);
    expect(b?.width ?? 0, name).toBeGreaterThanOrEqual(44);
  }
});
