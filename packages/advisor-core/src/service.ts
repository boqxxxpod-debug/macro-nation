import { percentRate, type PolicyParameters } from "@macro-nation/domain";
import type {
  Advice, AIFlags, AIProvider, AdvisorsRequest, FreePolicyRequest,
  FreePolicyResult, HistoryRequest, NationHistory, NewsRequest, NewsStory,
} from "./contracts";
import { ordinaryNews } from "./news";

const unavailable = "AI解説は現在利用できません。ゲームの進行には影響しません。";
const unsupported = (explanation = "現在の政策エンジンでは表現できません。既存の政策を選択してください。"): FreePolicyResult =>
  ({ status: "unsupported", explanation, candidate: null });

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid AI response");
  return value as Record<string, unknown>;
}
function string(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max || !value.trim()) throw new Error("Invalid AI text");
  return value;
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid AI number");
  return value;
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("Unexpected AI fields");
}

/** Accept only actual existing engine parameters, never an invented segment or formula. */
export function validateFreePolicy(value: unknown): FreePolicyResult {
  const root = record(value);
  keys(root, ["status", "explanation", "candidate"]);
  const explanation = string(root.explanation, 220);
  if (root.status === "unsupported" && root.candidate === null) return unsupported(explanation);
  if (root.status !== "supported") throw new Error("Invalid policy status");
  const candidate = record(root.candidate);
  let result: PolicyParameters;
  switch (candidate.policyType) {
    case "interestRate":
      keys(candidate, ["policyType", "targetRate"]);
      result = { policyType: "interestRate", targetRate: percentRate(number(candidate.targetRate)) };
      break;
    case "taxPackage":
      keys(candidate, ["policyType", "incomeTaxDelta", "corporateTaxDelta", "consumptionTaxDelta", "lowIncomeTransferGdpShare", "durationMonths"]);
      result = {
        policyType: "taxPackage",
        incomeTaxDelta: percentRate(number(candidate.incomeTaxDelta)),
        corporateTaxDelta: percentRate(number(candidate.corporateTaxDelta)),
        consumptionTaxDelta: percentRate(number(candidate.consumptionTaxDelta)),
        lowIncomeTransferGdpShare: percentRate(number(candidate.lowIncomeTransferGdpShare)),
        durationMonths: number(candidate.durationMonths),
      };
      if (result.lowIncomeTransferGdpShare < 0 || !Number.isInteger(result.durationMonths) || result.durationMonths <= 0 || result.durationMonths > 120) throw new Error("Invalid tax duration");
      break;
    case "publicWorks":
      keys(candidate, ["policyType", "sector", "sizeGdpShare"]);
      if (!(["transport", "energy", "digital", "education", "disasterPrevention"] as unknown[]).includes(candidate.sector)) throw new Error("Invalid sector");
      result = { policyType: "publicWorks", sector: candidate.sector as "transport", sizeGdpShare: percentRate(number(candidate.sizeGdpShare)) };
      break;
    case "tariff":
      keys(candidate, ["policyType", "industryId", "rateDelta", "durationMonths"]);
      if (!(["agricultureResources", "manufacturing", "construction", "householdServices", "financeRealEstate", "energyLogistics"] as unknown[]).includes(candidate.industryId)) throw new Error("Invalid industry");
      result = { policyType: "tariff", industryId: candidate.industryId as "manufacturing", rateDelta: percentRate(number(candidate.rateDelta)), durationMonths: number(candidate.durationMonths) };
      if (!Number.isInteger(result.durationMonths) || result.durationMonths <= 0 || result.durationMonths > 120) throw new Error("Invalid tariff duration");
      break;
    case "fxIntervention":
      keys(candidate, ["policyType", "direction", "sizeGdpShare"]);
      if (candidate.direction !== "buyDomestic" && candidate.direction !== "sellDomestic") throw new Error("Invalid direction");
      result = { policyType: "fxIntervention", direction: candidate.direction, sizeGdpShare: percentRate(number(candidate.sizeGdpShare)) };
      break;
    default:
      throw new Error("Unknown policy type");
  }
  // Broad safety bound; the engine's current ConfigSnapshot and policy rule remain authoritative.
  for (const v of Object.values(result)) if (typeof v === "number" && Math.abs(v) > 120) throw new Error("Policy value out of bounds");
  return { status: "supported", explanation, candidate: result };
}

