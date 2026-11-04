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
  await hostButton(page, "AI Planner").click();
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

test("tonight's reasons and crew steps show guest names, not party ids", async ({ page }) => {
  await openFloor(page);
  await page.locator(".room-select select").selectOption("heavy-saturday");
  await expect(page.locator(".room-name")).toBeVisible();
  await hostButton(page, "Shift setup").click();
  const times = page.locator(".tonight input[type=time]");
  await times.nth(0).fill("17:00");
  await times.nth(1).fill("21:00");
  await page.getByRole("button", { name: "Generate tonight's layout" }).click();
  const crew = page.locator('[aria-label="Crew build list"]');
  await expect(crew).toBeVisible();
  for (const d of await crew.locator("details").all()) await d.locator("summary").click();
  const reasons = await page.locator(".proposal .rec-reason").allInnerTexts();
  const steps = await crew.locator(".steps li").allInnerTexts();
  expect(reasons.length + steps.length).toBeGreaterThan(0);
  for (const t of [...reasons, ...steps]) expect(t).not.toMatch(/\b[DEFHNPQR]\d{1,4}\b/);
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
  await expect(page.locator(".cant-fit-line")).toContainText("earliest 8:30 PM");
  await expect(page.getByRole("button", { name: /Accept/ })).toBeDisabled();
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pick a reason to decline" })).toBeDisabled();
  await page.getByRole("radio", { name: /Capacity fit/ }).check();
  await page.getByRole("button", { name: "Decline for capacity fit" }).click();
  await expect(page.locator(".req-decided")).toContainText("Declined for capacity fit");

  // the 22-top fits: Accept opens Friday's plan with the party in focus
  await rail.locator(".row-request .row-btn").nth(1).click();
  const sheet = page.locator(".request-sheet");
  // another night on screen: weekday + date, no countdown
  await expect(sheet.locator(".req-title")).toHaveText(
    "Sam Whitaker, party of 22 · Fri Nov 6 · 6:30 PM",
  );
  await expect(sheet.locator(".req-overview")).toContainText("Stub line one for Q2.");
  await expect(sheet).toContainText("AI agent");
  await expect(sheet.locator(".fit-pill")).toHaveText("capacity fit ✓ · Ready");
  await sheet.getByRole("button", { name: "Show on Fri's floor →" }).click();
  await expect(sheet.locator(".req-title")).toHaveText(
    "Sam Whitaker, party of 22 · Fri 6:30 PM (in 3h 30m)",
  );
  await expect(page.locator("svg.floor.lit-fit .ready-bubble.is-now").first()).toBeVisible();
  await expect(sheet.locator(".crew-note")).toHaveText(/^(Open|Combine|Set) .*tables? \d/);
  await expect(sheet).not.toContainText(/\bT\d/);
  const cost = page.locator(".request-sheet .impacts");
  await expect(cost.getByRole("list", { name: "Pros" })).toContainText("+22 covers in one booking");
  await expect(cost.getByRole("list", { name: "Pros" })).toContainText(
    "Aisle clear for a wheelchair",
  );
  await expect(cost.getByRole("list", { name: "Cons" })).toContainText(
    /Tables held \d{1,2}:\d\d–6:30 PM/,
  );
  await expect(cost).toContainText(
    /Accept: \+22 covers \(the party\) · −\d+ covers lost to the hold \(est\.\) = net [+−]?\d+/,
  );
  await expect(cost).toContainText("Decline: 0 · request leaves Resy");
  await expect(cost).toContainText(/Crew: build time ~\d+ min \(est\.\)/);
  await expect(cost).toContainText("covers lost over one turn (est.)");
  await expect(cost).toContainText("spans two servers");
  // actions, in order
  await expect(sheet.locator(".req-actions .btn-row button")).toHaveText([
    "Accept",
    "Decline",
    "Message guest",
    "Discuss",
  ]);
  await expect(sheet.locator(".ask-ai svg.sparkle")).toBeVisible();
  await sheet.getByRole("button", { name: "Discuss" }).click();
  await expect(sheet.getByRole("textbox", { name: "Message about this request" })).toBeFocused();
  await page.getByRole("button", { name: /Accept/ }).click();
  await expect(page.locator(".room-select select")).toHaveValue("book-fri");
  await expect(page.locator(".proposal")).toBeVisible();
  await expect(page.locator(".card.is-focus")).toContainText("Whitaker");
  await expect(page.locator(".fit-card.is-focus")).toContainText("Whitaker");
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
  await expect(sheet.locator(".req-title")).toHaveText(
    "Kim Lee, party of 14 · Sat 9:00 PM (in 6h)",
  );
  await expect(sheet).toContainText("Walk-in at the host stand");
  await expect(sheet).toContainText("At the stand");
  await expect(sheet.getByRole("region", { name: "Capacity fit" })).toBeVisible();
});

