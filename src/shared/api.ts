// Contract between the client and the server. Change both sides together.
import { z } from "zod";
import { Room } from "../domain/types";
import { ChatConstraints, ChatTurnRecorded } from "../domain/requestChat";
import { NEEDS } from "../domain/requests";

export const MAX_MESSAGE_CHARS = 500;
/** Total characters of prior turns a client may send back (keeps injected "assistant" text and spend small). */
export const MAX_HISTORY_CHARS = 2000;
export const MAX_TURN_CHARS = 1000;
export const MAX_OPEN_REQUESTS = 12;

/** One open large-party request as the AI Planner sees it: a guest name, never a request id. */
export const OpenRequestBrief = z
  .object({
    name: z.string().min(1).max(60),
    partySize: z.number().int().positive().max(500),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    needs: z.array(z.enum(NEEDS)).max(4),
  })
  .strict();
export type OpenRequestBrief = z.infer<typeof OpenRequestBrief>;

export const AgentRequest = z
  .object({
    roomId: z.string(),
    /** The client's current room (after manual edits). The server re-validates it with parseRoom. */
    room: Room.optional(),
    message: z.string().min(1).max(MAX_MESSAGE_CHARS),
    history: z
      .array(
        z
          .object({ role: z.enum(["user", "assistant"]), text: z.string().max(MAX_TURN_CHARS) })
          .strict(),
      )
      .max(10)
      .default([])
      .refine((h) => h.reduce((n, m) => n + m.text.length, 0) <= MAX_HISTORY_CHARS, {
        message: `history is limited to ${MAX_HISTORY_CHARS} characters`,
      }),
    /**
     * The party the host is asking about, when the screen knows it (the host's message, the walk-in form or the
     * open request). The validator rejects any recommendation that seats fewer.
     */
    partySize: z.number().int().positive().max(500).optional(),
    /** The night's open large-party requests, by guest name (never an id), so the planner can weigh them. */
    openRequests: z.array(OpenRequestBrief).max(MAX_OPEN_REQUESTS).optional(),
  })
  .strict();
export type AgentRequest = z.infer<typeof AgentRequest>;

export const Recommendation = z
  .object({
    rank: z.number().int().positive(),
    tables: z.array(z.string()).min(1),
    seats: z.number().int().positive(),
    waitMin: z.number().int().min(0),
    reasoning: z.string(),
    tradeoffs: z.array(z.string()),
  })
  .strict();
export type Recommendation = z.infer<typeof Recommendation>;

export const CallMetrics = z
  .object({
    traceId: z.string(),
    role: z.enum(["agent", "judge", "triage", "request-chat"]),
    model: z.string(),
    promptVersion: z.string(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    cacheReadTokens: z.number().int(),
    cacheWriteTokens: z.number().int(),
    costUsd: z.number(),
    latencyMs: z.number(),
    stopReason: z.string().nullable(),
  })
  .strict();
export type CallMetrics = z.infer<typeof CallMetrics>;

export const AgentResponse = z
  .object({
    traceId: z.string(),
    promptVersion: z.string(),
    model: z.string(),
    answer: z.string(),
    clarifyingQuestion: z.string().nullable(),
    recommendations: z.array(Recommendation),
    toolCalls: z.array(z.object({ name: z.string(), ok: z.boolean() }).strict()),
    validator: z.object({ rejects: z.number().int(), notes: z.array(z.string()) }).strict(),
    metrics: z
      .object({
        costUsd: z.number(),
        latencyMs: z.number(),
        toolTurns: z.number().int(),
        validatorRejects: z.number().int(),
        calls: z.array(CallMetrics),
      })
      .strict(),
  })
  .strict();
export type AgentResponse = z.infer<typeof AgentResponse>;

export const ApiError = z.object({
  error: z.string(),
  code: z.enum(["bad_request", "rate_limited", "budget", "timeout", "upstream", "no_key"]),
});
export type ApiError = z.infer<typeof ApiError>;

/** GET /api/rooms → RoomSummary[] ; GET /api/rooms/:id → Room ; POST /api/agent → AgentResponse | ApiError */
export const RoomSummary = z.object({ id: z.string(), name: z.string(), clock: z.string() });
export type RoomSummary = z.infer<typeof RoomSummary>;

export const TriageResult = z
  .object({
    requestId: z.string(),
    traceId: z.string(),
    promptVersion: z.string(),
    model: z.string(),
    verdict: z.enum(["real", "junk", "unsure"]),
    reason: z.string(),
    summary: z.array(z.string()).length(2),
    /** True when a person must read it: the model was unsure, refused, or failed validation twice. */
    escalated: z.boolean(),
    validatorRejects: z.number().int(),
    /** The guest's text as sha256 + length (the text itself is never logged). */
    input: z.object({ sha256: z.string(), length: z.number().int() }).strict(),
    /** True when served from the server's cache (no new model call). */
    cached: z.boolean().optional(),
    metrics: z
      .object({ costUsd: z.number(), latencyMs: z.number(), calls: z.array(CallMetrics) })
      .strict(),
  })
  .strict();
export type TriageResult = z.infer<typeof TriageResult>;

export const RequestDecision = z
  .object({
    kind: z.enum(["accepted", "declined", "replied", "reopened"]),
    reason: z.enum(["fit", "policy", "other"]).optional(),
    edited: z.boolean().optional(),
  })
  .strict();
export type RequestDecision = z.infer<typeof RequestDecision>;

/** One in-request chat turn: the manager's message about ONE request, plus where the card stands now. */
export const RequestChatBody = z
  .object({
    message: z.string().trim().min(1).max(300),
    request: z
      .object({
        partySize: z.number().int().positive().max(500),
        day: z.enum(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        needs: z.array(z.enum(NEEDS)).max(4),
      })
      .strict(),
    constraints: ChatConstraints,
    /** The room fixture that holds the request's night: the server derives the trusted room names from it. */
    bookRoomId: z.string().min(1).max(40),
    /** Rooms the request's current plan uses (data only, e.g. "Garden Room + Library"). */
    planRooms: z.array(z.string().min(1).max(40)).max(4).optional(),
  })
  .strict();
export type RequestChatBody = z.infer<typeof RequestChatBody>;

/** Shift setup's "Tell the AI": a floor change for the night on screen, with no request. */
export const FloorChatBody = z
  .object({
    message: z.string().trim().min(1).max(300),
    /** The room fixture of the night on screen: the trusted room names come from it. */
    roomId: z.string().min(1).max(40),
  })
  .strict();
export type FloorChatBody = z.infer<typeof FloorChatBody>;

export const RequestChatResult = z
  .object({
    requestId: z.string(),
    traceId: z.string(),
    promptVersion: z.string(),
    model: z.string(),
    /** The validated constraints for this turn; null when the AI couldn't produce usable ones. */
    output: ChatTurnRecorded.nullable(),
    escalated: z.boolean(),
    /** Why there is no output (refusal, two rejects), in one line. */
    note: z.string().nullable(),
    validatorRejects: z.number().int(),
    /** The manager's message as sha256 + length (the text itself is never logged). */
    input: z.object({ sha256: z.string(), length: z.number().int() }).strict(),
    metrics: z
      .object({ costUsd: z.number(), latencyMs: z.number(), calls: z.array(CallMetrics) })
      .strict(),
  })
  .strict();
export type RequestChatResult = z.infer<typeof RequestChatResult>;
