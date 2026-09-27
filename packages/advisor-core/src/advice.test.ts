import { describe, expect, it } from "vitest";
import { RuleBasedExpertAdvisor } from "./advice";
import { expertProfiles } from "./profiles";

describe("RuleBasedExpertAdvisor", () => {
  const context = {
    effects: {
      realGdp: 2,
      inflation: -1,
      unemployment: -0.5,
      governmentDebtRatio: 3,
    },
    uncertainty: "外部環境で幅があります。",
  };

  it("is deterministic while giving profiles distinct focus and tone", () => {
    const advisor = new RuleBasedExpertAdvisor();
    const first = expertProfiles.map((profile) =>
      advisor.advise(profile, context),
    );
    expect(
      expertProfiles.map((profile) => advisor.advise(profile, context)),
    ).toEqual(first);
    expect(new Set(first.map((advice) => advice.caution)).size).toBe(8);
    expect(
      new Set(first.map((advice) => advice.conclusion)).size,
    ).toBeGreaterThan(1);
  });

  it("does not mutate the common preview facts", () => {
    const before = JSON.stringify(context);
    new RuleBasedExpertAdvisor().advise(expertProfiles[0]!, context);
    expect(JSON.stringify(context)).toBe(before);
  });
});