test("during service, a proposed join shows each table's readiness (green now, red until free)", async ({
  page,
}) => {
  await openFloor(page);
  await page.locator(".room-select select").selectOption("dinner-peak");
  await expect(page.locator(".room-name")).toBeVisible();
  await hostButton(page, "+ Walk-in").click();
  await page.locator(".walkin .size-more input").fill("10");
  const stand = page.getByRole("region", { name: "Large party at the host stand" });
  await stand.getByRole("combobox").selectOption("20:00");
  await stand.getByRole("textbox").fill("Ari Dalton");
  await stand.getByRole("button", { name: "Check capacity fit →" }).click();
  const sheet = page.locator(".request-sheet");
  await expect(sheet.locator(".fit-pill")).toHaveText(
    /^capacity fit ✓ · ready to set up in ~\d+ min$/,
  );
  const list = sheet.getByRole("list", { name: "Tables in the join, and when each is free" });
  await expect(list.locator(".ready-chip.is-wait").first()).toHaveText(/^~\d+m$/);
  await expect(list).toContainText("until free (est.)");
  await expect(page.locator("svg.floor.lit-fit .ready-bubble.is-wait").first()).toBeVisible();
  await expect(page.locator("svg.floor.lit-fit .is-lit").first()).toBeVisible();
});

