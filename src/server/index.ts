import Anthropic from "@anthropic-ai/sdk";
import express, { type ErrorRequestHandler, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Room } from "../domain";
import { AgentRequest, RequestChatBody, RequestDecision, type ApiError } from "../shared/api";
import {
  AgentError,
  agentConfigFromEnv,
  runAgent,
  type AgentConfig,
  type CreateMessage,
} from "./agent/loop";
import { mergeClientRoom } from "./clientRoom";
import { forwardedForCount, parseTrustProxy, validateEnv } from "./config";
import { DailyBudget } from "./guards/budget";
import { RateLimiter } from "./guards/rateLimit";
import { hashText, logEvent } from "./log";
import { requestBook } from "./requests";
import { getRoom, roomSummaries } from "./rooms";
import {
  loadTriagePrompt,
  TriageError,
  triageConfigFromEnv,
  triageRequest,
  type TriageConfig,
} from "./triage";
import {
  RequestChatError,
  requestChatConfigFromEnv,
  requestChatTurn,
  type RequestChatConfig,
} from "./requestChat";
import type { TriageResult } from "../shared/api";

export interface AppOptions {
  /** Injected model call (tests). Default: the Anthropic SDK, created only when ANTHROPIC_API_KEY is set. */
  create?: CreateMessage;
  limiter?: RateLimiter;
  budget?: DailyBudget;
  /** Agent runs allowed at once across all clients (default MAX_CONCURRENT_RUNS or 2). */
  maxConcurrentRuns?: number;
  /** Overrides on the env-derived agent config (tests). */
  agent?: Partial<Pick<AgentConfig, "maxTokens" | "timeoutMs" | "model" | "effort">>;
  /** Overrides on the env-derived triage config (tests). */
  triage?: Partial<Pick<TriageConfig, "maxTokens" | "timeoutMs" | "model">>;
  /** Overrides on the env-derived request-chat config (tests). */
  requestChat?: Partial<Pick<RequestChatConfig, "maxTokens" | "timeoutMs" | "model">>;
}

function sendError(res: Response, status: number, code: ApiError["code"], error: string) {
  res.status(status).json({ error, code } satisfies ApiError);
}

/** The kind of address req.ip resolved to — never the address itself. */
function ipShape(req: Request): string {
  const ip = req.ip;
  if (!ip) return "missing";
  if (ip.startsWith("::ffff:")) return "ipv4-mapped";
  const v = isIP(ip);
  return v === 4 ? "ipv4" : v === 6 ? "ipv6" : "other";
}

