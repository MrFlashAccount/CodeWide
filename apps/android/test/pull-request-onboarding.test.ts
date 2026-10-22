import { describe, expect, it } from "vitest";

import { parseForgeAccounts } from "../src/data/forgeContract";
import { cardPlan, otherActionLabel } from "../src/features/pullRequests/onboarding/cardPlan";
import { declaredScopes, detailRuns } from "../src/features/pullRequests/onboarding/tokenSheetText";
import { providerExplanation } from "../src/features/pullRequests/onboarding/providerPresentation";
import { arcanumProvider, failedFlow, githubProvider, hostLoginFlow, onboardingAccounts } from "./fixtures/forgeWireFixtures";

const snapshot = parseForgeAccounts({ ...onboardingAccounts, flows: [hostLoginFlow, failedFlow] });
const [github, arcanum] = snapshot?.providers ?? [];
const [awaiting, failed] = snapshot?.flows ?? [];

describe("provider card plan", () => {
  it("offers exactly one primary action and every other way quietly", () => {
    const plan = github === undefined ? null : cardPlan(github, null, new Set());
    expect(plan?.kind).toBe("methods");
    if (plan?.kind !== "methods") {
      return;
    }
    expect(plan.primary === null ? null : otherActionLabel(plan.primary)).toBe("Link @sergeigarin");
    expect(plan.others.map(otherActionLabel)).toEqual(["Connect GitHub", "Paste a token"]);
  });

  it("never offers Link for a login that is already linked", () => {
    const plan = github === undefined ? null : cardPlan(github, null, new Set(["sergeigarin"]));
    expect(plan?.kind === "methods" && plan.primary !== null ? otherActionLabel(plan.primary) : null).toBe("Connect GitHub");
    expect(plan?.kind === "methods" ? plan.others.map(otherActionLabel) : null).toEqual(["Paste a token"]);
  });

  it("shows only the flow while a host login waits or failed", () => {
    expect(github === undefined || awaiting === undefined ? null : cardPlan(github, awaiting, new Set()).kind).toBe("flow");
    expect(github === undefined || failed === undefined ? null : cardPlan(github, failed, new Set()).kind).toBe("flow");
  });

  it("keeps the host steps actionable when the provider has nothing else", () => {
    const plan = arcanum === undefined ? null : cardPlan(arcanum, null, new Set());
    expect(plan?.kind === "methods" ? plan.primary?.kind : null).toBe("instructions");
  });

  it("says what an unknown provider gives instead of repeating its step", () => {
    const step = arcanumProvider.authMethods[0]?.detail ?? "";
    expect(arcanum === undefined ? null : providerExplanation(arcanum)).not.toContain(step);
    expect(githubProvider.forgeName).toBe("GitHub");
  });
});

describe("token sheet text", () => {
  it("styles only the classic scopes the plugin declared in its own Generate link", () => {
    const scopes = declaredScopes("https://github.com/settings/tokens/new?scopes=repo,read:org&description=CodeWide");
    const runs = detailRuns("A classic token needs repo and read:org; repo grants full repository access.", scopes);
    expect(runs.filter((run) => run.code).map((run) => run.text)).toEqual(["repo", "read:org", "repo"]);
    expect(runs.map((run) => run.text).join("")).toBe("A classic token needs repo and read:org; repo grants full repository access.");
    expect(declaredScopes(null).size).toBe(0);
    expect(detailRuns("repository access", scopes).some((run) => run.code)).toBe(false);
  });
});