test("a later request on a live floor is projected to its hold start, not live minutes", async ({
  page,
}) => {
  await openFloor(page);
  await page.locator(".room-select select").selectOption("dinner-peak");
  await expect(page.locator(".room-name")).toBeVisible();
  await hostButton(page, "+ Walk-in").click();
  await page.locator(".walkin .size-more input").fill("10");
  const stand = page.getByRole("region", { name: "Large party at the host stand" });
  await stand.getByRole("combobox").selectOption("21:45");
  await stand.getByRole("textbox").fill("Ari Dalton");
  await stand.getByRole("button", { name: "Check capacity fit →" }).click();
  const sheet = page.locator(".request-sheet");
  await expect(sheet.locator(".fit-pill")).toHaveText(
    /^capacity fit ✓ · (Ready|ready to set up at ~\d{1,2}:\d\d [AP]M)$/,
  );
  const list = sheet.getByRole("list", { name: "Tables in the join, and when each is free" });
  for (const chip of await list.locator(".ready-chip").allTextContents())
    expect(chip).toMatch(/^(free by \d{1,2}:\d\d [AP]M|busy until ~\d{1,2}:\d\d [AP]M \(est\.\))$/);
  await expect(list.locator(".ready-chip", { hasText: /^~\d+m$/ })).toHaveCount(0);
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
  const log = chat.getByRole("list", { name: "AI Planner chat" });
  await expect(log).toContainText("headcount is now 26");
  await expect(log).toContainText("party of 26 and high chair → Capacity fit:");
  const sheet = page.locator(".request-sheet");
  await expect(sheet.locator(".req-title")).toContainText("party of 26");
  await expect(sheet.locator(".impacts")).toContainText("Accept: +26 covers");
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
  await expect(table).toContainText("AI Planner chat");
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

test("activity log feedback: a thumb saves at once, the other thumb updates it, notes append", async ({
  page,
}) => {
  await openFloor(page);
  await page.evaluate(() => window.localStorage.removeItem("afp.feedback.v1"));
  await page.getByRole("link", { name: "Activity" }).click();
  const table = page.locator(".activity-table");
  const rows = table.locator("tbody tr:not(.fb-note-row)");
  await page.getByRole("combobox", { name: "Type" }).selectOption("refusal");
  await expect(rows).toHaveCount(1);
  const row = rows.first();
  const up = row.getByRole("button", { name: "Helpful", exact: true });
  const down = row.getByRole("button", { name: "Not helpful" });

  // save
  await up.click();
  await expect(up).toHaveAttribute("aria-pressed", "true");
  await expect(row.locator(".fb-rated")).toHaveText("rated");
  const box = page.getByRole("textbox", { name: /Add a note \(optional\)/ });
  await expect(box).toBeFocused();
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(box).toBeHidden();

  // change: same entry, other thumb
  await down.click();
  await expect(down).toHaveAttribute("aria-pressed", "true");
  await expect(up).toHaveAttribute("aria-pressed", "false");
  await expect(row.locator(".fb-rated")).toHaveText("rated");

  // note-append: two notes on the same entry, no new row
  await box.fill("too cautious for a quiet Monday");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(row.locator(".fb-rated")).toHaveText("rated · 1 note");
  await up.click();
  await box.fill("on second look, fine");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(row.locator(".fb-rated")).toHaveText("rated · 2 notes");
  await expect(rows).toHaveCount(1);
  await expect(page.locator(".activity")).not.toContainText("too cautious");

  // the Feedback filter
  await page.getByRole("combobox", { name: "Type" }).selectOption("");
  await page.getByRole("combobox", { name: "Feedback" }).selectOption("up");
  await expect(rows).toHaveCount(1);
  await page.getByRole("combobox", { name: "Feedback" }).selectOption("down");
  await expect(table).toContainText("Nothing matches these filters.");
  await page.getByRole("combobox", { name: "Feedback" }).selectOption("unrated");
  await expect(rows.locator(".fb-rated")).toHaveCount(0);

  // saved at once, as one entry with the notes kept as hash + length only
  const saved = await page.evaluate(() => window.localStorage.getItem("afp.feedback.v1") ?? "");
  const list = JSON.parse(saved) as {
    rating: string;
    notes: { sha256: string; length: number }[];
  }[];
  expect(list).toHaveLength(1);
  expect(list[0]?.rating).toBe("up");
  expect(list[0]?.notes.map((n) => Object.keys(n).sort().join())).toEqual([
    "length,sha256",
    "length,sha256",
  ]);
  expect(saved).not.toContain("cautious");
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
      "Sam Whitaker, party of 22 · Fri 6:30 PM (in 3h 30m)",
    );
    await expect(sheet).toContainText("AI agent");
    await expect(sheet.locator(".req-overview")).toContainText("Family reunion");
    await expect(sheet.locator(".impacts")).toContainText("Accept: +22 covers");
    await expect(sheet.locator(".impacts")).toContainText("= net −2");
    // a future request: readiness is projected to the hold start (5:00 PM), not live minutes
    await expect(sheet.locator(".fit-pill")).toHaveText("capacity fit ✓ · Ready");
    const list = sheet.getByRole("list", { name: "Tables in the join, and when each is free" });
    await expect(list.locator(".ready-chip").first()).toHaveText("free by 5:00 PM");
    await expect(page.locator("svg.floor .ready-bubble.is-now").first()).toHaveText("free");
    await expect(page.locator(".room-select select")).toHaveValue("book-fri");
  });

  test("activity-log: the Activity page with a rated row and a request-chat row", async ({
    page,
  }) => {
    await page.goto("/?scenario=activity-log");
    await expect(page).toHaveURL(/\/activity\?scenario=activity-log$/);
    await expect(page.getByRole("heading", { name: /AI activity/ })).toBeVisible();
    const table = page.locator(".activity-table");
    await expect(table).toContainText("AI Planner chat");
    await expect(table).toContainText("No capacity fit in tables 30–50");
    await expect(table.locator(".fb-rated").first()).toBeVisible();
    await expect(table).toContainText("rated · 1 note");
    await page.getByRole("combobox", { name: "Feedback" }).selectOption("down");
    await expect(table.locator("tbody tr")).toHaveCount(1);
  });

  test("party-22-accepted: tonight's layout with the crew build list", async ({ page }) => {
    await page.goto("/?scenario=party-22-accepted");
    await expect(page.locator(".proposal")).toBeVisible();
    await expect(page.locator('[aria-label="Crew build list"]')).toBeVisible();
    await expect(page.locator(".fit-card.is-focus")).toContainText("Whitaker");
  });

  test("walkin-8-peak: the assistant with ranked options at 7:10 PM", async ({ page }) => {
    await page.goto("/?scenario=walkin-8-peak");
    await expect(page.locator(".room-select select")).toHaveValue("dinner-peak");
    await expect(page.locator(".rec-card")).toHaveCount(3);
    await expect(page.locator(".rec-card").first()).toContainText("table 41");
    await expect(page.locator(".answer")).not.toContainText(/\bT\d/);
  });

  test("request-chat: the tables 30–50 chat mid-conversation", async ({ page }) => {
    await page.goto("/?scenario=request-chat");
    const chat = page.getByRole("region", { name: "Adjust this request" });
    const log = chat.getByRole("list", { name: "AI Planner chat" });
    await expect(log).toContainText("find another space between tables 30–50");
    await expect(log).toContainText("tables 30–50 →");
    await expect(chat.getByLabel("Tables from")).toHaveValue("30");
    await expect(page.locator(".request-sheet")).toContainText("Closest:");
  });

  for (const id of [
    "party-22-agent",
    "party-22-accepted",
    "walkin-8-peak",
    "request-chat",
    "activity-log",
  ]) {
    test(`${id}: every time a manager reads is 12-hour AM/PM`, async ({ page }) => {
      await page.goto(`/?scenario=${id}`);
      await expect(page.locator(".banner")).toBeVisible();
      await page.waitForLoadState("networkidle");
      const found = await page.evaluate(() => {
        // the domain's "HH:MM" (zero-padded, 24-hour) must never reach the screen
        // (a 12-hour time is followed by AM/PM, or starts a range that ends in AM/PM: "5:00–6:30 PM")
        const re =
          /(?<![\d:])([01]\d|2[0-3]):[0-5]\d(?![\d:])(?!\s?[AP]M)(?!–\d{1,2}:\d{2}\s?[AP]M)/;
        const out: string[] = [];
        if (re.test(document.body.innerText)) {
          const lines = document.body.innerText.split("\n").filter((l) => re.test(l));
          out.push(...lines);
        }
        for (const el of document.querySelectorAll("[title], [aria-label]")) {
          for (const a of ["title", "aria-label"]) {
            const v = el.getAttribute(a);
            if (v && re.test(v)) out.push(`${a}: ${v}`);
          }
        }
        for (const o of document.querySelectorAll("option")) {
          if (re.test(o.textContent ?? "")) out.push(`option: ${o.textContent}`);
        }
        return out;
      });
      expect(found).toEqual([]);
    });
  }

  test("the header menu links every scenario", async ({ page }) => {
    await page.goto("/");
    await page.locator(".scenario-menu summary").click();
    for (const id of ["party-22-agent", "party-22-accepted", "walkin-8-peak", "request-chat"])
      await expect(page.locator(`.scenario-menu a[href="/?scenario=${id}"]`)).toBeVisible();
  });
});

