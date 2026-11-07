// The AI Planner's answer as shown: the first sentence, the rest behind "More ▸". Pure (display only).

/** A lead that only says what the planner can't do ("I can't seat them or push tables together myself."). */
export const REFUSAL_LEAD = /^I (can't|cannot|don't|won't)\b/;

/** Split after the first sentence of at least ~20 characters (so "e.g." never ends the lead). */
const FIRST = /^(.{20,}?[.!?])(\s+)([\s\S]+)$/;

/**
 * The lead the host reads and the rest. A refusal-only lead that names no table number takes the next sentence
 * too, so the answer itself is never hidden behind "More ▸" (T36).
 */
export function answerLead(text: string): { lead: string; rest: string | null } {
  const m = FIRST.exec(text);
  if (!m) return { lead: text, rest: null };
  const lead = m[1] as string;
  const rest = m[3] as string;
  if (REFUSAL_LEAD.test(lead) && !/\d/.test(lead)) {
    const n = FIRST.exec(rest);
    if (!n) return { lead: `${lead} ${rest}`, rest: null };
    return { lead: `${lead} ${n[1] as string}`, rest: n[3] as string };
  }
  return { lead, rest };
}
