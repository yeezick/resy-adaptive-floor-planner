// Contract between the client and the server. Change both sides together.
import { z } from "zod";
import { Room } from "../domain/types";

export const MAX_MESSAGE_CHARS = 500;
/** Total characters of prior turns a client may send back (keeps injected "assistant" text and spend small). */
export const MAX_HISTORY_CHARS = 2000;
export const MAX_TURN_CHARS = 1000;

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
    role: z.enum(["agent", "judge"]),
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
