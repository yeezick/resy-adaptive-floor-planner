import { expect, test, type Page } from "@playwright/test";

import type { AgentResponse } from "../src/shared/api";

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
  await expect(suggested).toContainText("table 41");
  // table numbers never carry the fixture's "T" prefix
  await expect(suggested).not.toContainText(/\bT\d/);
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
      } satisfies AgentResponse),
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
  await expect(page.locator(".rec-card").first()).toContainText("table 41");
  await expect(page.locator(".answer")).toHaveText("Table 41 frees in about 11 minutes.");
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
  await expect(page.locator('[aria-label="No capacity fit"]')).toBeVisible();
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
  await expect(page.locator(".inspector")).toContainText("Table 41");
});

test("/evals page renders", async ({ page }) => {
  await page.goto("/evals");
  await expect(page.locator(".evals h1")).toBeVisible();
});

test("request inbox: triage, capacity fit, accept opens that night's plan", async ({ page }) => {
  await page.route("**/api/requests/*/triage", (route) => {
    const id = /requests\/(Q\d+)\//.exec(route.request().url())?.[1] ?? "Q0";
    const junk = id === "Q4";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        requestId: id,
        traceId: `e2e-${id}`,
        promptVersion: "e2e",
        model: "e2e-stub",
        verdict: junk ? "junk" : "real",
        reason: junk ? "Asks for free food." : "Specific date, time and headcount.",
        summary: [`Stub line one for ${id}.`, "Stub line two."],
        escalated: false,
        validatorRejects: 0,
        input: { sha256: "e2e0000000000000", length: 10 },
        metrics: { costUsd: 0, latencyMs: 1, calls: [] },
      }),
    });
  });
  await openFloor(page);
  const rail = page.getByRole("region", { name: /Requests/ });
  await expect(rail).toContainText("Proposed feature");
  await expect(rail.locator(".row-request")).toHaveCount(6);
  for (const label of ["Resy app", "AI agent", "Walk-in"]) await expect(rail).toContainText(label);
  await expect(rail).toContainText("Likely junk");

  // the 30-top can't have a private room at 19:30: Accept stays disabled, the reason is one line
  await rail.locator(".row-request .row-btn").nth(2).click();
  await expect(page.locator(".cant-fit-line")).toContainText("earliest 20:30");
  await expect(page.getByRole("button", { name: /Accept/ })).toBeDisabled();
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  await page.getByRole("button", { name: "Decline for capacity fit" }).click();
  await expect(page.locator(".req-decided")).toContainText("Declined for capacity fit");

  // the 22-top fits: Accept opens Friday's plan with the party in focus
  await rail.locator(".row-request .row-btn").nth(1).click();
  const sheet = page.locator(".request-sheet");
  await expect(sheet.locator(".req-title")).toHaveText(
    "Sam Whitaker, party of 22 · Fri 18:30 (in 3h 30m)",
  );
  await expect(sheet.locator(".req-overview")).toContainText("Stub line one for Q2.");
  await expect(sheet).toContainText("AI agent (chat app or MCP)");
  await expect(sheet.getByText("Capacity fit", { exact: true }).last()).toBeVisible();
  await expect(sheet.locator(".crew-note")).toHaveText(/^(Open|Combine|Set) .*tables? \d/);
  await expect(sheet).not.toContainText(/\bT\d/);
  const cost = page.locator(".request-sheet .fit-card");
  await expect(cost).toContainText(
    /Accept: \+22 covers \(the party\) · −\d+ covers lost to the hold \(est\.\) = net [+−]?\d+/,
  );
  await expect(cost).toContainText("Decline: 0 · request leaves Resy");
  await expect(cost).toContainText(/Build time ~\d+ min \(est\.\)/);
  await expect(cost).toContainText("covers lost (est.)");
  await expect(cost).toContainText("spans two servers' sections");
  await expect(cost).toContainText("joins clear");
  await page.getByRole("button", { name: /Accept/ }).click();
  await expect(page.locator(".room-select select")).toHaveValue("book-fri");
  await expect(page.locator(".proposal")).toBeVisible();
  await expect(page.locator(".card.is-focus")).toContainText("Q2");
  await expect(page.locator(".fit-card.is-focus")).toContainText("Q2");
});

test("a large walk-in at the host stand gets the same capacity fit and cost", async ({ page }) => {
  await openFloor(page);
  await page.locator(".room-select select").selectOption("demo-night");
  await expect(page.locator(".room-name")).toBeVisible();
  await hostButton(page, "+ Walk-in").click();
  await page.locator(".walkin .size-more input").fill("14");
  const stand = page.getByRole("region", { name: "Large party at the host stand" });
  await expect(stand).toContainText("Party of 14 at the stand");
  await stand.getByRole("combobox").selectOption("21:00");
  await stand.getByRole("textbox").fill("Kim Lee");
  await stand.getByRole("button", { name: "Check capacity fit →" }).click();
  const sheet = page.locator(".request-sheet");
  await expect(sheet.locator(".req-title")).toHaveText("Kim Lee, party of 14 · Sat 21:00 (in 6h)");
  await expect(sheet).toContainText("Walk-in at the host stand");
  await expect(sheet).toContainText("At the stand");
  await expect(sheet.getByRole("region", { name: "Capacity fit" })).toBeVisible();
});

