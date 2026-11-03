// Turns recorded transcripts into a markdown labeling sheet (evals/labelsheet.md) for a person to grade
// PASS/FAIL against evals/rubric.md. Labels then go into evals/labels.jsonl as {id, pass, reason} (human-only tier).
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  EVALS_DIR,
  LABELS_META_PATH,
  LABELS_PATH,
  LabelsMeta,
  readTranscripts,
  writeJson,
  type Transcript,
} from "./transcript";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** One line per tool call: name(input) → short result. */
export function briefToolCalls(t: Transcript, maxResult = 160): string[] {
  return (t.trace?.tools ?? []).map((c) => {
    const input = JSON.stringify(c.input);
    if (!c.ok) return `${c.name}(${input}) → ERROR: ${c.error ?? "failed"}`;
    const out = c.output as Record<string, unknown> | undefined;
    let summary: string;
    if (c.name === "find_tables_for_party" && out && Array.isArray(out.options))
      summary =
        (out.options as { tables: string[]; seats: number; waitMin: number }[])
          .map((o) => `${o.tables.join("+")} (${o.seats} seats, ${o.waitMin} min)`)
          .join("; ") + (typeof out.note === "string" ? ` — ${out.note}` : "");
    else summary = JSON.stringify(out);
    return `${c.name}(${input}) → ${clip(summary || "(empty)", maxResult)}`;
  });
}

export function renderLabelSheet(transcripts: readonly Transcript[]): string {
  const lines = [
    "# Labeling sheet",
    "",
    "Grade each run PASS or FAIL against `evals/rubric.md`, with a one-line reason. Then copy the verdicts into",
    '`evals/labels.jsonl`, one line per scenario: `{"id": "...", "pass": true, "reason": "..."}`.',
    "",
  ];
  const first = transcripts.find((t) => t.response);
  if (first)
    lines.push(
      `Run: prompt ${first.promptVersion} · model ${first.response?.model ?? first.model}`,
      "",
    );
  for (const t of transcripts) {
    lines.push(`## ${t.id} (${t.scenario.category})`, "", `**Prompt:** ${t.scenario.prompt}`, "");
    if (!t.response) {
      lines.push(`**Run failed:** ${t.error?.code}: ${t.error?.message}`, "");
    } else {
      const r = t.response;
      lines.push(`**Answer:** ${r.answer}`, "");
      if (r.clarifyingQuestion) lines.push(`**Clarifying question:** ${r.clarifyingQuestion}`, "");
      if (r.recommendations.length) {
        lines.push("**Recommendations:**", "");
        for (const rec of r.recommendations) {
          lines.push(
            `${rec.rank}. ${rec.tables.join(" + ")} — ${rec.seats} seats, ~${rec.waitMin} min. ${rec.reasoning}`,
          );
          if (rec.tradeoffs.length) lines.push(`   Trade-offs: ${rec.tradeoffs.join("; ")}`);
        }
        lines.push("");
      } else lines.push("**Recommendations:** none", "");
      if (r.validator.notes.length)
        lines.push(`**Validator:** ${r.validator.notes.join(" | ")}`, "");
    }
    const tools = briefToolCalls(t);
    lines.push(
      "**Tool calls:**",
      "",
      ...(tools.length ? tools.map((x) => `- \`${x}\``) : ["- none"]),
      "",
    );
    lines.push("PASS/FAIL: ", "", "Reason: ", "", "---", "");
  }
  return lines.join("\n");
}

function main() {
  const transcripts = readTranscripts();
  const out = path.join(EVALS_DIR, "labelsheet.md");
  writeFileSync(out, renderLabelSheet(transcripts));
  console.log(
    `Wrote ${out} (${transcripts.length} scenario${transcripts.length === 1 ? "" : "s"}).`,
  );
  // Start of a labeling round: record which run the labels will describe (used to flag stale calibration).
  const first = transcripts.find((t) => t.response);
  if (first && !existsSync(LABELS_PATH)) {
    writeJson(
      LABELS_META_PATH,
      LabelsMeta.parse({
        promptVersion: first.promptVersion,
        model: first.response?.model ?? first.model,
        createdAt: new Date().toISOString(),
        ids: transcripts.map((t) => t.id),
      }),
    );
    console.log(`Wrote ${LABELS_META_PATH}.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
