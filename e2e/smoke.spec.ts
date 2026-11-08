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
  // the meal-phase bar sits at the top of the floor on every width (abbreviations on iPad, words in the title)
  const key = page.locator(".floor-sub .phase-strip");
  await expect(key).toBeVisible();
  for (const abbr of ["SEAT", "DRK", "APP", "ENT", "DES", "CHK"])
    await expect(key).toContainText(abbr);
  for (const phase of ["Seated", "Drinks", "Apps", "Entrées", "Dessert", "Check"])
    await expect(key.locator(`[title="${phase}"]`)).toHaveCount(1);
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
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator(".rec-card").first()).toContainText("table 41");
  await expect(page.locator(".answer")).toHaveText("Table 41 frees in about 11 minutes.");
  // the option's action opens the review screen; nothing is seated from the card
  await expect(page.locator(".rec-card").first().locator(".rec-go")).toHaveText(
    "Waitlist · ~11 min",
  );
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
  await expect(page.locator(".unplaced-line")).toContainText(/needs? a table:/);
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
  const reasons = await page.locator(".proposal .unplaced-line").allInnerTexts();
  const steps = await crew.locator(".crew li").allInnerTexts();
  expect(reasons.length + steps.length).toBeGreaterThan(0);
  for (const t of [...reasons, ...steps]) expect(t).not.toMatch(/\b[DEFHNPQR]\d{1,4}\b/);
});

