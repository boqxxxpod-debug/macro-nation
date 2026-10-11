import { describe, expect, it } from "vitest";
import { RuleBasedExpertAdvisor } from "./advice";
import { expertProfiles, expertProfilesForContentVersion } from "./profiles";

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

  it("uses display names and neutral directions without calling higher costs improvements", () => {
    const advisor = new RuleBasedExpertAdvisor();
    const inflation = advisor.advise(expertProfiles[0]!, {
      ...context,
      effects: { inflation: 0.02 },
    });
    expect(inflation.conclusion).toBe(
      "物価上昇率は、政策を追加しない場合と比べて上がる見通しです。",
    );
    const labor = advisor.advise(expertProfiles[4]!, context);
    expect(labor.conclusion).toContain("実質GDP");
    const unemployment = advisor.advise(expertProfiles[4]!, {
      ...context,
      effects: { unemployment: -0.01 },
    });
    expect(unemployment.conclusion).toContain("失業率");
    expect(unemployment.conclusion).toContain("下がる見通し");
    const debt = advisor.advise(expertProfiles[1]!, context);
    expect(debt.conclusion).toContain("政府債務（GDP比）");
    expect(debt.conclusion).toContain("上がる見通し");
    expect(
      [inflation, unemployment, debt].every(
        ({ conclusion }) =>
          conclusion.length <= 160 && !/改善|悪化/.test(conclusion),
      ),
    ).toBe(true);
  });

  it("does not turn missing forecast evidence into a flat outlook", () => {
    const advice = new RuleBasedExpertAdvisor().advise(expertProfiles[0]!, {
      effects: {},
      uncertainty: "前提に幅があります。",
    });
    expect(advice.conclusion).toBe("判断に必要な見通しがまだありません。");
    expect(advice.reason).toContain("今回の見通しには含まれていません");
    expect(advice.caution).toContain("前提に幅があります。");
  });

  it("keeps wording from saved content 1.1.0 reproducible", () => {
    const profile = expertProfilesForContentVersion("1.1.0")[0]!;
    expect(
      new RuleBasedExpertAdvisor().advise(profile, {
        ...context,
        contentVersion: "1.1.0",
      }),
    ).toEqual({
      expertId: "centralBank",
      conclusion: "inflationは無追加政策比で悪化する見通しです。",
      reason:
        "物価・金利・為替の安定を重視し、共通の予測結果から影響の大きい項目を先に確認しました。",
      caution:
        "外部環境で幅があります。 数字の振れを見ながら進めるのが妥当です。",
    });
  });
});
