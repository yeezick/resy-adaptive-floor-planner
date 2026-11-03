import { expect, test, type Page } from "@playwright/test";

const hostButton = (page: Page, name: string) =>
  page.getByRole("group", { name: "Host actions" }).getByRole("button", { name, exact: true });

async function openFloor(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.clear();
    } catch {
      /* private mode */
    }
  });
  await page.goto("/");
  await expect(page.locator("svg.floor").first()).toBeVisible();
}

test("not-affiliated banner is on every page", async ({ page }) => {
  for (const path of ["/", "/evals"]) {
    await page.goto(path);
    await expect(page.getByText(/not affiliated with/i).first()).toBeVisible();
  }
});

test("floor shows the meal-phase key and seated tables", async ({ page }) => {
  await openFloor(page);
  await page.getByRole("tab", { name: "Dining room" }).click();
  const key = page.getByLabel("Meal phase key").first();
  await expect(key).toBeVisible();
  for (const phase of ["Seated", "Drinks", "Apps", "Entrées", "Dessert", "Check"]) {
    await expect(key).toContainText(phase);
  }
});

test("walk-in for 8 suggests tables without seating anyone", async ({ page }) => {
  await openFloor(page);
  await hostButton(page, "+ Walk-in").click();
  await page.locator(".walkin .size-grid").getByRole("button", { name: "8", exact: true }).click();
  const suggested = page.locator(".suggested");
  await expect(suggested).toBeVisible();
  await expect(suggested).toContainText("T41");
});

test("assistant renders ranked recommendations and never auto-seats", async ({ page }) => {
  await page.route("**/api/agent", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        traceId: "e2e-stub",
        promptVersion: "e2e",
        model: "e2e-stub",
        answer: "T41 frees in about 11 minutes.",
        clarifyingQuestion: null,
        recommendations: [
          {
            rank: 1,
            tables: ["T41"],
            seats: 8,
            waitMin: 11,
            reasoning: "Exact fit.",
            tradeoffs: [],
          },
        ],
        toolCalls: [{ name: "find_tables_for_party", ok: true }],
        validator: { rejects: 0, notes: [] },
        metrics: { costUsd: 0, latencyMs: 0, toolTurns: 1, validatorRejects: 0, calls: [] },
      }),
    }),
  );
  await openFloor(page);
  const seatedBefore = await page
    .locator(".rail")
    .getByText(/parties ·/)
    .allTextContents();
  await hostButton(page, "Assistant").click();
  await page.locator("#agent-input").fill("Party of 8 — where, and how soon?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.locator(".rec-card").first()).toContainText("T41");
  await expect(page.getByText(/never auto-seat/i)).toBeVisible();
  expect(
    await page
      .locator(".rail")
      .getByText(/parties ·/)
      .allTextContents(),
  ).toEqual(seatedBefore);
});

test("generate tonight's layout places parties and explains what can't fit", async ({ page }) => {
  await openFloor(page);
  await page.locator(".room-select select").selectOption("heavy-saturday");
  await expect(page.locator(".room-name")).toBeVisible();
  await hostButton(page, "Shift setup").click();
  const times = page.locator(".tonight input[type=time]");
  await times.nth(0).fill("17:00");
  await times.nth(1).fill("21:00");
  await page.getByRole("button", { name: "Generate tonight's layout" }).click();
  await expect(page.locator(".proposal")).toBeVisible();
  await expect(page.locator('[aria-label="Crew build list"]')).toBeVisible();
  await expect(page.locator('[aria-label="Can\'t fit"]')).toBeVisible();
});

test("editor opens the base layout and inspects a table", async ({ page }) => {
  await openFloor(page);
  await hostButton(page, "Shift setup").click();
  await page
    .locator(".layout-list li")
    .first()
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await expect(page.locator(".editor-canvas")).toBeVisible();
  await page.locator('.editor-canvas g[data-id="T41"]').click();
  await expect(page.locator(".inspector")).toContainText("T41");
});

test("/evals page renders", async ({ page }) => {
  await page.goto("/evals");
  await expect(page.locator(".evals h1")).toBeVisible();
});