test("in-request chat: a message becomes constraints, the planner re-runs, manual controls match", async ({
  page,
}) => {
  await page.route("**/api/requests/*/chat", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        requestId: "Q2",
        traceId: "e2e-chat-1",
        promptVersion: "e2e",
        model: "e2e-stub",
        output: {
          tableRange: null,
          partySize: 26,
          time: null,
          addNeeds: [],
          removeNeeds: [],
          notes: ["high chair"],
          clarify: null,
        },
        escalated: false,
        note: null,
        validatorRejects: 0,
        input: { sha256: "e2e0000000000000", length: 19 },
        metrics: { costUsd: 0.0002, latencyMs: 1, calls: [] },
      }),
    }),
  );
  await openFloor(page);
  const rail = page.getByRole("region", { name: /Requests/ });
  await rail.locator(".row-request .row-btn").nth(1).click();
  const chat = page.getByRole("region", { name: "Adjust this request" });
  await chat
    .getByRole("textbox", { name: "Message about this request" })
    .fill("headcount is now 26");
  await chat.getByRole("button", { name: "Send" }).click();
  const log = chat.getByRole("list", { name: "Request chat" });
  await expect(log).toContainText("headcount is now 26");
  await expect(log).toContainText("party of 26 and high chair → Capacity fit:");
  const sheet = page.locator(".request-sheet");
  await expect(sheet.locator(".req-title")).toContainText("party of 26");
  await expect(sheet.locator(".fit-card")).toContainText("Accept: +26 covers");
  await expect(sheet.locator(".crew-note")).toContainText("Also: high chair.");
  // manual parity: the same table range from the controls, no chat needed
  await chat.getByLabel("Tables from").fill("30");
  await chat.getByLabel("to", { exact: true }).fill("50");
  await expect(sheet.locator(".cant-fit-line")).toContainText("No capacity fit in tables 30–50");
  await expect(sheet.locator(".cant-fit-line")).toContainText("Closest:");
  await expect(sheet).not.toContainText(/\bT\d/);
  // the turn is in the activity log, without the manager's words
  await page.getByRole("link", { name: "Activity" }).click();
  const table = page.locator(".activity-table");
  await expect(table).toContainText("Request chat");
  await expect(page.locator(".activity")).not.toContainText("headcount is now 26");
});

test("activity log lists AI actions with decisions, never the guest's words", async ({ page }) => {
  await openFloor(page);
  await page.getByRole("link", { name: "Activity" }).click();
  await expect(page.getByRole("heading", { name: /AI activity/ })).toBeVisible();
  await expect(page.locator(".activity")).toContainText("Proposed feature");
  const table = page.locator(".activity-table");
  await expect(table).toContainText("Refusal");
  await expect(table).toContainText("Declined · capacity fit");
  await expect(table).toContainText("Declined · policy");
  await expect(page.locator(".activity")).not.toContainText("surprise 40th for my partner");
  await page.getByRole("combobox", { name: "Type" }).selectOption("refusal");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await table.locator("tbody tr").first().click();
  await expect(page.getByRole("complementary", { name: "Full record" })).toContainText(
    "Nothing. The AI never books or seats",
  );
});

test("theme defaults to dark, toggles to light and remembers it", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test.describe("scenario URLs open the exact state with no model call", () => {
  test.beforeEach(async ({ page }) => {
    // a scenario must never call a model: fail loudly if it tries
    await page.route("**/api/requests/*/triage", (route) => route.abort());
    await page.route("**/api/requests/*/chat", (route) => route.abort());
    await page.route("**/api/agent", (route) => route.abort());
  });

  test("party-22-agent: the 22-top's capacity fit + cost sheet", async ({ page }) => {
    await page.goto("/?scenario=party-22-agent");
    const sheet = page.locator(".request-sheet");
    await expect(sheet.locator(".req-title")).toHaveText(
      "Sam Whitaker, party of 22 · Fri 18:30 (in 3h 30m)",
    );
    await expect(sheet).toContainText("AI agent (chat app or MCP)");
    await expect(sheet.locator(".req-overview")).toContainText("Family reunion");
    await expect(sheet.locator(".fit-card")).toContainText("Accept: +22 covers");
    await expect(page.locator(".room-select select")).toHaveValue("book-fri");
  });

  test("party-22-accepted: tonight's layout with the crew build list", async ({ page }) => {
    await page.goto("/?scenario=party-22-accepted");
    await expect(page.locator(".proposal")).toBeVisible();
    await expect(page.locator('[aria-label="Crew build list"]')).toBeVisible();
    await expect(page.locator(".fit-card.is-focus")).toContainText("Q2");
  });

  test("walkin-8-peak: the assistant with ranked options at 19:10", async ({ page }) => {
    await page.goto("/?scenario=walkin-8-peak");
    await expect(page.locator(".room-select select")).toHaveValue("dinner-peak");
    await expect(page.locator(".rec-card")).toHaveCount(3);
    await expect(page.locator(".rec-card").first()).toContainText("table 41");
    await expect(page.locator(".answer")).not.toContainText(/\bT\d/);
  });

  test("request-chat: the tables 30–50 chat mid-conversation", async ({ page }) => {
    await page.goto("/?scenario=request-chat");
    const chat = page.getByRole("region", { name: "Adjust this request" });
    const log = chat.getByRole("list", { name: "Request chat" });
    await expect(log).toContainText("find another space between tables 30–50");
    await expect(log).toContainText("tables 30–50 →");
    await expect(chat.getByLabel("Tables from")).toHaveValue("30");
    await expect(page.locator(".request-sheet")).toContainText("Closest:");
  });

  test("the header menu links every scenario", async ({ page }) => {
    await page.goto("/");
    await page.locator(".scenario-menu summary").click();
    for (const id of ["party-22-agent", "party-22-accepted", "walkin-8-peak", "request-chat"])
      await expect(page.locator(`.scenario-menu a[href="/?scenario=${id}"]`)).toBeVisible();
  });
});