test("editor opens the base layout and inspects a table", async ({ page }) => {
  await openFloor(page);
  await hostButton(page, "Shift setup").click();
  await page.getByText("Layouts ▸").click();
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
  // the Wednesday live floor lists what had arrived by 7:10 PM Wed: Q5 (Wed 9:47 PM) and the Fri walk-in are not there yet
  await expect(rail.locator(".row-request")).toHaveCount(4);
  for (const label of ["Resy app", "AI agent"]) await expect(rail).toContainText(label);
  await expect(rail).not.toContainText("At host stand");
  await expect(rail).toContainText("Likely junk");

  // the 30-top can't have a private room at 19:30: Accept stays disabled, the reason is one line
  await rail.locator(".row-request .row-btn").nth(2).click();
  await expect(page.locator(".cant-fit-line")).toContainText("earliest 8:30 PM");
  await expect(page.getByRole("button", { name: /Accept/ })).toBeDisabled();
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pick a reason to decline" })).toBeDisabled();
  await page.getByRole("radio", { name: /No capacity fit/ }).check();
  await page.getByRole("button", { name: "Decline: no capacity fit" }).click();
  await expect(page.locator(".req-decided")).toContainText("Declined: no capacity fit");

  // the 22-top fits: Accept opens Friday's plan with the party in focus
  // (iPad: an open sheet collapses the rail to a strip; expand it to pick another request)
  const strip = page.locator(".rail-collapse");
  if (await strip.isVisible()) await strip.click();
  await rail.locator(".row-request .row-btn").nth(1).click();
  const sheet = page.locator(".request-sheet");
  // another night on screen: weekday + date, no countdown
  await expect(sheet.locator(".req-title")).toHaveText(
    "Sam Whitaker · party of 22 · Fri Nov 6 · 6:30 PM",
  );
  // the demo opens with the recorded triage (no model call)
  await expect(sheet.locator(".req-overview")).toContainText(
    "Family reunion; can move the time by 30 minutes.",
  );
  await expect(sheet).toContainText("AI agent");
  await expect(sheet.locator(".fit-pill")).toHaveText("capacity fit ✓ · Ready");
  await sheet.getByRole("button", { name: "Show on Fri's floor →" }).click();
  await expect(sheet.locator(".req-title")).toHaveText(
    "Sam Whitaker · party of 22 · Fri 6:30 PM (in 3h 30m)",
  );
  await expect(page.locator("svg.floor.lit-fit .ready-bubble.is-now").first()).toBeVisible();
  await sheet.getByRole("button", { name: "More ▸" }).click();
  await expect(sheet.locator(".req-plan .field-value")).toHaveText(/^(Combine|Set): .*tables? \d/);
  await expect(sheet).not.toContainText(/\bT\d/);
  const cost = page.locator(".request-sheet .req-card");
  await expect(cost.getByRole("list", { name: "Pros" })).toContainText("+22 covers in one booking");
  await expect(cost.getByRole("list", { name: "Pros" })).toContainText(
    "Aisle clear for a wheelchair",
  );
  await expect(cost.getByRole("list", { name: "Cons" })).toContainText(
    /Tables held \d{1,2}:\d\d–6:30 PM/,
  );
  await expect(sheet.locator(".net-hero")).toHaveText(
    /^\+22 booked vs up to ~\d+ possible walk-ins$/,
  );
  await expect(sheet.locator(".capacity-line")).toContainText(
    /^Booked \+22 \(guaranteed\) · Walk-in capacity held: up to ~\d+ \(only if every held seat would turn\) · Reservations moved \d+ · cancelled 0$/,
  );
  await expect(cost).toContainText(/Crew build: ~\d+ min, starts ~\d{1,2}:\d\d [AP]M/);
  await expect(cost).toContainText("walk-in covers over one turn (est.)");
  await expect(sheet).not.toContainText("covers lost");
  await expect(cost).toContainText("spans two servers");
  // actions on one row: Decline · Message · Discuss · Accept; Accept is the one filled button, trailing
  await expect(sheet.locator(".req-actions button")).toHaveText([
    "Decline",
    "Message",
    "Discuss",
    "Accept",
  ]);
  await expect(sheet.locator(".req-actions button.primary")).toHaveText(["Accept"]);
  await expect(sheet).toContainText(
    /Accept holds tables .* from \d{1,2}:\d\d PM .*· no guest message is sent/,
  );
  await expect(sheet.getByRole("textbox", { name: "Message about this request" })).toBeHidden();
  await expect(sheet.locator(".ask-ai svg.sparkle")).toBeVisible();
  await sheet.getByRole("button", { name: "Discuss" }).click();
  await expect(sheet.getByRole("textbox", { name: "Message about this request" })).toBeFocused();
  await page.getByRole("button", { name: /Accept/ }).click();
  // the review screen first; its one button holds the tables and applies the crew plan
  await page.getByRole("button", { name: "Accept · hold tables" }).click();
  await expect(page.locator(".room-select select")).toHaveValue("book-fri");
  await expect(page.locator(".accepted-result")).toContainText(
    "Accepted · tables held · crew plan applied",
  );
  await expect(page.locator(".accepted-card")).toContainText(
    "Whitaker · party of 22 · Fri 6:30 PM — Accepted",
  );
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
    "Kim Lee · party of 14 · Sat 9:00 PM (in 6h)",
  );
  await expect(sheet.locator(".req-via .field-value")).toHaveText("Staff · host stand");
  await expect(sheet).toContainText("At the stand");
  await expect(sheet.getByRole("region", { name: "Request" })).toBeVisible();
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
  // the floor shows each table's readiness; no live "~Nm" for a later request
  await expect(page.locator("svg.floor.lit-fit .ready-bubble").first()).toBeVisible();
  await expect(page.locator("svg.floor.lit-fit .ready-bubble", { hasText: /^~\d+m$/ })).toHaveCount(
    0,
  );
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
  await page.locator(".request-sheet").getByRole("button", { name: "Discuss" }).click();
  const chat = page.getByRole("region", { name: "Adjust this request" });
  await chat
    .getByRole("textbox", { name: "Message about this request" })
    .fill("headcount is now 26");
  await chat.getByRole("button", { name: "Send" }).click();
  const log = chat.getByRole("list", { name: "AI Planner chat" });
  await expect(log).toContainText("headcount is now 26");
  await expect(log).toContainText(
    "I'd change party of 26 and high chair — see Proposed changes above. Capacity fit:",
  );
  const sheet = page.locator(".request-sheet");
  // a proposal: shown as a diff, nothing changes until Apply
  const diff = sheet.getByRole("group", { name: "Change proposed in chat" });
  await expect(diff.locator("ol.chat-diff-rows > li")).toHaveText([
    "Party22 → 26",
    "Notes+ high chair",
  ]);
  await expect(diff).toContainText("capacity fit ✓ → capacity fit ✓");
  await expect(sheet.locator(".req-title")).toContainText("party of 22");
  await diff.getByRole("button", { name: "Apply" }).click();
  await expect(sheet.locator(".req-title")).toContainText("party of 26");
  await expect(sheet.locator(".changed-line")).toContainText("Changed in chat");
  await expect(sheet.locator(".original-fit .field-value")).toHaveText("capacity fit ✓");
  await sheet.getByRole("button", { name: "More ▸" }).click();
  await expect(sheet.locator(".net-hero")).toContainText("+26 booked");
  await expect(sheet.locator(".req-more")).toContainText("Crew notes");
  await expect(sheet.locator(".req-more")).toContainText("high chair");
  // manual parity: the same table range on the review screen, no chat needed
  await sheet.getByRole("button", { name: "Accept", exact: true }).click();
  const review = page.locator(".review");
  await review.getByLabel("First table").fill("30");
  await review.getByLabel("Last table").fill("50");
  await expect(review.locator(".fit-pill")).toHaveText("no capacity fit");
  await expect(review.getByRole("button", { name: "Accept · hold tables" })).toBeDisabled();
  await review.getByRole("button", { name: "‹ Back to the request" }).click();
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
  await expect(table).toContainText("Declined · no capacity fit");
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
      "Sam Whitaker · party of 22 · Fri 6:30 PM (in 3h 30m)",
    );
    await expect(sheet).toContainText("AI agent");
    await expect(sheet.locator(".req-overview")).toContainText("Family reunion");
    await sheet.getByRole("button", { name: "More ▸" }).click();
    // the one-pager's numbers: +22 booked, up to ~24 walk-in covers held, Oduya moved, nothing cancelled
    await expect(sheet.locator(".net-hero")).toHaveText(
      "+22 booked vs up to ~24 possible walk-ins",
    );
    await expect(sheet.locator(".capacity-line")).toHaveText(
      "Booked +22 (guaranteed) · Walk-in capacity held: up to ~24 (only if every held seat would turn) · Reservations moved 1 · cancelled 0",
    );
    await expect(sheet.locator(".take-it .take-it-text")).toHaveText(
      "Take it: a booked 22 beats uncertain walk-ins",
    );
    // a future request: readiness is projected to the hold start (5:00 PM), not live minutes
    await expect(sheet.locator(".fit-pill")).toHaveText("capacity fit ✓ · Ready");
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
    await expect(page.locator(".accepted-card")).toContainText(
      "Whitaker · party of 22 · Fri 6:30 PM — Accepted",
    );
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
    await expect(log).toContainText("I'd change tables 30–50");
    // the chat's change waits as a diff; Capacity check still shows the original fit
    const sheet = page.locator(".request-sheet");
    const diff = sheet.getByRole("group", { name: "Change proposed in chat" });
    await expect(diff.locator("ol.chat-diff-rows > li")).toHaveText(["Tablesany → 30–50"]);
    await expect(diff).toContainText("capacity fit ✓ → no capacity fit");
    await expect(diff).toContainText("closest: tables 57–61 and 63–66");
    await expect(sheet.locator(".fit-pill")).toContainText("capacity fit ✓");
    await diff.getByRole("button", { name: "Apply" }).click();
    await expect(sheet.locator(".changed-line")).toContainText("tables 30–50");
    await expect(sheet.locator(".fit-pill")).toHaveText("no capacity fit");
    await expect(sheet.locator(".original-fit .field-value")).toHaveText("capacity fit ✓");
    await sheet.locator(".changed-line").getByRole("button", { name: "Revert" }).click();
    await expect(sheet.locator(".fit-pill")).toContainText("capacity fit ✓");
  });

  test("request-chat: Discard drops the proposal; Accept waits for it", async ({ page }) => {
    await page.goto("/?scenario=request-chat");
    const sheet = page.locator(".request-sheet");
    const diff = sheet.getByRole("group", { name: "Change proposed in chat" });
    await expect(sheet.getByRole("button", { name: "Accept" })).toBeDisabled();
    await diff.getByRole("button", { name: "Discard" }).click();
    await expect(diff).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Accept" })).toBeEnabled();
    await expect(sheet.locator(".fit-pill")).toContainText("capacity fit ✓");
  });

  test("request-chat: an edit on the review screen writes the same request state", async ({
    page,
  }) => {
    await page.goto("/?scenario=request-chat");
    const sheet = page.locator(".request-sheet");
    await sheet
      .getByRole("group", { name: "Change proposed in chat" })
      .getByRole("button", { name: "Discard" })
      .click();
    await sheet.getByRole("button", { name: "Accept", exact: true }).click();
    await page.locator(".review").getByLabel("First table").fill("70");
    await page.locator(".review").getByRole("button", { name: "‹ Back to the request" }).click();
    await expect(sheet.locator(".changed-line")).toContainText("Changed by hand");
  });

  for (const id of [
    "party-22-agent",
    "party-22-accepted",
    "walkin-8-peak",
    "request-chat",
    "floor-edit",
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
    for (const id of [
      "party-22-agent",
      "party-22-accepted",
      "walkin-8-peak",
      "request-chat",
      "floor-edit",
    ])
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
    "floor-edit",
    "activity-log",
  ]) {
    test(`${id}: no request or reservation id on screen`, async ({ page }) => {
      await page.goto(`/?scenario=${id}`);
      await expect(page.locator(".banner")).toBeVisible();
      await page.waitForLoadState("networkidle");
      const text = await page.locator("body").innerText();
      expect(text).not.toMatch(/\b[QPFDEHRNdefhpt]\d+\b/);
    });
  }

  test("party-22-accepted: Held counts the accepted plan's tables", async ({ page }) => {
    await page.goto("/?scenario=party-22-accepted");
    await expect(page.locator(".proposal")).toBeVisible();
    const held = page.locator(".cb-stats div", { has: page.locator("dt", { hasText: "Held" }) });
    // planning clock: the hold starts later, so it says when
    await expect(held.locator("dd")).toHaveText(/^[1-9]\d* from 5:00 PM$/);
  });

  test("party-22-agent: Looks real, the override is one tap and the telemetry is folded", async ({
    page,
  }) => {
    await page.goto("/?scenario=party-22-agent");
    const sheet = page.locator(".request-sheet");
    await expect(sheet.locator(".verdict").first()).toHaveText("Looks real");
    await expect(sheet.locator(".how-made .metrics")).toBeHidden();
    await sheet.getByRole("button", { name: "More ▸" }).click();
    await sheet.getByText("How this was made").click();
    await expect(sheet.locator(".how-made .metrics")).toContainText("triage.v");
    await sheet.getByRole("button", { name: "Mark as junk" }).click();
    await expect(sheet.locator(".verdict").first()).toHaveText("Junk (manager)");
    await expect(sheet.getByRole("button", { name: /Accept/ })).toBeDisabled();
  });
});

