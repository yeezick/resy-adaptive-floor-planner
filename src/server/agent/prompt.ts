// Loads the agent system prompt at runtime from prompts/agent.v1.md and exposes its version.
import { readFileSync } from "node:fs";
import path from "node:path";

export interface LoadedPrompt {
  version: string;
  text: string;
}

export function parsePrompt(raw: string): LoadedPrompt {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!m) throw new Error("prompt is missing front-matter");
  const version = /^version:\s*(\S+)\s*$/m.exec(m[1] ?? "")?.[1];
  if (!version) throw new Error("prompt front-matter has no version");
  return { version, text: (m[2] ?? "").trim() };
}

export function promptPath(): string {
  return path.resolve(process.cwd(), process.env.AGENT_PROMPT_PATH ?? "prompts/agent.v1.md");
}

let cached: LoadedPrompt | undefined;

export function loadPrompt(): LoadedPrompt {
  cached ??= parsePrompt(readFileSync(promptPath(), "utf8"));
  return cached;
}

/** Version from the prompt's front-matter, e.g. "agent.v1.0". */
export const PROMPT_VERSION: string = loadPrompt().version;
