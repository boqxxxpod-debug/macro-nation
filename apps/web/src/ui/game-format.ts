import type { GameState } from "@macro-nation/domain";

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