test.describe("planner app shell", () => {
  test.use({ viewport: { width: 1180, height: 820 } });
  test("the page never scrolls; Discuss doesn't move the window", async ({ page }) => {
    await page.route("**/api/requests/*/triage", (route) => route.abort());
    await page.goto("/?scenario=party-22-agent");
    await expect(page.locator(".request-sheet")).toBeVisible();
    const vh = page.viewportSize()?.height ?? 0;
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
      vh,
    );
    await page.getByRole("button", { name: "Discuss" }).click();
    await expect(page.getByRole("textbox", { name: "Message about this request" })).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.locator(".console-bar")).toBeInViewport();
  });

  test("an open sheet never covers the zoom controls or room tabs", async ({ page }) => {
    await page.goto("/?scenario=party-22-agent");
    const side = await page.locator(".side-col").boundingBox();
    for (const name of ["Zoom in", "Zoom out", "Fit to panel"]) {
      const b = await page.getByRole("button", { name }).boundingBox();
      expect(b && side && b.x + b.width <= side.x).toBe(true);
    }
    const tabs = await page.locator(".room-tabs").boundingBox();
    expect(tabs && side && tabs.x + tabs.width <= side.x).toBe(true);
  });
});

test.describe("decision card", () => {
  for (const vp of [
    { width: 1180, height: 820 },
    { width: 1440, height: 900 },
  ]) {
    test(`party-22-agent at ${vp.width}: guest, party, when, fit, net covers and Accept without scrolling`, async ({
      page,
    }) => {
      await page.setViewportSize(vp);
      await page.route("**/api/requests/*/triage", (route) => route.abort());
      await page.goto("/?scenario=party-22-agent");
      const sheet = page.locator(".request-sheet");
      await expect(sheet.locator(".req-title")).toContainText("Sam Whitaker · party of 22 · Fri");
      for (const l of [
        sheet.locator(".req-title"),
        sheet.locator(".fit-pill"),
        sheet.locator(".take-it"),
        sheet.getByRole("button", { name: "Accept" }),
      ])
        await expect(l).toBeInViewport({ ratio: 1 });
      // and not hidden under the sticky action footer
      const footerTop = (await sheet.locator(".decision-footer").boundingBox())?.y ?? 0;
      const take = await sheet.locator(".take-it").boundingBox();
      expect(take && take.y + take.height).toBeLessThanOrEqual(footerTop);
      // one request card (the triage and the capacity check are merged)
      await expect(page.locator(".req-block.ai-card")).toHaveCount(1);
    });
  }
});

