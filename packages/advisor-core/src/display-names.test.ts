import { describe, expect, it } from "vitest";
import {
  causalSourceDisplayName,
  causeDisplayName,
  indicatorDisplayName,
  policyDisplayName,
} from "./display-names";

describe("player-facing economic names", () => {
  it("names indicators without losing the rate or GDP comparison", () => {
    expect(indicatorDisplayName("inflation")).toBe("物価上昇率");
    expect(indicatorDisplayName("governmentDebtRatio")).toBe(
      "政府債務（GDP比）",
    );
    expect(indicatorDisplayName("economy.rates.inflationAnnual")).toBe(
      "物価上昇率",
    );
    expect(indicatorDisplayName("industry.manufacturing.capacity")).toBe(
      "製造業の生産能力指数",
    );
    expect(indicatorDisplayName("not-a-known-indicator")).toBe("経済指標");
    expect(indicatorDisplayName("toString")).toBe("経済指標");
  });

  it("describes opaque causal IDs without inventing a policy or event identity", () => {
    expect(policyDisplayName("interestRate")).toBe("政策金利");
    expect(causeDisplayName("policy:interestRate")).toBe("政策金利の変更");
    expect(causeDisplayName("policy:decision-2026-01-42")).toBe("政策の効果");
    expect(causalSourceDisplayName("event", "unknown-event")).toBe(
      "出来事の影響",
    );
    expect(causeDisplayName("external:foreign-growth")).toBe("海外経済の成長");
    expect(causeDisplayName("random:error.inflation")).toBe(
      "月ごとの偶発的な変動",
    );
    expect(causeDisplayName("unknown:value")).toBe("経済の変化に関わる要因");
  });
});
