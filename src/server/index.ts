import Anthropic from "@anthropic-ai/sdk";
import express, { type ErrorRequestHandler, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Room } from "../domain";
import { AgentRequest, type ApiError } from "../shared/api";
import {
  AgentError,
  agentConfigFromEnv,
  runAgent,
  type AgentConfig,
  type CreateMessage,
} from "./agent/loop";
import { mergeClientRoom } from "./clientRoom";
import { parseTrustProxy, validateEnv } from "./config";
import { DailyBudget } from "./guards/budget";
import { RateLimiter } from "./guards/rateLimit";
import { hashText, logEvent } from "./log";
import { getRoom, roomSummaries } from "./rooms";

export interface AppOptions {
  /** Injected model call (tests). Default: the Anthropic SDK, created only when ANTHROPIC_API_KEY is set. */
  create?: CreateMessage;
  limiter?: RateLimiter;
  budget?: DailyBudget;
  /** Agent runs allowed at once across all clients (default MAX_CONCURRENT_RUNS or 2). */
  maxConcurrentRuns?: number;
  /** Overrides on the env-derived agent config (tests). */
  agent?: Partial<Pick<AgentConfig, "maxTokens" | "timeoutMs" | "model" | "effort">>;
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
      logEvent("client_ip_shape", { shape: ipShape(req), trustProxy, level: "debug" });
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
