// Named demo states behind stable URLs (/?scenario=party-22-agent), so a reviewer lands on the exact case in one
// click. Fixture-driven and deterministic: AI answers come from recordings in fixtures/scenarios/ (real model
// output, captured once), so opening a scenario never calls a model. Fictional data only.
import chatJson from "../../fixtures/scenarios/request-chat.json";
import triageJson from "../../fixtures/scenarios/triage.json";
import walkinJson from "../../fixtures/scenarios/walkin-8-peak.json";
import { z } from "zod";
import { AgentResponse, RequestChatResult, TriageResult } from "../shared/api";

export interface Scenario {
  id: "party-22-agent" | "party-22-accepted" | "walkin-8-peak" | "request-chat";
  title: string;
  /** The night it opens on. */
  roomId: string;
  /** The request it opens, and how. */
  request?: { id: string; view: "request" | "plan"; accept?: boolean; chat?: boolean };
  /** The side panel it opens (when no request). */
  panel?: "assistant";
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "party-22-agent",
    title: "AI-agent request for 22 · capacity fit + cost",
    roomId: "book-fri",
    request: { id: "Q2", view: "request" },
  },
  {
    id: "party-22-accepted",
    title: "Party of 22 accepted · tonight's layout + crew list",
    roomId: "book-fri",
    request: { id: "Q2", view: "plan", accept: true },
  },
  {
    id: "walkin-8-peak",
    title: "Walk-in of 8 at 19:10 · assistant options",
    roomId: "dinner-peak",
    panel: "assistant",
  },
  {
    id: "request-chat",
    title: "In-request chat · “tables 30–50”",
    roomId: "book-fri",
    request: { id: "Q2", view: "request", chat: true },
  },
];

export const scenarioUrl = (id: Scenario["id"]) => `/?scenario=${id}`;

let active: Scenario | null | undefined;
/** The scenario named in the page URL, read once per page load. */
export function activeScenario(): Scenario | null {
  if (active === undefined) {
    const id =
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("scenario");
    active = SCENARIOS.find((s) => s.id === id) ?? null;
  }
  return active;
}

/** Tests only. */
export function resetScenario(): void {
  active = undefined;
}

export const RECORDED_TRIAGE: Record<string, TriageResult> = z
  .object({ note: z.string(), results: z.record(z.string(), TriageResult) })
  .parse(triageJson).results;

export const RECORDED_WALKIN = z
  .object({ note: z.string(), message: z.string(), response: AgentResponse })
  .parse(walkinJson);

export const RECORDED_CHAT = z
  .object({
    note: z.string(),
    requestId: z.string(),
    message: z.string(),
    result: RequestChatResult,
  })
  .parse(chatJson);