export function createApp(opts: AppOptions = {}) {
  const app = express();
  app.disable("x-powered-by");
  // Behind Railway's proxy: trust one hop by default so req.ip is the client, not the proxy.
  const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
  app.set("trust proxy", trustProxy);
  // A posted room can hold up to MAX_TABLES (200) tables; the full-scale fixture alone is well over 32 kB.
  app.use(express.json({ limit: "256kb" }));

  const limiter = opts.limiter ?? RateLimiter.fromEnv();
  const budget = opts.budget ?? DailyBudget.fromEnv();
  const maxConcurrent = opts.maxConcurrentRuns ?? Number(process.env.MAX_CONCURRENT_RUNS ?? 2);
  let inFlight = 0;
  let loggedIpShape = false;
  let sdkCreate: CreateMessage | undefined;
  const create = (): CreateMessage | undefined => {
    if (opts.create) return opts.create;
    if (!process.env.ANTHROPIC_API_KEY) return undefined;
    if (!sdkCreate) {
      const client = new Anthropic();
      sdkCreate = (params, options) => client.beta.messages.create(params, options);
    }
    return sdkCreate;
  };

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/rooms", (_req, res) => {
    res.json(roomSummaries());
  });

  app.get("/api/rooms/:id", (req, res) => {
    const room = getRoom(req.params.id);
    if (!room) return sendError(res, 404, "bad_request", "unknown room");
    res.json(room);
  });

  app.post("/api/agent", async (req, res) => {
    if (!loggedIpShape) {
      loggedIpShape = true;
      logEvent("client_ip_shape", {
        shape: ipShape(req),
        trustProxy,
        // count only: sets TRUST_PROXY on a new host (never the addresses)
        xffCount: forwardedForCount(req.headers["x-forwarded-for"]),
        level: "debug",
      });
    }
    if (!limiter.hit(req.ip ?? "unknown"))
      return sendError(res, 429, "rate_limited", "Too many requests — try again in a minute.");

    const body = AgentRequest.safeParse(req.body);
    if (!body.success)
      return sendError(res, 400, "bad_request", body.error.issues[0]?.message ?? "invalid request");

    const fixture = getRoom(body.data.roomId);
    let room: Room | undefined = fixture;
    if (body.data.room) {
      if (body.data.room.id !== body.data.roomId)
        return sendError(res, 400, "bad_request", "invalid room: id does not match roomId");
      const merged = mergeClientRoom(fixture, body.data.room);
      if (!merged.ok) return sendError(res, 400, "bad_request", `invalid room: ${merged.error}`);
      room = merged.room;
    }
    if (!room) return sendError(res, 404, "bad_request", "unknown room");

    const call = create();
    if (!call)
      return sendError(
        res,
        503,
        "no_key",
        "The agent is not configured on this server (no API key).",
      );
    if (inFlight >= maxConcurrent)
      return sendError(res, 429, "rate_limited", "The planner is busy — try again in a moment.");
    if (budget.exhausted())
      return sendError(
        res,
        429,
        "budget",
        "The demo budget reached its daily limit — try again tomorrow.",
      );

    const traceId = randomUUID();
    const cfg: AgentConfig = { ...agentConfigFromEnv(call), ...opts.agent, budget };
    inFlight++;
    try {
      const { response } = await runAgent(
        { room, message: body.data.message, history: body.data.history, traceId },
        cfg,
      );
      logEvent("agent_response", {
        traceId,
        roomId: room.id,
        message: hashText(body.data.message),
        promptVersion: response.promptVersion,
        model: response.model,
        recommendations: response.recommendations.length,
        clarifying: response.clarifyingQuestion !== null,
        toolTurns: response.metrics.toolTurns,
        validatorRejects: response.metrics.validatorRejects,
        costUsd: response.metrics.costUsd,
        latencyMs: response.metrics.latencyMs,
        calls: response.metrics.calls.length,
      });
      res.json(response);
    } catch (e) {
      const code = e instanceof AgentError ? e.code : "upstream";
      logEvent("agent_error", {
        traceId,
        roomId: room.id,
        message: hashText(body.data.message),
        code,
        costUsd: e instanceof AgentError ? e.calls.reduce((n, c) => n + c.costUsd, 0) : null,
      });
      if (e instanceof AgentError) {
        const status = code === "timeout" ? 504 : code === "budget" ? 429 : 502;
        return sendError(res, status, code, e.message);
      }
      return sendError(res, 500, "upstream", "The agent failed unexpectedly.");
    } finally {
      inFlight--;
    }
  });

  app.get("/api/requests", (_req, res) => {
    res.json(requestBook());
  });

  // One triage per request per prompt version; later views are served from this cache (no new spend).
  // Escalated results (refusal, two validator rejects) are not cached, so a one-off can be retried.
  const triaged = new Map<string, TriageResult>();
  // Escalations are re-tried, but not on every view: hold one for a minute (a short negative cache).
  const escalatedUntil = new Map<string, { result: TriageResult; until: number }>();
  // Decisions are free (no model call): their own limiter, so clicks never use up the triage quota.
  const decisionLimiter = new RateLimiter(60);
  const triaging = new Map<string, Promise<TriageResult>>();
  app.post("/api/requests/:id/triage", async (req, res) => {
    const book = requestBook();
    const r = book.requests.find((x) => x.id === req.params.id);
    if (!r) return sendError(res, 404, "bad_request", "unknown request");
    const key = `${r.id}:${loadTriagePrompt().version}`;
    const hit = triaged.get(key);
    if (hit) return res.json({ ...hit, cached: true });
    const recent = escalatedUntil.get(key);
    if (recent && recent.until > Date.now()) return res.json({ ...recent.result, cached: true });
    if (!limiter.hit(req.ip ?? "unknown"))
      return sendError(res, 429, "rate_limited", "Too many requests — try again in a minute.");
    const call = create();
    if (!call)
      return sendError(
        res,
        503,
        "no_key",
        "AI triage is not configured on this server (no API key).",
      );
    if (budget.exhausted())
      return sendError(
        res,
        429,
        "budget",
        "The demo budget reached its daily limit — try again tomorrow.",
      );
    let pending = triaging.get(r.id);
    if (!pending) {
      const traceId = randomUUID();
      const cfg: TriageConfig = { ...triageConfigFromEnv(call), ...opts.triage, budget };
      pending = triageRequest(r, book.onlineCap, traceId, cfg);
      triaging.set(r.id, pending);
    }
    try {
      const result = await pending;
      if (!result.escalated) triaged.set(key, result);
      else escalatedUntil.set(key, { result, until: Date.now() + 60_000 });
      logEvent("triage_response", {
        traceId: result.traceId,
        requestId: r.id,
        message: hashText(r.message),
        promptVersion: result.promptVersion,
        model: result.model,
        verdict: result.verdict,
        escalated: result.escalated,
        validatorRejects: result.validatorRejects,
        costUsd: result.metrics.costUsd,
        latencyMs: result.metrics.latencyMs,
      });
      res.json(result);
    } catch (e) {
      const code = e instanceof TriageError ? e.code : "upstream";
      logEvent("triage_error", {
        requestId: r.id,
        message: hashText(r.message),
        code,
        costUsd: e instanceof TriageError ? e.calls.reduce((n, c) => n + c.costUsd, 0) : null,
      });
      const status = code === "timeout" ? 504 : code === "budget" ? 429 : 502;
      return sendError(res, status, code, e instanceof Error ? e.message : "triage failed");
    } finally {
      triaging.delete(r.id);
    }
  });

  // In-request chat: the manager's message → constraints for ONE request (the client re-runs the planner).
  // Request facts come in the body so host-stand walk-ins (created in the browser) work too; the id is only
  // a label. The message is logged as sha256 + length.
  app.post("/api/requests/:id/chat", async (req, res) => {
    if (!/^Q\d{1,4}$/.test(req.params.id))
      return sendError(res, 404, "bad_request", "unknown request");
    const body = RequestChatBody.safeParse(req.body);
    if (!body.success)
      return sendError(res, 400, "bad_request", body.error.issues[0]?.message ?? "invalid message");
    if (!limiter.hit(req.ip ?? "unknown"))
      return sendError(res, 429, "rate_limited", "Too many requests — try again in a minute.");
    const call = create();
    if (!call)
      return sendError(
        res,
        503,
        "no_key",
        "The request chat is not configured on this server (no API key). Nothing changed. You can set party, time, tables and needs on the review screen after Accept.",
      );
    if (budget.exhausted())
      return sendError(
        res,
        429,
        "budget",
        "The demo budget reached its daily limit — try again tomorrow.",
      );
    const traceId = randomUUID();
    try {
      const cfg: RequestChatConfig = {
        ...requestChatConfigFromEnv(call),
        ...opts.requestChat,
        budget,
      };
      const result = await requestChatTurn(req.params.id, body.data, traceId, cfg);
      logEvent("request_chat_response", {
        traceId,
        requestId: req.params.id,
        message: result.input,
        promptVersion: result.promptVersion,
        model: result.model,
        escalated: result.escalated,
        validatorRejects: result.validatorRejects,
        costUsd: result.metrics.costUsd,
        latencyMs: result.metrics.latencyMs,
      });
      res.json(result);
    } catch (e) {
      const code = e instanceof RequestChatError ? e.code : "upstream";
      logEvent("request_chat_error", {
        requestId: req.params.id,
        message: hashText(body.data.message),
        code,
        costUsd: e instanceof RequestChatError ? e.calls.reduce((n, c) => n + c.costUsd, 0) : null,
      });
      const status = code === "timeout" ? 504 : code === "budget" ? 429 : 502;
      return sendError(res, status, code, e instanceof Error ? e.message : "chat failed");
    }
  });

  // The manager's decision on a request: logged so decline reasons can be counted (the sprint's key
  // metric). Ids and enums only — no guest text.
  app.post("/api/requests/:id/decision", (req, res) => {
    const r = requestBook().requests.find((x) => x.id === req.params.id);
    if (!r) return sendError(res, 404, "bad_request", "unknown request");
    if (!decisionLimiter.hit(req.ip ?? "unknown"))
      return sendError(res, 429, "rate_limited", "Too many requests — try again in a minute.");
    const body = RequestDecision.safeParse(req.body);
    if (!body.success)
      return sendError(
        res,
        400,
        "bad_request",
        body.error.issues[0]?.message ?? "invalid decision",
      );
    logEvent("request_decision", { requestId: r.id, partySize: r.partySize, ...body.data });
    res.json({ ok: true });
  });

  app.use("/api", (_req, res) => sendError(res, 404, "bad_request", "unknown API route"));

  const here = path.dirname(fileURLToPath(import.meta.url));
  const clientDir = path.resolve(here, "../client");
  // redirect: false — /evals is a client route, but public/evals/ (results.json) is also a directory in dist/client.
  app.use(express.static(clientDir, { redirect: false }));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(clientDir, "index.html"));
  });

  const onError: ErrorRequestHandler = (
    err: { status?: number; type?: string },
    _req,
    res,
    next,
  ) => {
    if (res.headersSent) return next(err);
    const status = err.status ?? 500;
    if (status === 400 || status === 413)
      return sendError(
        res,
        status,
        "bad_request",
        err.type === "entity.too.large" ? "request too large" : "malformed JSON body",
      );
    logEvent("server_error", { status });
    return sendError(res, 500, "upstream", "internal error");
  };
  app.use(onError);
  return app;
}

if (process.env.NODE_ENV !== "test") {
  try {
    validateEnv();
    parseTrustProxy(process.env.TRUST_PROXY);
  } catch (e) {
    console.error(`Configuration error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  const port = Number(process.env.PORT ?? 3001);
  createApp().listen(port, () => {
    console.log(JSON.stringify({ msg: "listening", port }));
  });
}