test.describe("after accept", () => {
  test("party-22-accepted: Apply crew plan names the night, keeps the plan, and Undo restores it", async ({
    page,
  }) => {
    await page.goto("/?scenario=party-22-accepted");
    const panel = page.locator(".side-col");
    // one confirm: the tables are held and the crew plan is applied, no second step
    await expect(panel.locator(".accepted-result")).toContainText(
      "Accepted · tables held · crew plan applied",
    );
    await expect(panel.getByRole("button", { name: "Apply crew plan" })).toHaveCount(0);
    await expect(page.locator(".preview-bar")).toHaveCount(0);
    await expect(panel.locator(".accepted-card")).toContainText("Crew starts");
    await expect(panel.locator(".crew > li").first()).toBeVisible();
    await expect(panel.locator(".party-changes")).toHaveCount(0);
    await expect(page.locator(".cb-sub")).not.toContainText("Tonight —");
    // one Undo reverts both
    await panel.locator(".accepted-result").getByRole("button", { name: "Undo" }).click();
    await expect(page.locator(".request-sheet .req-actions")).toContainText("Accept");
  });
});

test.describe("declutter", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/requests/*/triage", (route) => route.abort());
    await page.route("**/api/requests/*/chat", (route) => route.abort());
    await page.route("**/api/agent", (route) => route.abort());
  });

  for (const id of ["party-22-agent", "party-22-accepted", "request-chat"]) {
    test(`${id}: planning clock — no meal-phase key, the key line reads Open · Held`, async ({
      page,
    }) => {
      await page.goto(`/?scenario=${id}`);
      await expect(page.locator(".side-col")).toBeVisible();
      await expect(page.locator(".phase-strip")).toHaveCount(0);
      await expect(page.locator(".legend-line")).toHaveText("Open · Held");
    });
  }

  for (const id of ["party-22-agent", "party-22-accepted", "walkin-8-peak", "request-chat"]) {
    test(`${id}: at most one filled primary button in view`, async ({ page }) => {
      await page.goto(`/?scenario=${id}`);
      await expect(page.locator(".side-col")).toBeVisible();
      await page.waitForLoadState("networkidle");
      const visible = await page
        .locator("button.primary")
        .evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).length);
      expect(visible).toBeLessThanOrEqual(1);
    });
  }

  test("walkin-8-peak: the AI Planner leads with one sentence; every wait says est. and its basis", async ({
    page,
  }) => {
    await page.goto("/?scenario=walkin-8-peak");
    await expect(page.locator(".answer-lead")).toBeVisible();
    const lead = await page.locator(".answer-lead").boundingBox();
    expect(lead && lead.height).toBeLessThanOrEqual(48);
    await expect(page.locator(".rec-card").first()).toContainText(
      /~\d+ min est\. \(check ~6 \+ reset 5\)/,
    );
  });
});

