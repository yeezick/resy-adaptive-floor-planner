// Scripted stand-in for the Messages API, for tests that must run without a key.
import type Anthropic from "@anthropic-ai/sdk";
import type { CreateMessage } from "./loop";

type Block =
  { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown };

export function fakeMessage(
  content: Block[],
  stop: Anthropic.Beta.BetaMessage["stop_reason"],
  usage: Partial<Anthropic.Beta.BetaUsage> = {},
  model = "claude-opus-5-5",
): Anthropic.Beta.BetaMessage {
  return {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: stop,
    usage: {
      input_tokens: 1000,
      output_tokens: 200,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      iterations: null,
      ...usage,
    },
  } as unknown as Anthropic.Beta.BetaMessage;
}

export const toolUse = (id: string, name: string, input: unknown) =>
  fakeMessage([{ type: "tool_use", id, name, input }], "tool_use");

export const finalAnswer = (out: unknown) =>
  fakeMessage([{ type: "text", text: JSON.stringify(out) }], "end_turn");

/** Returns the scripted messages in order and records every request. */
export function scripted(messages: Anthropic.Beta.BetaMessage[]) {
  const requests: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  const create: CreateMessage = async (params) => {
    requests.push(structuredClone(params));
    const next = messages.shift();
    if (!next) throw new Error("fake: no more scripted messages");
    return next;
  };
  return { create, requests };
}
