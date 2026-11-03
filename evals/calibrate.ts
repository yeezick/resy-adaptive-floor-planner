// Judge calibration against human labels: TPR, TNR, agreement, and the Rogan–Gladen corrected pass rate with a
// bootstrap interval. The pure core is exported; running the file prints the calibration and refreshes results.json.
import { pathToFileURL } from "node:url";
import type { Calibration } from "../src/shared/evals";
import { resample, rng } from "./stats";

export const TRUST_THRESHOLD = 0.8;
export const BOOTSTRAP_B = 2000;

export interface Pair {
  judge: boolean;
  human: boolean;
}

export function rates(pairs: readonly Pair[]): {
  tpr: number | null;
  tnr: number | null;
  rawAgreement: number | null;
} {
  const pos = pairs.filter((p) => p.human);
  const neg = pairs.filter((p) => !p.human);
  return {
    tpr: pos.length ? pos.filter((p) => p.judge).length / pos.length : null,
    tnr: neg.length ? neg.filter((p) => !p.judge).length / neg.length : null,
    rawAgreement: pairs.length
      ? pairs.filter((p) => p.judge === p.human).length / pairs.length
      : null,
  };
}

/** Rogan–Gladen: (p_obs + TNR − 1) / (TPR + TNR − 1), clipped to [0, 1]. Null when the judge is no better than chance. */
export function roganGladen(pObs: number, tpr: number, tnr: number): number | null {
  const denom = tpr + tnr - 1;
  if (denom <= 0) return null;
  return Math.min(1, Math.max(0, (pObs + tnr - 1) / denom));
}

export interface CalibrationInput {
  /** Judge verdicts on the whole run. */
  runVerdicts: readonly boolean[];
  /** Judge vs human on the labeled examples. */
  pairs: readonly Pair[];
  stale: boolean;
  threshold?: number;
  bootstrap?: number;
  seed?: number;
}

export function calibrate(input: CalibrationInput): Calibration {
  const threshold = input.threshold ?? TRUST_THRESHOLD;
  const { tpr, tnr, rawAgreement } = rates(input.pairs);
  const n = input.runVerdicts.length;
  const observedPassRate = n ? input.runVerdicts.filter(Boolean).length / n : null;
  const correctedPassRate =
    observedPassRate !== null && tpr !== null && tnr !== null
      ? roganGladen(observedPassRate, tpr, tnr)
      : null;

  let correctedInterval: Calibration["correctedInterval"] = null;
  if (correctedPassRate !== null) {
    const B = input.bootstrap ?? BOOTSTRAP_B;
    const next = rng(input.seed ?? 20261102);
    const draws: number[] = [];
    for (let b = 0; b < B; b++) {
      const run = resample(input.runVerdicts, next);
      const r = rates(resample(input.pairs, next));
      if (r.tpr === null || r.tnr === null) continue;
      const c = roganGladen(run.filter(Boolean).length / run.length, r.tpr, r.tnr);
      if (c !== null) draws.push(c);
    }
    if (draws.length) {
      draws.sort((a, b) => a - b);
      const at = (q: number) =>
        draws[Math.min(draws.length - 1, Math.floor(q * draws.length))] as number;
      correctedInterval = {
        low: at(0.025),
        high: at(0.975),
        method: `bootstrap-percentile-95 (B=${B}, resampling run and calibration set; ${draws.length} valid draws)`,
      };
    }
  }

  return {
    n: input.pairs.length,
    tpr,
    tnr,
    rawAgreement,
    observedPassRate,
    correctedPassRate,
    correctedInterval,
    trusted: tpr !== null && tnr !== null && tpr >= threshold && tnr >= threshold,
    threshold,
    stale: input.stale,
  };
}

async function main() {
  const { refreshResults, calibrationFromFiles } = await import("./results");
  const cal = calibrationFromFiles();
  if (!cal) {
    console.log(
      "No calibration: need evals/labels.jsonl (human labels) and evals/judgements.jsonl (judge verdicts).",
    );
  } else {
    console.log(JSON.stringify(cal, null, 2));
    if (!cal.trusted)
      console.log(`Judge NOT trusted: TPR and TNR must both be ≥ ${cal.threshold}.`);
    if (cal.stale)
      console.log(
        "Calibration is STALE: the prompt version or model changed since the labeled run.",
      );
  }
  refreshResults();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