test("activity-log reads as an ops log: actor column, plain words, no engineering strings by default", async ({
  page,
}) => {
  await page.route("**/api/requests/*/triage", (route) => route.abort());
  await page.goto("/?scenario=activity-log");
  const table = page.locator(".activity-table");
  await expect(table.locator("thead")).toContainText("What happened");
  await expect(table.locator("thead")).toContainText("Actor");
  await expect(table.locator("thead")).not.toContainText("Cost");
  await expect(table).toContainText("AI Planner → Capacity check → Manager");
  await expect(table).toContainText("Capacity check rejected 1 AI option");
  const body = await page.locator(".activity").innerText();
  expect(body).not.toMatch(/sha256|validator|claude-|\$0\.\d{4} ·|triage\.v|agent\.v/);
});

test.describe("host parity", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/requests/*/triage", (route) => route.abort());
    await page.route("**/api/agent", (route) => route.abort());
  });

  test("party-22-accepted: a held table says who it's held for and when", async ({ page }) => {
    await page.goto("/?scenario=party-22-accepted");
    await expect(page.locator(".accepted-result")).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await page.locator('svg.floor g[data-id="T57"]').focus();
    await page.keyboard.press("Enter");
    const card = page.locator(".table-card");
    await expect(card.locator(".held-line")).toHaveText(
      "Held · Whitaker · party of 22 · 5:00–6:30 PM",
    );
    await expect(page.locator('svg.floor g[data-id="T57"] .held-outline')).toHaveCount(1);
  });

  test("a host sets a seated table's meal phase by hand", async ({ page }) => {
    await openFloor(page);
    await page.locator('svg.floor g[data-id="T3"]').click();
    const card = page.locator(".table-card");
    await expect(card.locator(".phase-source")).toHaveText("from POS (simulated)");
    await card
      .getByRole("group", { name: "Meal phase" })
      .getByRole("button", { name: "Check" })
      .click();
    await expect(card.locator(".phase-source")).toHaveText("set by host");
    await expect(card).toContainText("Check");
  });

  test("Split is one tap after Combine", async ({ page }) => {
    await openFloor(page);
    await page.locator(".room-select select").selectOption("book-fri");
    await expect(page.locator(".room-name")).toBeVisible();
    await page.getByRole("tab", { name: "Dining room" }).click();
    await page.locator('svg.floor g[data-id="T4"]').click();
    await page.locator('svg.floor g[data-id="T5"]').click();
    await page.getByRole("button", { name: /^Combine/ }).click();
    await expect(page.getByRole("button", { name: /^Split/ })).toBeEnabled();
  });

  test("walkin-8 at peak: a busy pick leads with Add to waitlist, never a disabled Seat", async ({
    page,
  }) => {
    await openFloor(page);
    await hostButton(page, "+ Walk-in").click();
    await page.locator(".size-grid").getByRole("button", { name: "8", exact: true }).click();
    await page.locator(".sugg").first().click();
    const actions = page.locator(".walkin .sheet-actions");
    await expect(actions.locator("button:disabled")).toHaveCount(0);
    await expect(actions.locator("button.primary")).toHaveCount(1);
  });

  test("rail: a request's source has its own line; booked rows read time · name · size · table", async ({
    page,
  }) => {
    await page.goto("/?scenario=party-22-agent");
    await expect(page.locator(".request-sheet")).toBeVisible();
    const strip = page.locator(".rail-collapse");
    if (await strip.isVisible()) await strip.click();
    await expect(page.locator(".row-request .row-source").first()).toBeVisible();
    const booked = page.locator("#rail-booked .row").first();
    await expect(booked.locator(".row-table")).toHaveText(/^(tables? [\d–, and]+|unassigned)$/);
  });
});

