import { expect, test, type Page, type Route } from "@playwright/test";

// Floor changes by conversation: the manager's words → structured operations (the model is stubbed here, no API
// cost) → the floor engine places, checks and re-plans → a proposal drawn on the floor → Apply → Undo.

const none = {
  tableRange: null,
  partySize: null,
  time: null,
  addNeeds: [],
  removeNeeds: [],
  notes: [],
  clarify: null,
  rooms: [],
  oneRoom: "unchanged",
  ops: [],
};
const ref = (p: Record<string, unknown>) => ({
  by: "number",
  n: 0,
  from: 0,
  to: 0,
  shape: "any",
  seats: 0,
  room: "",
  ...p,
});
const op = (p: Record<string, unknown>) => ({
  op: "move",
  tables: [],
  to: "",
  seats: 0,
  count: 0,
  rows: [],
  ...p,
});
const chatBody = (output: Record<string, unknown>) =>
  JSON.stringify({
    requestId: "Q2",
    traceId: `stub-${Math.random().toString(36).slice(2)}`,
    promptVersion: "request-chat.v1.2",
    model: "stub",
    output: { ...none, ...output },
    escalated: false,
    note: null,
    validatorRejects: 0,
    input: { sha256: "x", length: 1 },
    metrics: { costUsd: 0, latencyMs: 1, calls: [] },
  });
const fulfill = (route: Route, body: string) =>
  route.fulfill({ status: 200, contentType: "application/json", body });

export const W9 = "move 56 into the Library, move 63-66 into the Garden Room, 2 rows of 4 and 5";
const W9_OUT = {
  ops: [
    op({ tables: [ref({ n: 56 })], to: "Library" }),
    op({ tables: [ref({ by: "range", from: 63, to: 66 })], to: "Garden Room" }),
    op({ op: "arrange_rows", to: "Garden Room", rows: [4, 5] }),
  ],
};

async function openChat(page: Page, script: Record<string, string>) {
  const sent: { message: string; bookRoomId?: string }[] = [];
  await page.route("**/api/requests/*/triage", (route) => route.abort());
  await page.route("**/api/requests/*/chat", async (route) => {
    const b = route.request().postDataJSON() as { message: string; bookRoomId?: string };
    sent.push(b);
    const body = script[b.message];
    return body ? fulfill(route, body) : route.abort();
  });
  await page.goto("/?scenario=party-22-agent");
  await page.locator(".request-sheet").getByRole("button", { name: "Discuss" }).click();
  return sent;
}
const box = (page: Page) => page.getByRole("textbox", { name: "Message about this request" });
const say = async (page: Page, text: string) => {
  await box(page).fill(text);
  await box(page).press("Enter");
};
const replies = (page: Page) => page.locator(".req-chat .chat-log > li:not(.chat-noted) .chat-out");
const diff = (page: Page) => page.getByRole("group", { name: "Change proposed in chat" });

