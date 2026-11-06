import { afterEach, describe, expect, it, vi } from "vitest";
import { gitSha } from "./results";
import { checksPath } from "./run";

describe("deploy-time /evals checks", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("writes into public/evals by default, results included", () => {
    expect(checksPath(["tsx", "evals/run.ts", "--replay", "--write"])).toEqual({
      path: "public/evals/checks.json",
      checksOnly: false,
    });
  });

  it("with --out, writes only the checks, to that path", () => {
    expect(
      checksPath(["tsx", "evals/run.ts", "--write", "--out", "dist/client/evals/checks.json"]),
    ).toEqual({ path: "dist/client/evals/checks.json", checksOnly: true });
  });

  it("stamps the deployed commit on Railway, where there is no .git", () => {
    vi.stubEnv("GITHUB_SHA", "");
    vi.stubEnv("RAILWAY_GIT_COMMIT_SHA", "abc123");
    expect(gitSha()).toBe("abc123");
  });
});