test.describe("host polish, part 3", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/requests/*/triage", (route) => route.abort());
    await page.route("**/api/agent", (route) => route.abort());
  });

  test("walk-in: one quote first; Seat or waitlist always in view", async ({ page }) => {
    await openFloor(page);
    await hostButton(page, "+ Walk-in").click();
    await page.locator(".size-grid").getByRole("button", { name: "4", exact: true }).click();
    await expect(page.locator(".quote-big")).toBeInViewport();
    await expect(page.locator(".walkin-footer button.primary")).toBeInViewport();
  });

  test("party-22-agent: 👍 / 👎 sit next to the AI triage; 👎 offers reasons", async ({ page }) => {
    await page.goto("/?scenario=party-22-agent");
    const fb = page.getByRole("group", { name: "Rate this AI triage" });
    await fb.getByRole("button", { name: "Not helpful" }).click();
    await fb.getByRole("button", { name: "Missed need" }).click();
    await expect(fb.getByRole("button", { name: "Missed need" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("party-22-agent: the draft reply only promises an answer time", async ({ page }) => {
    await page.goto("/?scenario=party-22-agent");
    await page.getByRole("button", { name: "Message guest" }).click();
    await expect(page.locator(".reply textarea")).toHaveValue(/will confirm by 4:00 PM/);
  });

  test("table details: who and when first, then Finish, then tools", async ({ page }) => {
    await openFloor(page);
    await page.locator('svg.floor g[data-id="T3"]').focus();
    await page.keyboard.press("Enter");
    const card = page.locator(".table-card");
    await expect(card.locator("header")).toContainText(/party of \d+/);
    await expect(card).not.toContainText("Joinable");
    const finish = await card.locator(".finish-btn").boundingBox();
    const phase = await card.locator(".phase-control").boundingBox();
    expect(finish && phase && finish.y < phase.y).toBe(true);
  });
});

test.describe("floor reads grey; colour only for exceptions", () => {
  test("live floor: no elapsed '~Nm' labels; about-to-free tables say 'free ~Nm'", async ({
    page,
  }) => {
    await page.route("**/api/agent", (route) => route.abort());
    await openFloor(page);
    await page.getByRole("tab", { name: "Dining room" }).click();
    const labels = await page.locator("svg.floor .t-elapsed").allTextContents();
    for (const l of labels) expect(l).not.toMatch(/^~\d+m$/);
    await expect(page.locator("svg.floor .t-elapsed.is-soon").first()).toContainText(/free ~\d+m/);
  });

  test("seated tiles are graphite; table numbers are always drawn", async ({ page }) => {
    await openFloor(page);
    await page.getByRole("tab", { name: "Whole room" }).click();
    const ids = await page.locator("svg.floor .t-id").count();
    const tables = await page.locator("svg.floor g.table").count();
    expect(ids).toBe(tables);
    const fills = await page
      .locator(
        "svg.floor g.table[aria-label*='occupied'] > rect:not(.hit):not(.phase-bar):not(.booth-back):not(.held-outline):not(.ring)",
      )
      .evaluateAll((els) => [...new Set(els.map((e) => getComputedStyle(e).fill))]);
    expect(fills.length).toBe(1);
  });
});

test.describe("iPad chrome, toasts and panels", () => {
  test("dark theme: the picked party size reads on its fill", async ({ page }) => {
    await openFloor(page);
    await hostButton(page, "+ Walk-in").click();
    const eight = page
      .locator(".walkin .size-grid")
      .getByRole("button", { name: "8", exact: true });
    await eight.click();
    const [fg, bg] = await eight.evaluate((e) => {
      const s = getComputedStyle(e);
      return [s.color, s.backgroundColor];
    });
    expect(fg).not.toBe(bg);
    expect(fg).toBe("rgb(20, 20, 20)");
  });

  test("a toast floats over the floor; the bar keeps its height", async ({ page }) => {
    await openFloor(page);
    await page.locator('svg.floor g[data-id="T3"]').focus();
    await page.keyboard.press("Enter");
    await page.locator(".table-card .finish-btn").click();
    const toast = page.locator(".toast");
    await expect(toast).toBeVisible();
    expect(await toast.evaluate((e) => getComputedStyle(e).position)).toBe("fixed");
    expect(await page.locator(".console-bar .toast, .topbar .toast").count()).toBe(0);
    const withToast = await page.locator(".console-bar").boundingBox();
    await toast.getByRole("button", { name: "Dismiss" }).click();
    await expect(toast).toHaveCount(0);
    expect(await page.locator(".console-bar").boundingBox()).toEqual(withToast);
  });

  test("no empty Table details panel: the panel opens with something in it, and has Close", async ({
    page,
  }) => {
    await openFloor(page);
    await expect(page.locator(".side-col")).toBeHidden();
    await page.locator('svg.floor g[data-id="T3"]').focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".side-col")).toBeVisible();
    await expect(page.locator(".panel-head").getByRole("button", { name: "Close" })).toBeVisible();
  });
});

test.describe("iPad floor and top bar", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 1280, "iPad landscape only");

  test("one top row ≤ 70 px with Scenarios in the nav; nothing overlaps", async ({ page }) => {
    await openFloor(page);
    const bar = await page.locator(".topbar").boundingBox();
    expect(bar?.height ?? 999).toBeLessThanOrEqual(70);
    await expect(page.locator(".topbar nav .scenario-menu summary")).toContainText("Scenarios");
    const nav = await page.locator(".topbar nav").boundingBox();
    const word = await page.locator(".wordmark").boundingBox();
    const theme = await page.locator(".theme-toggle").boundingBox();
    expect(word && nav && word.x + word.width < nav.x).toBe(true);
    expect(nav && theme && nav.x + nav.width <= theme.x).toBe(true);
  });

  test("Fit shows the whole room; zoom out is disabled (and looks it) once fitted", async ({
    page,
  }) => {
    await openFloor(page);
    const before = await page.locator(".floor-scroll svg").boundingBox();
    const out = page.getByRole("button", { name: "Zoom out" });
    await expect(out).toBeEnabled();
    await page.getByRole("button", { name: "Fit to panel" }).click();
    const after = await page.locator(".floor-scroll svg").boundingBox();
    const scroll = await page.locator(".floor-scroll").boundingBox();
    expect(after && before && after.width < before.width).toBe(true);
    expect(after && scroll && after.width <= scroll.width + 1).toBe(true);
    await expect(out).toBeDisabled();
    const [dis, en] = await Promise.all([
      out.evaluate((e) => getComputedStyle(e).color),
      page.getByRole("button", { name: "Zoom in" }).evaluate((e) => getComputedStyle(e).color),
    ]);
    expect(dis).not.toBe(en);
  });

  test("Lists opens over the floor as a drawer; the floor keeps its width", async ({ page }) => {
    await openFloor(page);
    await page.locator(".row-request .row-btn").first().click();
    const before = await page.locator(".floor-col").boundingBox();
    await page.locator(".rail-collapse").click();
    await expect(page.locator(".rail-lists")).toBeVisible();
    expect(await page.locator(".floor-col").boundingBox()).toEqual(before);
    expect(await page.locator(".rail").evaluate((e) => getComputedStyle(e).position)).toBe(
      "absolute",
    );
  });
});

