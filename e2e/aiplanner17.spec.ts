import { expect, test, type Page } from "@playwright/test";

import type { AgentRequest, AgentResponse } from "../src/shared/api";

// The AI Planner on a request night: floor edits answered on the device, the party size and the night's open
// requests sent with the message, party names (never reservation ids), and the floor's room tab kept.
const hostButton = (page: Page, name: string) =>
  page.getByRole("group", { name: "Host actions" }).getByRole("button", { name, exact: true });

const stub: AgentResponse = {
  traceId: "e2e-stub",
  promptVersion: "e2e",
  model: "e2e-stub",
  answer:
    "Which party is the 22-top: is it F4 (booked as 24 at 9:00 PM)? T41 is free in about 11 min.",
  clarifyingQuestion: null,
  recommendations: [],
  toolCalls: [],
  validator: { rejects: 0, notes: [] },
  metrics: { costUsd: 0, latencyMs: 0, toolTurns: 0, validatorRejects: 0, calls: [] },
};

/** Every AI Planner call is stubbed ($0); returns the request bodies it received. */
async function stubAgent(page: Page): Promise<AgentRequest[]> {
  const bodies: AgentRequest[] = [];
  await page.route("**/api/agent", (route) => {
    bodies.push(route.request().postDataJSON() as AgentRequest);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(stub),
    });
  });
  await page.route("**/api/requests/*/triage", (route) => route.abort());
  await page.route("**/api/requests/*/chat", (route) => route.abort());
  return bodies;
}

async function send(page: Page, text: string) {
  await page.locator("#agent-input").fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

test("a floor edit is answered on the device, with no model call", async ({ page }) => {
  const bodies = await stubAgent(page);
  await page.goto("/?scenario=walkin-8-peak");
  await expect(page.locator(".rec-card")).toHaveCount(3);
  await send(page, "join tables 39 and 40 for them and add 2 chairs from the back");
  await expect(page.locator(".transcript .bubble.assistant").last()).toContainText(
    "Floor changes are made in Shift setup or a request's Discuss chat — nothing changed.",
  );
  expect(bodies).toHaveLength(0);
});

test("a walk-in ask goes to the model with the party size; ids read as names", async ({ page }) => {
  const bodies = await stubAgent(page);
  await page.goto("/?scenario=walkin-8-peak");
  await expect(page.locator(".rec-card")).toHaveCount(3);
  await send(page, "they're 10 now and want the Terrace");
  const answer = page.locator(".transcript .bubble.assistant").last();
  await expect(answer).toContainText("Which party is the 22-top");
  await expect(answer).not.toContainText("F4");
  await expect(answer).not.toContainText("T41");
  expect(bodies).toHaveLength(1);
  expect(bodies[0]?.partySize).toBe(10);
});

test("opened from a request, the AI Planner keeps the floor's room tab and gets the open requests", async ({
  page,
}) => {
  const bodies = await stubAgent(page);
  await page.goto("/?scenario=party-22-agent");
  await expect(page.locator(".request-sheet .req-title")).toContainText(
    "Sam Whitaker · party of 22",
  );
  const tab = page.locator(".room-tabs [role=tab][aria-selected=true]");
  await expect(tab).toHaveCount(1);
  const before = await tab.textContent();
  expect(before).not.toBe("Dining room");

  await hostButton(page, "AI Planner").click();
  await expect(page.locator("#panel-title")).toContainText("AI Planner");
  await expect(tab).toHaveText(before ?? "");
  await expect(page.getByRole("button", { name: /Back to Large-party request/ })).toBeVisible();

  await send(page, "where can they go?");
  await expect(page.locator(".transcript .bubble.assistant").last()).toContainText("Which party");
  const body = bodies[0];
  expect(body?.partySize).toBe(22);
  expect(body?.openRequests?.some((r) => r.name === "Whitaker" && r.partySize === 22)).toBe(true);
  expect(JSON.stringify(body?.openRequests)).not.toMatch(/"Q\d+"/);
});
