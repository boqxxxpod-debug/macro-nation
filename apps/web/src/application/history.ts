import type {
  GameState,
  HistoryCategory,
  HistoryEntry,
  ReviewSnapshot,
} from "@macro-nation/domain";
import {
  causalSourceDisplayName,
  policyDisplayName,
} from "@macro-nation/advisor-core";

const categoryOrder: readonly HistoryCategory[] = [
  "policy",
  "event",
  "crisis",
  "review",
  "structure",
  "social",
  "ending",
];

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/**
 * Rebuilds the sparse timeline solely from durable references. One entry per
 * month deliberately merges simultaneous milestones without saving prose.
 */
export function nationalHistory(state: GameState): readonly HistoryEntry[] {
  const months = new Map<
    number,
    { categories: HistoryCategory[]; refs: string[]; causes: string[] }
  >();
  const add = (
    month: number,
    category: HistoryCategory,
    refs: readonly string[],
    causes: readonly string[] = [],
  ) => {
    const item = months.get(month) ?? { categories: [], refs: [], causes: [] };
    item.categories.push(category);
    item.refs.push(...refs);
    item.causes.push(...causes);
    months.set(month, item);
  };
  for (const policy of [
    ...state.policies.active,
    ...state.policies.reserved,
    ...state.policies.completed,
    ...state.policies.cancelled,
  ])
    add(policy.decidedMonth, "policy", [
      policy.sourceCommandId,
      policy.policyId,
    ]);
  for (const event of state.events.occurrences ?? [])
    add(event.occurredMonth, "event", [
      event.eventId,
      ...(event.choiceId ? [event.choiceId] : []),
    ]);
  for (const review of state.history.reviews ?? [])
    add(
      review.monthIndex,
      "review",
      [`review:${review.monthIndex}`],
      review.causeRefs,
    );
  for (const key of state.history.appliedMilestones ?? []) {
    const match = key.match(/:structure:(\d+)$/);
    if (match) add(Number(match[1]), "structure", [key]);
  }
  const reports = state.history.reports ?? [];
  for (const [index, report] of reports.entries()) {
    const strong = (report.reactions ?? []).filter(
      (reaction) =>
        reaction.strength === 3 &&
        (reports[index - 1]?.reactions ?? []).some(
          (previous) =>
            previous.strength === 3 &&
            previous.audience === reaction.audience &&
            previous.representativeTopicKey === reaction.representativeTopicKey,
        ),
    );
    if (strong.length)
      add(
        report.monthIndex,
        "social",
        strong.map((item) => item.reactionId),
        strong.flatMap((item) =>
          item.causeRefs.map((ref) => `${ref.sourceType}:${ref.sourceId}`),
        ),
      );
  }
  if (state.runState === "crisisStopped" || state.runState === "failed")
    add(
      state.monthIndex,
      "crisis",
      [`crisis:${state.monthIndex}`],
      state.history.reports?.at(-1)?.topCauses.map((cause) => cause.sourceId) ??
        [],
    );
  if (state.runState === "completed" || state.runState === "failed")
    add(
      state.monthIndex,
      "ending",
      [`ending:${state.runState}`],
      state.history.reports?.at(-1)?.topCauses.map((cause) => cause.sourceId) ??
        [],
    );
  return [...months.entries()]
    .sort(([a], [b]) => a - b)
    .map(([month, item]) => ({
      entryId: `${state.gameId}:history:${month}`,
      month,
      categories: unique(item.categories).sort(
        (a, b) =>
          categoryOrder.indexOf(a as HistoryCategory) -
          categoryOrder.indexOf(b as HistoryCategory),
      ) as HistoryCategory[],
      referenceIds: unique(item.refs),
      causeRefs: unique(item.causes),
    }));
}

export function withNationalHistory(state: GameState): GameState {
  return {
    ...state,
    history: { ...state.history, entries: nationalHistory(state) },
  };
}

export interface EndingHistorySummary {
  readonly mainDecisionIds: readonly string[];
  readonly turningPoint: HistoryEntry | undefined;
  readonly previousReview: ReviewSnapshot | undefined;
  readonly latestReview: ReviewSnapshot | undefined;
  readonly failureCauseRefs: readonly string[];
}