test.describe("request flow: one state, demo clock, decisions stay open", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/requests/*/triage", (route) => route.abort());
    await page.route("**/api/agent", (route) => route.abort());
  });

  test("Mark as sent keeps Accept and Decline; the stamp is on the demo clock", async ({
    page,
  }) => {
    await page.goto("/?scenario=party-22-agent");
    const sheet = page.locator(".request-sheet");
    await sheet.getByRole("button", { name: "Message guest" }).click();
    await sheet.getByRole("button", { name: "Mark as sent" }).click();
    await expect(sheet.locator(".req-sent")).toContainText("Reply marked sent · Fri 3:00 PM");
    await expect(sheet.locator(".req-actions button.primary")).toHaveText("Accept");
    await expect(sheet.getByRole("button", { name: "Decline", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Activity" }).click();
    await expect(page.locator(".activity-table")).toContainText("Replied");
  });

  test("Decline: the reasons come into view and the footer's main button is the decline", async ({
    page,
  }) => {
    await page.goto("/?scenario=party-22-agent");
    const sheet = page.locator(".request-sheet");
    await sheet.getByRole("button", { name: "Decline", exact: true }).click();
    await expect(sheet.locator("fieldset.decline")).toBeInViewport();
    await expect(sheet.locator(".req-actions button.primary")).toHaveText(
      "Pick a reason to decline",
    );
    await sheet.getByRole("radio", { name: /Policy/ }).check();
    await sheet.getByRole("button", { name: "Decline: policy" }).click();
    await expect(sheet.locator(".req-decided")).toContainText("Declined: policy · Fri 3:00 PM");
  });

  test("the countdown reads from the night's clock and doesn't drift", async ({ page }) => {
    await page.clock.install();
    await page.goto("/?scenario=party-22-agent");
    const title = page.locator(".request-sheet .req-title");
    await expect(title).toContainText("(in 3h 30m)");
    await page.clock.fastForward("02:00");
    await expect(title).toContainText("(in 3h 30m)");
  });

  test("after Accept the floor stays on the accepted party, whatever is under the cursor", async ({
    page,
  }) => {
    await page.goto("/?scenario=party-22-agent");
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await page.getByRole("button", { name: "Accept · hold tables" }).click();
    await expect(page.locator(".accepted-card")).toBeVisible();
    await expect(page.locator(".floor-highlight-tag")).toContainText("Whitaker");
  });

  test("the live floor is Wednesday; the Friday walk-in shows on Friday with 'tomorrow'", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator(".room-select select option:checked")).toHaveText(
      "Wed · live service 7:10 PM",
    );
    await page.locator(".room-select select").selectOption("book-fri");
    const rail = page.getByRole("region", { name: /Requests/ });
    await expect(rail.locator(".row-request")).toHaveCount(6);
    await rail.locator(".row-request .row-btn", { hasText: "At host stand" }).click();
    const sheet = page.locator(".request-sheet");
    await expect(sheet).toContainText("received Fri 2:40 PM");
    await expect(sheet.locator(".req-message .field-label")).toHaveText("Host's note");
    await expect(sheet.locator(".req-message")).toContainText("tomorrow");
  });

  test("the demo shows the recorded triage summary, never a live one", async ({ page }) => {
    await page.goto("/");
    const rail = page.getByRole("region", { name: /Requests/ });
    await rail.locator(".row-request .row-btn", { hasText: "Thu" }).first().click();
    await expect(page.locator(".request-sheet .req-overview")).toContainText(
      "time is fixed at 7:30 PM",
    );
    await expect(page.locator(".request-sheet")).not.toContainText("unknown");
  });

  test("the activity log's newest request row is on the demo clock (no Saturday stamp)", async ({
    page,
  }) => {
    await page.goto("/activity");
    await expect(page.locator(".activity-table")).toContainText("Fri 2:40 PM");
    await expect(page.locator(".activity-table")).not.toContainText("Sat 2:40 PM");
  });

  test("a phase change keeps the seated time", async ({ page }) => {
    await page.goto("/");
    await page.locator('svg.floor g[data-id="T3"]').focus();
    await page.keyboard.press("Enter");
    const card = page.locator(".table-card");
    const seated = card
      .locator("dt", { hasText: "Seated" })
      .locator("xpath=following-sibling::dd[1]");
    const before = await seated.innerText();
    await card.locator(".phase-control").getByRole("button", { name: "Check" }).click();
    await expect(seated).toHaveText(before);
  });
});