test.describe("manager copy carries no fixture ids", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/requests/*/triage", (route) => route.abort());
    await page.route("**/api/requests/*/chat", (route) => route.abort());
    await page.route("**/api/agent", (route) => route.abort());
  });
  for (const id of [
    "party-22-agent",
    "party-22-accepted",
    "walkin-8-peak",
    "request-chat",
    "activity-log",
  ]) {
    test(`${id}: no request or reservation id on screen`, async ({ page }) => {
      await page.goto(`/?scenario=${id}`);
      await expect(page.locator(".banner")).toBeVisible();
      await page.waitForLoadState("networkidle");
      const text = await page.locator("body").innerText();
      expect(text).not.toMatch(/\b[QPF]\d+\b/);
    });
  }

  test("party-22-accepted: Held counts the accepted plan's tables", async ({ page }) => {
    await page.goto("/?scenario=party-22-accepted");
    await expect(page.locator(".proposal")).toBeVisible();
    const held = page.locator(".cb-stats div", { has: page.locator("dt", { hasText: "Held" }) });
    await expect(held.locator("dd")).toHaveText(/^[1-9]\d*$/);
  });

  test("party-22-agent: Looks real, the override is one tap and the telemetry is folded", async ({
    page,
  }) => {
    await page.goto("/?scenario=party-22-agent");
    const sheet = page.locator(".request-sheet");
    await expect(sheet.locator(".verdict").first()).toHaveText("Looks real");
    await expect(sheet.locator(".how-made .metrics")).toBeHidden();
    await sheet.getByText("How this was made").click();
    await expect(sheet.locator(".how-made .metrics")).toContainText("triage.v");
    await sheet.getByRole("button", { name: "Mark as junk" }).click();
    await expect(sheet.locator(".verdict").first()).toHaveText("Junk (manager)");
    await expect(sheet.getByRole("button", { name: /Accept/ })).toBeDisabled();
  });
});
