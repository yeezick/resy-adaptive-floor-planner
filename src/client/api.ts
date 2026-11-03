// Fetch helpers. Every response is parsed with the shared zod schemas before the UI sees it.
import { z } from "zod";
import { parseRoom, type Room } from "../domain";
import { parseRequestBook, type RequestBook } from "../domain/requests";
import {
  AgentResponse,
  ApiError,
  RoomSummary,
  TriageResult,
  type AgentRequest,
} from "../shared/api";
import { EvalResults } from "../shared/evals";

export type ClientErrorCode = ApiError["code"] | "network" | "not_found" | "bad_response";
export interface ClientError {
  code: ClientErrorCode;
  message: string;
}
export type Result<T> = { ok: true; data: T } | { ok: false; error: ClientError };

const fail = (code: ClientErrorCode, message: string): { ok: false; error: ClientError } => ({
  ok: false,
  error: { code, message },
});

function schemaParser<T>(schema: z.ZodType<T>): (body: unknown) => T {
  return (body) => {
    const r = schema.safeParse(body);
    if (!r.success) throw new Error(z.prettifyError(r.error));
    return r.data;
  };
}

async function call<T>(
  url: string,
  parse: (body: unknown) => T,
  init?: RequestInit,
): Promise<Result<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return fail("network", "Can't reach the server.");
  }
  const type = res.headers.get("content-type") ?? "";
  const isJson = type.includes("json");
  const body: unknown = isJson ? await res.json().catch(() => undefined) : undefined;

  if (!res.ok) {
    const api = ApiError.safeParse(body);
    if (api.success) return fail(api.data.code, api.data.error);
    if (res.status === 404) return fail("not_found", `Not found: ${url}`);
    return fail("bad_response", `The server returned ${res.status}.`);
  }
  // A dev server's SPA fallback answers unknown paths with index.html and a 200.
  if (!isJson) {
    return type.includes("text/html")
      ? fail("not_found", `Not found: ${url}`)
      : fail("bad_response", "The server did not return JSON.");
  }
  try {
    return { ok: true, data: parse(body) };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return fail("bad_response", `Response did not match the expected shape.\n${detail}`);
  }
}

export function fetchRooms(): Promise<Result<RoomSummary[]>> {
  return call("/api/rooms", schemaParser(z.array(RoomSummary)));
}

export function fetchRoom(id: string): Promise<Result<Room>> {
  return call(`/api/rooms/${encodeURIComponent(id)}`, parseRoom);
}

export function postAgent(req: AgentRequest): Promise<Result<AgentResponse>> {
  return call("/api/agent", schemaParser(AgentResponse), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
}

export function fetchEvalResults(): Promise<Result<EvalResults>> {
  return call("/evals/results.json", schemaParser(EvalResults), { cache: "no-store" });
}

export function fetchRequests(): Promise<Result<RequestBook>> {
  return call("/api/requests", parseRequestBook);
}

export function postTriage(id: string): Promise<Result<TriageResult>> {
  return call(`/api/requests/${encodeURIComponent(id)}/triage`, schemaParser(TriageResult), {
    method: "POST",
  });
}