test("chat Apply updates the rail row and the floor pill too (one request state)", async ({
  page,
}) => {
  await page.route("**/api/requests/*/chat", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        requestId: "Q2",
        traceId: "e2e-chat-2",
        promptVersion: "e2e",
        model: "e2e-stub",
        output: {
          tableRange: null,
          partySize: 26,
          time: "19:00",
          addNeeds: [],
          removeNeeds: [],
          notes: [],
          clarify: null,
        },
        escalated: false,
        note: null,
        validatorRejects: 0,
        input: { sha256: "e2e0000000000000", length: 19 },
        metrics: { costUsd: 0, latencyMs: 1, calls: [] },
      }),
    }),
  );
  await page.goto("/?scenario=party-22-agent");
  const sheet = page.locator(".request-sheet");
  await sheet.getByRole("button", { name: "Discuss" }).click();
  const chat = page.getByRole("region", { name: "Adjust this request" });
  await chat.getByRole("textbox", { name: "Message about this request" }).fill("26 at 7");
  await chat.getByRole("button", { name: "Send" }).click();
  await sheet
    .getByRole("group", { name: "Change proposed in chat" })
    .getByRole("button", { name: "Apply" })
    .click();
  await expect(sheet.locator(".req-title")).toContainText("party of 26");
  const row = page.locator(".row-request .row-btn[aria-current='true']");
  await expect(row).toContainText("26 ppl");
  await expect(row).toContainText("7:00 PM");
  await expect(page.locator(".floor-highlight-tag")).toContainText("party of 26");
});

test("/evals leads with the published deterministic checks", async ({ page }) => {
  await page.goto("/evals");
  const card = page.getByRole("region", { name: "Deterministic checks" });
  await expect(card).toContainText(/Deterministic checks · \d+\/\d+ pass/);
  const rows: [string, string][] = [
    ["Holds", "46/46"],
    ["Server sections", "46/46"],
    ["Aisle clearance", "52/52"],
    ["Can't-fit answers", "9/9"],
    ["Activity log", "10/10"],
    ["Request chat", "36/36"],
    ["Floor edits by conversation", "48/48"],
  ];
  for (const [label, n] of rows)
    await expect(card.getByRole("row", { name: new RegExp(label) })).toContainText(n);
  await expect(card.locator(".scenario-count:not(.floor-scenario-count)")).toContainText(
    "9 scenarios · 5 adversarial · 9/9 pass",
  );
  await expect(card.locator(".floor-scenario-count")).toContainText(
    "Floor edits by conversation25 scenarios · 12 adversarial · pass",
  );
  await expect(page.getByText("No evaluation run is published yet")).toHaveCount(0);
});

test.describe("host polish (P1)", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/requests/*/triage", (route) => route.abort());
    await page.route("**/api/agent", (route) => route.abort());
  });

  test("an open table offers Seat walk-in here, without repeating 'open now'", async ({ page }) => {
    await page.goto("/");
    await page.locator('svg.floor g[data-id="T10"]').focus();
    await page.keyboard.press("Enter");
    const card = page.locator(".table-card");
    await expect(card).not.toContainText("open now");
    await card.getByRole("button", { name: "Seat walk-in here" }).click();
    await expect(page.locator(".walkin .picked")).toContainText("table 10");
  });

  test("an AI option's highlight ends when its panel closes", async ({ page }) => {
    await page.goto("/?scenario=walkin-8-peak");
    await expect(page.locator(".side-col")).toBeVisible();
    await page.locator(".panel-head").getByRole("button", { name: "Close" }).click();
    await expect(page.locator(".floor-highlight-tag")).not.toContainText("AI option");
  });

  test("Saturday 14-top: the headline names storage; no 'move' to the same tables", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator(".room-select select").selectOption("demo-night");
    const rail = page.getByRole("region", { name: /Requests/ });
    await rail.locator(".row-request .row-btn", { hasText: "14" }).first().click();
    const sheet = page.locator(".request-sheet");
    await sheet.getByRole("button", { name: "More ▸" }).click();
    await expect(sheet.locator(".req-plan")).toBeVisible();
    const head = await sheet.locator(".req-plan .field-value").innerText();
    const cons = await sheet.getByRole("list", { name: "Cons" }).innerText();
    for (const line of cons.split("\n")) {
      const m = /from (tables? [\d–, and]+) to (tables? [\d–, and]+)/.exec(line);
      if (m) expect(m[2]?.startsWith(m[1] ?? "")).toBe(false);
    }
    expect(head).toMatch(/seating \d+|-top/);
  });

  test("Shift setup labels the walk-in capacity held for the whole night", async ({ page }) => {
    await page.goto("/?scenario=party-22-accepted");
    await expect(page.locator(".side-col")).toContainText("Walk-in capacity held · whole night");
    await expect(page.locator(".side-col")).not.toContainText("covers lost");
  });

  test("switching theme turns transitions off for the switch", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Light" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator("html")).not.toHaveClass(/theme-switching/);
  });
});

test.describe("review follow-ups", () => {
  test("Fit toggles back to touch scale on iPad; the Scenarios menu closes on Escape", async ({
    page,
    viewport,
  }) => {
    await page.goto("/");
    if ((viewport?.width ?? 0) <= 1280) {
      const fit = page.getByRole("button", { name: "Fit to panel" });
      const touch = await page.locator(".floor-scroll svg").boundingBox();
      await fit.click();
      await expect(fit).toHaveAttribute("aria-pressed", "true");
      await fit.click();
      await expect(fit).toHaveAttribute("aria-pressed", "false");
      expect((await page.locator(".floor-scroll svg").boundingBox())?.width).toBe(touch?.width);
    }
    await page.locator(".scenario-menu summary").click();
    await expect(page.locator(".scenario-menu ul")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".scenario-menu ul")).toBeHidden();
  });
});