test.describe("floor changes by conversation", () => {
  test("W9: proposal drawn → Apply (2 taps after typing) → Whitaker in the Garden Room only → Undo", async ({
    page,
  }) => {
    const sent = await openChat(page, { [W9]: chatBody(W9_OUT) });
    const tables57 = page.locator('[data-table-id="T63"]');
    await say(page, W9); // tap 1: Send (Enter)
    await expect(replies(page).last()).toHaveText(
      "I'd change the floor (5 changes) — see Proposed changes above. Capacity fit: tables 57–61 and 63–66 · Garden Room · seats 22 for 22 at 6:30 PM.",
    );
    expect(sent[0]?.bookRoomId).toBe("book-fri");
    // the proposal: floor changes, capacity before → after, bookings moved, crew steps
    await expect(diff(page).getByRole("list", { name: "Floor changes" })).toContainText(
      "Table 63 · Library → Garden Room back row",
    );
    await expect(diff(page)).toContainText(
      "tables 57–61 and 63–66 · Garden Room + Library (divider open) · two servers (sections 10 + 11) → tables 57–61 and 63–66 · Garden Room only · one server (section 10)",
    );
    await expect(diff(page).getByRole("list", { name: "Bookings moved" })).toHaveText("None");
    await expect(diff(page).getByRole("list", { name: "Crew steps" })).toContainText(
      "Move table 56 from the Garden Room to the Library front (round spot)",
    );
    // drawn on the floor, nothing applied: Accept waits
    await expect(page.getByText("Previewing the floor change proposed in chat")).toBeVisible();
    await expect(page.locator(".change-ghost")).toHaveCount(5);
    await expect(
      page.locator(".decision-footer").getByRole("button", { name: "Accept" }),
    ).toBeDisabled();
    void tables57;

    await diff(page).getByRole("button", { name: "Apply" }).click(); // tap 2: Apply
    await expect(diff(page)).toHaveCount(0);
    const changed = page.locator(".changed-line");
    await expect(changed).toContainText(
      "Floor: Table 56 · Garden Room → Library front (round spot)",
    );
    await expect(page.locator(".req-more, .request-sheet").first()).toBeVisible();
    await expect(page.locator(".decision-footer .feedforward")).toContainText(
      "Accept holds tables 57–61 and 63–66",
    );
    // the night's layout in use is now a one-day layout; the chat turns survived the remount
    await expect(replies(page)).toHaveCount(1);
    const stored = await page.evaluate(() => localStorage.getItem("afp.layouts.v1.book-fri"));
    const active = JSON.parse(stored ?? "{}") as { activeId: string; variants: { id: string }[] };
    expect(active.activeId).not.toBe("base");

    // Undo (Revert) restores the previous layout
    await changed.getByRole("button", { name: "Revert" }).click();
    await expect(page.locator(".changed-line")).toHaveCount(0);
    const after = JSON.parse(
      (await page.evaluate(() => localStorage.getItem("afp.layouts.v1.book-fri"))) ?? "{}",
    ) as { activeId: string; variants: { id: string }[] };
    expect(after.activeId).toBe("base");
    expect(after.variants.some((v) => v.id === active.activeId)).toBe(false);
  });

  test("a rejected change lists the reasons and proposes nothing; Accept stays available", async ({
    page,
  }) => {
    await openChat(page, {
      "swap table 56 and table 62": chatBody({
        ops: [op({ op: "swap", tables: [ref({ n: 56 }), ref({ n: 62 })] })],
      }),
    });
    await say(page, "swap table 56 and table 62");
    await expect(replies(page).last()).toHaveText(
      "Table 56 (round, 8) doesn't fit where table 62 stands. Table 62 (diamond, 4) doesn't fit where table 56 stands. Nothing changed.",
    );
    await expect(diff(page)).toHaveCount(0);
    await expect(
      page.locator(".decision-footer").getByRole("button", { name: "Accept" }),
    ).toBeEnabled();
  });

  test("T22: after Discard the message box sits fully above the sticky footer", async ({
    page,
  }) => {
    await openChat(page, { [W9]: chatBody(W9_OUT) });
    await say(page, W9);
    await expect(diff(page)).toBeVisible();
    await diff(page).getByRole("button", { name: "Discard" }).click();
    await expect(diff(page)).toHaveCount(0);
    await expect
      .poll(async () => {
        const b = await box(page).boundingBox();
        const f = await page.locator(".decision-footer").boundingBox();
        return b && f ? Math.round(f.y - (b.y + b.height)) : -1;
      })
      .toBeGreaterThanOrEqual(0);
  });

  test("T21: the chat log follows the newest turn", async ({ page }) => {
    await openChat(page, {});
    for (const m of [
      "save this as the base layout",
      "delete all the tables",
      "move the bar into the Library",
    ])
      for (let i = 0; i < 3; i++) await say(page, m);
    const log = page.locator(".req-chat .chat-log");
    await expect
      .poll(() => log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
      .toBeLessThan(4);
    await expect(replies(page).last()).toHaveText(
      "I can't move the bar, walls or the service station — only tables. Nothing changed.",
    );
  });
});

test.describe("Shift setup: Tell the AI", () => {
  test("G6 by words: 62 out, two 4-tops in → proposal drawn → Apply → Undo", async ({ page }) => {
    const msg = "remove table 62 and add two 4-tops from storage in the Library";
    const seen: { roomId?: string }[] = [];
    await page.route("**/api/floor/chat", async (route) => {
      seen.push(route.request().postDataJSON() as { roomId?: string });
      return fulfill(
        route,
        chatBody({
          ops: [
            op({ op: "to_storage", tables: [ref({ n: 62 })] }),
            op({ op: "from_storage", seats: 4, count: 2, to: "Library" }),
          ],
        }),
      );
    });
    await page.goto("/?room=book-fri");
    await page.locator(".room-select select").selectOption("book-fri");
    await page
      .getByRole("group", { name: "Host actions" })
      .getByRole("button", { name: "Shift setup", exact: true })
      .click();
    const tell = page.getByRole("region", { name: "Tell the AI" });
    await tell.getByRole("textbox").fill(msg);
    await tell.getByRole("textbox").press("Enter");
    const card = page.getByRole("group", { name: "Floor change proposed in Shift setup" });
    await expect(card.getByRole("list", { name: "Floor changes" })).toHaveText(
      [
        "Table 62 · Library → set aside for tonight",
        "New table 96 (4-top from storage) · → Library (where table 62 stood)",
        "New table 97 (4-top from storage) · → Library spare spot",
      ].join(""),
    );
    expect(seen[0]?.roomId).toBe("book-fri");
    await expect(page.getByText("Previewing the floor change proposed in chat")).toBeVisible();
    await card.getByRole("button", { name: "Apply" }).click();
    await expect(tell.getByRole("status")).toContainText("Floor changed: Table 62");
    const active = () =>
      page.evaluate(
        () =>
          (
            JSON.parse(localStorage.getItem("afp.layouts.v1.book-fri") ?? "{}") as {
              activeId?: string;
            }
          ).activeId,
      );
    expect(await active()).not.toBe("base");
    await tell.getByRole("button", { name: "Undo" }).click();
    await expect.poll(active).toBe("base");
  });

  test("the bar is not a table: refused on the device", async ({ page }) => {
    let calls = 0;
    await page.route("**/api/floor/chat", (route) => {
      calls++;
      return route.abort();
    });
    await page.goto("/");
    await page
      .getByRole("group", { name: "Host actions" })
      .getByRole("button", { name: "Shift setup", exact: true })
      .click();
    const tell = page.getByRole("region", { name: "Tell the AI" });
    await tell.getByRole("textbox").fill("move the bar into the Library");
    await tell.getByRole("textbox").press("Enter");
    await expect(tell).toContainText(
      "I can't move the bar, walls or the service station — only tables. Nothing changed.",
    );
    expect(calls).toBe(0);
  });
});
