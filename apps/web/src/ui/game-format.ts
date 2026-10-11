import type { GameState, MonthlyReportSnapshot } from "@macro-nation/domain";
import {
  indicatorDisplayName,
  policyDisplayName,
} from "@macro-nation/advisor-core";

export const label = (id: string) => {
  const preparedness: Record<string, string> = {
    "fiscal-space": "使える予算",
    "policy-trust": "政策への信頼",
    "energy-infrastructure": "エネルギーインフラ",
    "foreign-reserves": "外貨準備",
  };
  if (Object.hasOwn(preparedness, id)) return preparedness[id]!;
  const policy = policyDisplayName(id);
  if (policy !== "政策") return policy;
  const metric = id.replace(
    /^economy\.industries\.([^.]+)\.(productionIndex|capacityIndex|employment|importDependency)$/,
    (_, industry: string, property: string) =>
      `industry.${industry}.${property.replace(/Index$/, "")}`,
  );
  const indicator = indicatorDisplayName(metric);
  if (indicator !== "経済指標") return indicator;
  return /[ぁ-んァ-ン一-龠]/.test(id) ? id : "経済の指標";
};
export const display = (id: string, value: number) =>
  ["inflation", "unemployment", "governmentDebtRatio"].includes(id)
    ? `${(value * 100).toFixed(1)}%`
    : value.toFixed(1);
export const period = (state: GameState) =>
  `${Math.floor(state.monthIndex / 12) + 1}年目 ${(state.monthIndex % 12) + 1}月`;

export function describeCause(
  cause: Pick<
    MonthlyReportSnapshot["topCauses"][number],
    "sourceType" | "sourceId"
  >,
  state: GameState,
): string {
  if (cause.sourceType === "event") {
    const name = eventDisplayName(cause.sourceId, state);
    return cause.sourceId.endsWith(":preparedness") ? `${name}への備え` : name;
  }
  if (cause.sourceType === "combo") return "政策の組み合わせ";
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

/** Resolve the display name from the game's saved content, keeping IDs intact. */
export function eventDisplayName(id: string, state: GameState): string {
  const content = state.configSnapshot.normalizedConfig.content as
    { events?: readonly { eventId: string; title: string }[] } | undefined;
  const event = content?.events?.find(
    (item) => id === item.eventId || id.startsWith(`${item.eventId}:`),
  );
  if (event) return event.title;
  return /[ぁ-んァ-ン一-龠]/.test(id) ? id : "経済に影響する出来事";
}
