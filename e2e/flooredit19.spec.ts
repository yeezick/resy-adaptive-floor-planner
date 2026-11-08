import { expect, test, type Page } from "@playwright/test";

// ?scenario=floor-edit: the W9 floor edit recorded once from golden floor-g1-w9, opened with its proposal pending.
// Opening it never calls a model: every model route is counted and must stay at zero.

const W9 = "move 56 into the Library, move 63-66 into the Garden Room, 2 rows of 4 and 5";

async function open(page: Page, url = "/?scenario=floor-edit") {
  const modelCalls: string[] = [];
  for (const pattern of [
    "**/api/agent",
    "**/api/requests/*/chat",
    "**/api/requests/*/triage",
    "**/api/floor/chat",
  ])
    await page.route(pattern, (route) => {
      modelCalls.push(route.request().url());
      return route.abort();
    });
  await page.goto(url);
  return modelCalls;
}
const sheet = (page: Page) => page.locator(".request-sheet");
const diff = (page: Page) => page.getByRole("group", { name: "Change proposed in chat" });
const layouts = async (page: Page) =>
  JSON.parse(
    (await page.evaluate(() => localStorage.getItem("afp.layouts.v1.book-fri"))) ?? "{}",
  ) as { activeId?: string };

test.describe("scenario: floor edit by chat", () => {
  test("opens with the W9 turn, its reply and the floor change pending — no model call", async ({
    page,
  }) => {
    const modelCalls = await open(page);
    const log = page
      .getByRole("region", { name: "Adjust this request" })
      .getByRole("list", { name: "AI Planner chat" });
    await expect(log).toContainText(W9);
    await expect(log).toContainText(
      "I'd change the floor (5 changes) — see Proposed changes above. Capacity fit: tables 57–61 and 63–66 · Garden Room · seats 22 for 22 at 6:30 PM.",
    );
    await expect(page.locator(".change-ghost")).toHaveCount(5);
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
    await expect(
      page.locator(".decision-footer").getByRole("button", { name: "Accept" }),
    ).toBeDisabled();
    // nothing applied while pending: the night's layout in use is still the base
    expect((await layouts(page)).activeId ?? "base").toBe("base");
    await page.waitForLoadState("networkidle");
    expect(modelCalls).toEqual([]);
  });

  test("Apply → Whitaker in the Garden Room only", async ({ page }) => {
    const modelCalls = await open(page);
    await expect(page.locator(".change-ghost")).toHaveCount(5);
    await diff(page).getByRole("button", { name: "Apply" }).click();
    await expect(diff(page)).toHaveCount(0);
    await expect(sheet(page).locator(".changed-line")).toContainText(
      "Floor: Table 56 · Garden Room → Library front (round spot)",
    );
    await expect(page.locator(".decision-footer .feedforward")).toContainText(
      "Accept holds tables 57–61 and 63–66",
    );
    await expect(page.locator(".divider.is-open")).toHaveCount(0);
    expect((await layouts(page)).activeId).not.toBe("base");
    await expect(
      page.locator(".decision-footer").getByRole("button", { name: "Accept" }),
    ).toBeEnabled();
    expect(modelCalls).toEqual([]);
  });

  test("Discard → back to the two-room plan", async ({ page }) => {
    await open(page);
    await expect(page.locator(".change-ghost")).toHaveCount(5);
    await diff(page).getByRole("button", { name: "Discard" }).click();
    await expect(diff(page)).toHaveCount(0);
    await expect(page.locator(".change-ghost")).toHaveCount(0);
    await expect(page.locator(".divider.is-open")).toHaveCount(1);
    await expect(sheet(page).locator(".fit-pill")).toContainText("capacity fit ✓");
    await expect(sheet(page)).toContainText("Garden Room + Library");
    expect((await layouts(page)).activeId ?? "base").toBe("base");
    await expect(
      page.locator(".decision-footer").getByRole("button", { name: "Accept" }),
    ).toBeEnabled();
  });

  test("the Scenarios menu opens it", async ({ page }) => {
    const modelCalls = await open(page, "/");
    await page.locator(".scenario-menu summary").click();
    const link = page.locator('.scenario-menu a[href="/?scenario=floor-edit"]');
    await expect(link).toContainText("Floor edit by chat");
    await link.click();
    await expect(page).toHaveURL(/\?scenario=floor-edit$/);
    await expect(page.locator(".change-ghost")).toHaveCount(5);
    expect(modelCalls.filter((u) => !u.includes("/triage"))).toEqual([]);
  });
});