export function endingHistorySummary(state: GameState): EndingHistorySummary {
  const entries = nationalHistory(state);
  const decisions = entries.filter((entry) =>
    entry.categories.includes("policy"),
  );
  const turningPoint = entries
    .filter((entry) => !entry.categories.includes("ending"))
    .sort(
      (a, b) =>
        b.causeRefs.length +
          b.referenceIds.length -
          (a.causeRefs.length + a.referenceIds.length) || a.month - b.month,
    )[0];
  const reviews = state.history.reviews ?? [];
  return {
    mainDecisionIds: unique(
      decisions.flatMap((entry) => entry.referenceIds),
    ).slice(0, 5),
    turningPoint,
    previousReview: reviews.at(-2),
    latestReview: reviews.at(-1),
    failureCauseRefs:
      state.runState === "failed" ? (entries.at(-1)?.causeRefs ?? []) : [],
  };
}

export const HISTORY_CATEGORY_LABELS: Readonly<
  Record<HistoryCategory, string>
> = {
  policy: "政策の決定",
  event: "イベント",
  crisis: "危機",
  review: "5年ごとの振り返り",
  structure: "10年ごとの国の変化",
  social: "社会の大きな反応",
  ending: "運営の終了",
};

export function policyTypeDisplayName(type: string): string {
  return policyDisplayName(type);
}

function eventTitle(id: string, state: GameState): string | undefined {
  const content = state.configSnapshot?.normalizedConfig.content as
    { events?: readonly { eventId: string; title: string }[] } | undefined;
  return content?.events?.find(
    (event) => id === event.eventId || id.startsWith(`${event.eventId}:`),
  )?.title;
}

/** Display labels are rebuilt without replacing the durable history references. */
export function historyReferenceDisplay(id: string, state: GameState): string {
  const decision = [
    ...(state.policies.active ?? []),
    ...(state.policies.reserved ?? []),
    ...(state.policies.completed ?? []),
    ...(state.policies.cancelled ?? []),
  ].find((policy) => policy.policyId === id || policy.sourceCommandId === id);
  if (decision) return policyTypeDisplayName(decision.type);
  const policyName = policyDisplayName(id);
  if (policyName !== "政策") return policyName;
  const event = eventTitle(id, state);
  if (event) return event;
  if (id === "protect-households") return "家計を支える対応";
  if (id === "protect-businesses") return "企業を支える対応";
  if (id === "balanced") return "家計と企業を支える対応";
  if (/^review:\d+$/.test(id)) return "5年ごとの振り返り";
  if (/:structure:\d+$/.test(id)) return "10年ごとの国の変化";
  if (/^crisis:\d+$/.test(id)) return "危機への対応";
  if (id === "ending:failed") return "危機による運営の終了";
  if (id === "ending:completed") return "予定の期間を終えた運営";
  if (/^reaction:\d+:citizens/.test(id)) return "国民の反応";
  if (/^reaction:\d+:business/.test(id)) return "企業の反応";
  if (/^reaction:\d+:market/.test(id)) return "市場の反応";
  return "過去の記録";
}

/** A causal reference may contain a source-type prefix; its ID stays untouched. */
export function historyCauseDisplay(ref: string, state: GameState): string {
  const match = /^(policy|combo|event|external|inertia|random):(.+)$/.exec(ref);
  const id = match?.[2] ?? ref;
  const recordedSource = state.history?.reports
    ?.flatMap((report) => report.topCauses)
    .find((cause) => cause.sourceId === id);
  const type = match?.[1] ?? recordedSource?.sourceType;
  const name = historyReferenceDisplay(id, state);
  if (type === "policy")
    return name === "過去の記録" || name === "政策"
      ? "過去の政策"
      : `${name}の政策`;
  if (type === "combo") return "政策の組み合わせ";
  if (type === "event") {
    if (name === "過去の記録") return "イベントの影響";
    return id.endsWith(":preparedness") ? `${name}への備え` : name;
  }
  if (type === "external" || type === "random" || type === "inertia")
    return causalSourceDisplayName(type, id);
  return name === "過去の記録" ? "経済の変化につながった要因" : name;
}
