import type {
  Advice, AIFlags, AIProvider, AdvisorsRequest, FreePolicyCandidate, FreePolicyRequest,
  FreePolicyResult, HistoryRequest, NationHistory, NewsRequest, NewsStory,
} from "./contracts";
import { ordinaryNews } from "./news";
import content from "./content-v1.2.0.json";
import { causeDisplayName, indicatorDisplayName, renderContent } from "./display-names";

const unavailable = content.ai.unavailable;
const unsupported = (explanation = content.ai.unsupported): FreePolicyResult =>
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
function bounded(value: unknown, min: number, max: number): number {
  const parsed = number(value);
  if (parsed < min || parsed > max) throw new Error("AI number out of bounds");
  return parsed;
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
  let result: FreePolicyCandidate;
  switch (candidate.policyType) {
    case "interestRate":
      keys(candidate, ["policyType", "targetRate"]);
      result = { policyType: "interestRate", targetRate: bounded(candidate.targetRate, -0.02, 0.3) };
      break;
    case "taxPackage":
      keys(candidate, ["policyType", "incomeTaxDelta", "corporateTaxDelta", "consumptionTaxDelta", "lowIncomeTransferGdpShare", "durationMonths"]);
      result = {
        policyType: "taxPackage",
        incomeTaxDelta: bounded(candidate.incomeTaxDelta, -0.2, 0.2),
        corporateTaxDelta: bounded(candidate.corporateTaxDelta, -0.2, 0.2),
        consumptionTaxDelta: bounded(candidate.consumptionTaxDelta, -0.2, 0.2),
        lowIncomeTransferGdpShare: bounded(candidate.lowIncomeTransferGdpShare, 0, 0.05),
        durationMonths: number(candidate.durationMonths),
      };
      if (result.lowIncomeTransferGdpShare < 0 || !Number.isInteger(result.durationMonths) || result.durationMonths <= 0 || result.durationMonths > 120) throw new Error("Invalid tax duration");
      break;
    case "publicWorks":
      keys(candidate, ["policyType", "sector", "sizeGdpShare"]);
      if (!(["transport", "energy", "digital", "education", "disasterPrevention"] as unknown[]).includes(candidate.sector)) throw new Error("Invalid sector");
      result = { policyType: "publicWorks", sector: candidate.sector as "transport" | "energy" | "digital" | "education" | "disasterPrevention", sizeGdpShare: bounded(candidate.sizeGdpShare, 0, 0.05) };
      break;
    case "tariff":
      keys(candidate, ["policyType", "industryId", "rateDelta", "durationMonths"]);
      if (!(["agricultureResources", "manufacturing", "construction", "householdServices", "financeRealEstate", "energyLogistics"] as unknown[]).includes(candidate.industryId)) throw new Error("Invalid industry");
      result = { policyType: "tariff", industryId: candidate.industryId as "agricultureResources" | "manufacturing" | "construction" | "householdServices" | "financeRealEstate" | "energyLogistics", rateDelta: bounded(candidate.rateDelta, -0.5, 0.5), durationMonths: number(candidate.durationMonths) };
      if (!Number.isInteger(result.durationMonths) || result.durationMonths <= 0 || result.durationMonths > 120) throw new Error("Invalid tariff duration");
      break;
    case "fxIntervention":
      keys(candidate, ["policyType", "direction", "sizeGdpShare"]);
      if (candidate.direction !== "buyDomestic" && candidate.direction !== "sellDomestic") throw new Error("Invalid direction");
      result = { policyType: "fxIntervention", direction: candidate.direction, sizeGdpShare: bounded(candidate.sizeGdpShare, 0, 0.05) };
      break;
    default:
      throw new Error("Unknown policy type");
  }
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
      conclusion: renderContent(content.ai.mockConclusion, { role: expert.role }),
      reason: renderContent(cause ? content.ai.mockReason : content.ai.mockNoEvidenceReason, {
        indicator: cause ? indicatorDisplayName(cause.indicator) : "",
        source: cause ? causeDisplayName(cause.source) : "",
        values: expert.values,
      }),
      caution: content.ai.mockCaution,
    }));
  }
  async freePolicy(request: FreePolicyRequest): Promise<FreePolicyResult> {
    const match = request.text.match(/政策金利を\s*(\d+(?:\.\d+)?)\s*%/);
    return match ? validateFreePolicy({ status: "supported", explanation: content.ai.policyInterpretation, candidate: { policyType: "interestRate", targetRate: Number(match[1]) / 100 } }) : unsupported();
  }
  async news(request: NewsRequest): Promise<NewsStory> {
    const base = ordinaryNews(request.facts);
    return { ...base, explanation: `${base.explanation} ${content.ai.newsEvidence}`, perspectives: [
      ...base.perspectives, { viewpoint: "newspaper", text: content.ai.newspaper },
      { viewpoint: "citizen", text: content.ai.citizen },
    ] };
  }
  async history(request: HistoryRequest): Promise<NationHistory> {
    return { title: content.ai.historyTitle, narrative: `${renderContent(content.ai.historyLead, { month: String(request.ending.month) })}${request.milestones.map((x) => x.summary).join(" ").slice(0, 1000) || content.ai.historyEmpty}` };
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
    catch { return { title: content.ai.historyTitle, narrative: unavailable }; }
  }
}
