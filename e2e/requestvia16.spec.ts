import { expect, test } from "@playwright/test";

// The Request field: who sent a large-party request and through what ("AI agent · MCP"), on the review screen
// and on /activity. Scenario links only: no model call.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/requests/*/triage", (route) => route.abort());
  await page.route("**/api/requests/*/chat", (route) => route.abort());
  await page.route("**/api/agent", (route) => route.abort());
});

test("the review screen names who sent the request: label on its own line, value on the next", async ({
  page,
}) => {
  await page.goto("/?scenario=party-22-agent");
  const sheet = page.locator(".request-sheet");
  await sheet.getByRole("button", { name: "Accept", exact: true }).click();
  const field = sheet.locator(".review-via");
  await expect(field.locator(".field-label")).toHaveText("Request");
  await expect(field.locator(".field-value")).toHaveText("AI agent · MCP");
  const label = await field.locator(".field-label").boundingBox();
  const value = await field.locator(".field-value").boundingBox();
  expect(label && value && value.y >= label.y + label.height - 1).toBe(true);
});

test("/activity shows the Request field for request rows", async ({ page }) => {
  await page.goto("/?scenario=party-22-agent");
  await expect(page.locator(".request-sheet .req-title")).toContainText("Sam Whitaker");
  await page.getByRole("link", { name: "Activity" }).click();
  const table = page.locator(".activity-table");
  await expect(table.getByRole("columnheader", { name: "Request" })).toBeVisible();
  await expect(table).toContainText("AI agent · MCP");
  await expect(table).toContainText("AI agent · chat app (ChatGPT)");
});