export function validateAdvice(value: unknown, request: AdvisorsRequest): readonly Advice[] {
  if (!Array.isArray(value) || value.length !== request.experts.length) throw new Error("Advice count mismatch");
  const expected = new Set(request.experts.map((expert) => expert.id));
  return value.map((item) => {
    const obj = record(item);
    keys(obj, ["expertId", "conclusion", "reason", "caution"]);
    const expertId = string(obj.expertId, 64);
    if (!expected.delete(expertId)) throw new Error("Unknown or duplicate expert");
    return { expertId, conclusion: string(obj.conclusion, 160), reason: string(obj.reason, 240), caution: string(obj.caution, 160) };
  });
}

export function validateNews(value: unknown): NewsStory {
  const obj = record(value);
  keys(obj, ["headline", "explanation", "perspectives"]);
  if (!Array.isArray(obj.perspectives) || obj.perspectives.length > 5) throw new Error("Invalid perspectives");
  return {
    headline: string(obj.headline, 100), explanation: string(obj.explanation, 400),
    perspectives: obj.perspectives.map((item: unknown) => {
      const view = record(item);
      keys(view, ["viewpoint", "text"]);
      if (!["anchor", "newspaper", "citizen", "business", "social"].includes(String(view.viewpoint))) throw new Error("Invalid viewpoint");
      return { viewpoint: view.viewpoint as "anchor", text: string(view.text, 220) };
    }),
  };
}

export function validateHistory(value: unknown): NationHistory {
  const obj = record(value);
  keys(obj, ["title", "narrative"]);
  return { title: string(obj.title, 100), narrative: string(obj.narrative, 1500) };
}

export class MockAIProvider implements AIProvider {
  async advisors(request: AdvisorsRequest): Promise<readonly Advice[]> {
    const cause = request.facts.causes[0];
    return request.experts.map((expert) => ({
      expertId: expert.id,
      conclusion: `${expert.role}の視点から政策を検討します。`,
      reason: cause ? `${cause.indicator}の変化には${cause.source}が寄与しました。${expert.values}を重視します。` : `${expert.values}を重視します。`,
      caution: "効果には時間差と副作用があります。",
    }));
  }
  async freePolicy(request: FreePolicyRequest): Promise<FreePolicyResult> {
    const match = request.text.match(/政策金利を\s*(\d+(?:\.\d+)?)\s*%/);
    return match ? validateFreePolicy({ status: "supported", explanation: "政策金利の目標として解釈しました。確定前にプレビューしてください。", candidate: { policyType: "interestRate", targetRate: Number(match[1]) / 100 } }) : unsupported();
  }
  async news(request: NewsRequest): Promise<NewsStory> {
    const base = ordinaryNews(request.facts);
    return { ...base, explanation: `${base.explanation} 主な要因は因果ログで確認できます。`, perspectives: [
      ...base.perspectives, { viewpoint: "newspaper", text: "政策と指標の推移を継続して観察します。" },
      { viewpoint: "citizen", text: "暮らしへの影響が気になります。" },
    ] };
  }
  async history(request: HistoryRequest): Promise<NationHistory> {
    return { title: "国家運営の記録", narrative: `${request.ending.month}か月を運営しました。${request.milestones.map((x) => x.summary).join(" ").slice(0, 1000) || "政策と経済の推移を振り返りましょう。"}` };
  }
}

export class AIService {
  private readonly newsCache = new Map<string, Promise<NewsStory>>();
  constructor(private readonly provider: AIProvider, private readonly flags: AIFlags) {}
  async advisors(request: AdvisorsRequest): Promise<readonly Advice[]> {
    if (!this.flags.enabled || !this.flags.advisors) return new MockAIProvider().advisors(request);
    try { return validateAdvice(await this.provider.advisors(request), request); }
    catch { return new MockAIProvider().advisors(request); }
  }
  async freePolicy(request: FreePolicyRequest): Promise<FreePolicyResult> {
    if (!this.flags.enabled || !this.flags.freePolicy) return unsupported();
    try { return validateFreePolicy(await this.provider.freePolicy(request)); }
    catch { return unsupported(unavailable); }
  }
  async news(request: NewsRequest): Promise<NewsStory> {
    if (!this.flags.enabled || !this.flags.news) return ordinaryNews(request.facts);
    const key = JSON.stringify(request);
    if (!this.newsCache.has(key)) this.newsCache.set(key, this.provider.news(request).then(validateNews).catch(() => ordinaryNews(request.facts)));
    return this.newsCache.get(key)!;
  }
  async history(request: HistoryRequest): Promise<NationHistory> {
    if (!this.flags.enabled || !this.flags.history) return new MockAIProvider().history(request);
    try { return validateHistory(await this.provider.history(request)); }
    catch { return { title: "国家運営の記録", narrative: unavailable }; }
  }
}
