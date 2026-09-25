import type { GameState, MonthlyReportSnapshot } from "@macro-nation/domain";

export const LABELS: Record<string, string> = {
  "interest-rate": "政策金利",
  "tax-package": "税制",
  "public-works": "公共事業",
  tariff: "関税",
  "fx-intervention": "為替介入",
  realHouseholdIncome: "国民生活",
  realGdp: "成長",
  inflation: "物価",
  unemployment: "雇用",
  policyTrust: "信頼",
  support: "支持",
  fx: "為替",
  governmentDebtRatio: "政府債務",
  foreignReserves: "外貨準備",
  primarySpending: "基礎支出",
};
export const label = (id: string) =>
  LABELS[id] ?? id.replace(/^economy\./, "").replaceAll(".", " ");
export const display = (id: string, value: number) =>
  ["inflation", "unemployment", "governmentDebtRatio"].includes(id)
    ? `${(value * 100).toFixed(1)}%`
    : value.toFixed(1);
export const period = (state: GameState) =>
  `${Math.floor(state.monthIndex / 12) + 1}年目 ${(state.monthIndex % 12) + 1}月`;

export function describeCause(
  cause: MonthlyReportSnapshot["topCauses"][number],
  state: GameState,
): string {
  if (cause.sourceType === "policy") {
    const policy = [
      ...state.policies.active,
      ...state.policies.reserved,
      ...state.policies.completed,
    ].find((item) => item.policyId === cause.sourceId);
    const ruleId =
      policy?.type === "interestRate"
        ? "interest-rate"
        : policy?.type === "taxPackage"
          ? "tax-package"
          : policy?.type === "publicWorks"
            ? "public-works"
            : policy?.type === "fxIntervention"
              ? "fx-intervention"
              : policy?.type;
    return policy ? `${label(ruleId ?? "")}の政策` : "過去の政策";
  }
  if (cause.sourceType === "random" || cause.sourceId.startsWith("error."))
    return "月ごとの偶発的な変動";
  if (/fx|reserve|import|external|world|resource/.test(cause.sourceId))
    return "為替・貿易などの外部環境";
  if (/industry|productiv|capacity|public-investment/.test(cause.sourceId))
    return "産業の生産力と投資";
  if (/debt|fiscal|tax|spending/.test(cause.sourceId))
    return "税収・支出と債務";
  if (/inflation|price|wage/.test(cause.sourceId)) return "物価と賃金の動き";
  if (/confidence|trust|support/.test(cause.sourceId))
    return "家計や企業の信頼感";
  if (/unemployment|okun|employment/.test(cause.sourceId))
    return "雇用と成長のつながり";
  return cause.sourceType === "external"
    ? "外部環境"
    : "前月から続く経済の動き";
}
