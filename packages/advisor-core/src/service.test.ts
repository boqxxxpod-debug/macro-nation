import { describe, expect, it, vi } from "vitest";
import type { AIFlags, AIProvider, AdvisorsRequest, NationFacts } from "./contracts";
import { summarizeHistory } from "./facts";
import { ordinaryNews } from "./news";
import { AIService, MockAIProvider, validateFreePolicy } from "./service";

const facts: NationFacts = {
  month: 4, indicators: { inflation: 0.048, unemployment: 0.031, fx: 112 },
  causes: [{ indicator: "inflation", delta: 1.5, source: "policy:interestRate", contribution: 0.6 }],
  recentEvents: [],
};
const experts = [
  { id: "centralBank", role: "中央銀行", values: "物価の安定", tone: "慎重" },
  { id: "labor", role: "雇用", values: "雇用の安定", tone: "親しみやすい" },
] as const;
const request: AdvisorsRequest = { facts, experts };
const on: AIFlags = { enabled: true, advisors: true, freePolicy: true, news: true, history: true };
const off: AIFlags = { ...on, enabled: false };

describe("optional AI boundary", () => {
  it("AI off uses ordinary news and never calls a provider, including completion", async () => {
    const call = vi.fn(() => Promise.reject(new Error("should not run")));
    const provider = { advisors: call, news: call, freePolicy: call, history: call } as unknown as AIProvider;
    const service = new AIService(provider, off);
    expect(await service.news({ id: "month4", facts })).toEqual(ordinaryNews(facts));
    expect(ordinaryNews(facts).explanation).toContain("4.8%");
    expect((await service.advisors(request)).map((a) => a.expertId)).toEqual(["centralBank", "labor"]);
    expect((await service.freePolicy({ text: "x" })).status).toBe("unsupported");
    expect((await service.history({ ending: facts, milestones: [] })).title).toBe("国家運営の記録");
    expect(call).not.toHaveBeenCalled();
  });

  it("one provider call returns multiple experts; cache avoids repeated news calls", async () => {
    const provider = new MockAIProvider();
    const advisors = vi.spyOn(provider, "advisors");
    const news = vi.spyOn(provider, "news");
    const service = new AIService(provider, on);
    expect(await service.advisors(request)).toHaveLength(2);
    expect(advisors).toHaveBeenCalledTimes(1);
    const story = { id: "same", facts };
    expect(await service.news(story)).toEqual(await service.news(story));
    expect(news).toHaveBeenCalledTimes(1);
    await service.news({ id: "same", facts: { ...facts, month: 5 } });
    expect(news).toHaveBeenCalledTimes(2);
  });

  it("rejects invented target groups, malformed data and schema mismatch", () => {
    expect(() => validateFreePolicy({ status: "supported", explanation: "x", candidate: { policyType: "taxPackage", target: "threeChildren", incomeTaxDelta: -0.2 } })).toThrow();
    expect(() => validateFreePolicy({ status: "supported", explanation: "x", candidate: { policyType: "interestRate", targetRate: "2%" } })).toThrow();
    expect(() => validateFreePolicy({ status: "supported", explanation: "x", candidate: { policyType: "fxIntervention", direction: "invented", sizeGdpShare: 0.01 } })).toThrow();
    expect(validateFreePolicy({ status: "unsupported", explanation: "対象別の税制は未対応", candidate: null }).status).toBe("unsupported");
  });

  it("provider failure or invalid output falls back without altering engine facts", async () => {
    const before = structuredClone(facts);
    const bad = {
      advisors: vi.fn(async () => [{ expertId: "unknown", conclusion: "x", reason: "x", caution: "x" }]),
      freePolicy: vi.fn(async () => JSON.parse("{\"status\":\"supported\"}")),
      news: vi.fn(async () => { throw new Error("timeout"); }),
      history: vi.fn(async () => { throw new Error("provider down"); }),
    } as unknown as AIProvider;
    const service = new AIService(bad, on);
    expect(await service.advisors(request)).toHaveLength(2);
    expect((await service.freePolicy({ text: "x" })).status).toBe("unsupported");
    expect(await service.news({ id: "failed", facts })).toEqual(ordinaryNews(facts));
    expect((await service.history({ ending: facts, milestones: [] })).narrative).toContain("利用できません");
    expect(facts).toEqual(before);
  });

  it("mock parses only a bounded supported policy and history summary is bounded", async () => {
    const mock = new MockAIProvider();
    expect((await mock.freePolicy({ text: "政策金利を2%に" })).candidate).toEqual({ policyType: "interestRate", targetRate: 0.02 });
    expect((await mock.freePolicy({ text: "子ども3人の家庭の所得税を半分に" })).status).toBe("unsupported");
    const summary = summarizeHistory(facts, Array.from({ length: 40 }, (_, month) => ({ month, importance: month, summary: "a".repeat(200) })));
    expect(summary.milestones).toHaveLength(18);
    expect(summary.milestones[0]?.summary).toHaveLength(120);
  });
});
