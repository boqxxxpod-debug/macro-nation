import { useEffect, useId, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  expertProfilesForContentVersion,
  ordinaryNews,
  projectFacts,
  RuleBasedExpertAdvisor,
} from "@macro-nation/advisor-core";
import type {
  ConfigSnapshot,
  GameState,
  MonthlyReportSnapshot,
  PolicyCosts,
} from "@macro-nation/domain";
import {
  createReservedPolicy,
  policyMeetingStatus,
  policyRules,
  policyStateHash,
  type PolicyDraft,
  type PreviewOutput,
} from "../application/policy-view";
import { createBrowserAIService } from "../infrastructure/ai";
import {
  causeCategory,
  selectHomeIndicators,
  selectHomeMilestones,
  selectHomeRecommendations,
  topCause,
} from "../application/home-view";
import { describeCause, display, eventDisplayName, label } from "./game-format";
import { nationVoiceContent } from "./NationVoice";
import {
  PageDeck,
  type PageDeckCategory,
  type PageDeckNavigation,
} from "./PageDeck";
import {
  monthlyBriefButtonId,
  monthlyEvidenceQuery,
  savedReportIndicatorIds,
  selectMonthlyBrief,
  selectMonthlyEvidence,
  selectReportCauses,
  type MonthlyEvidenceTarget,
} from "../application/monthly-evidence";
import { policyConfirmationContent } from "./PolicyConfirmation";
import { selectLatestConfirmedPolicy } from "../application/policy-confirmation";
import { ExpertPortrait } from "./ExpertPortrait";
import { reportIndicatorUnit, reportNumber } from "./report-format";
import { TermHelp } from "./TermHelp";
import { policyResourcesContent } from "./PolicyResources";
import { policyResourceComparison } from "../application/policy-resources";
import policyInputCopy from "./policy-input-copy.json";
import { isTutorialTime } from "../application/game-clock";
import { tutorialContent } from "./tutorial-content";
import {
  learningEntryDisplay,
  schoolLensesForContentVersion,
  visibleCauseCount,
} from "../application/learning";
import {
  HISTORY_CATEGORY_LABELS,
  historyCauseDisplay,
  historyReferenceDisplay,
  nationalHistory,
} from "../application/history";

function uncertaintyExplanation(note: string): string {
  return note ===
    "同一モデルの固定ショック分位による試算幅であり、確率的な信頼区間ではありません。"
    ? "外部環境の揺れを一定の条件で想定した計算の幅です。この範囲に収まる確率を示すものではありません。"
    : note;
}

function adviceExplanation(
  text: string,
  indicatorIds: readonly string[],
): string {
  const indicator = indicatorIds.find((id) => text.startsWith(`${id}は`));
  const translated = indicator
    ? `${label(indicator)}${text.slice(indicator.length)}`
    : text;
  return translated.replace(
    "無追加政策比で",
    "新しい政策を加えない場合と比べて",
  );
}

function preparednessIndicatorLabel(
  id: string,
  eventId: string,
  state: GameState,
): string {
  const content = state.configSnapshot.normalizedConfig.content as
    | {
        events?: readonly {
          eventId: string;
          preparednessIndicators: readonly { id: string; path: string }[];
        }[];
      }
    | undefined;
  const indicator = content?.events
    ?.find((event) => event.eventId === eventId)
    ?.preparednessIndicators.find((item) => item.id === id);
  return label(indicator?.path ?? id);
}

export function Home({
  state,
  onOpenReport,
  onOpenEvidence,
  evidenceReturn,
  onOpenPolicies,
  response,
  timeControls,
}: {
  state: GameState;
  timeControls?: ReactNode;
  onOpenReport(): void;
  onOpenEvidence?(target: MonthlyEvidenceTarget): void;
  evidenceReturn?:
    Pick<MonthlyEvidenceTarget, "monthIndex" | "row"> | undefined;
  onOpenPolicies(): void;
  response?: ReactNode;
}) {
  const reports = state.history.reports ?? [];
  const latest = reports.at(-1);
  const brief = selectMonthlyBrief(state, evidenceReturn?.monthIndex);
  const e = state.economy;
  const crisis =
    state.runState === "crisisStopped" ||
    e.rates.inflationAnnual >= 0.08 ||
    e.rates.unemployment >= 0.1;
  const cards = selectHomeIndicators(state);
  const ranked = brief.indicators;
  const milestones = selectHomeMilestones(state);
  const recommendations = selectHomeRecommendations(state);
  const primaryCause = topCause(latest);
  const warningText =
    state.runState === "crisisStopped"
      ? "危機のため一時停止中です。"
      : state.runState === "awaitingEvent"
        ? "出来事が起きました。対応を選んでください。"
        : crisis
          ? "物価や雇用に大きな不安があります。"
          : (state.events.warnings ?? []).length > 0
            ? `気になる兆候が${state.events.warnings!.length}件あります。`
            : "今のところ、大きな危機の兆候はありません。";
  const hasResponse = !!response;
  const hasEvidenceReturn = evidenceReturn !== undefined;
  const latestPolicy = selectLatestConfirmedPolicy(state);
  const latestPolicyId = latestPolicy?.policyId;
  const [detail, setDetail] = useState(
    evidenceReturn
      ? "report"
      : hasResponse
        ? "response"
        : latestPolicy
          ? "policy"
          : "cause",
  );
  useEffect(() => {
    setDetail(
      hasEvidenceReturn
        ? "report"
        : hasResponse
          ? "response"
          : latestPolicyId
            ? "policy"
            : "cause",
    );
  }, [
    hasResponse,
    latestPolicyId,
    hasEvidenceReturn,
    evidenceReturn?.monthIndex,
    evidenceReturn?.row,
  ]);
  function openEvidence(target: MonthlyEvidenceTarget) {
    if (onOpenEvidence) onOpenEvidence(target);
    else onOpenReport();
  }
  const details: Record<string, { title: string; content: ReactNode }> = {
    ...(hasResponse
      ? { response: { title: "危機や出来事への対応", content: response } }
      : {}),
    ...(latestPolicy
      ? {
          policy: {
            title: "確定した政策",
            content: policyConfirmationContent({ state, onOpenReport }),
          },
        }
      : {}),
    report: {
      title: "今月の報告",
      content: (
        <section className="panel">
          <h3 id="monthly-brief-heading">今月の3行報告</h3>
          {brief.report && <p>{brief.report.monthIndex}月目の報告です。</p>}
          {brief.prior ? (
            <div className="brief">
              {ranked.slice(0, 2).map(({ id, current, previous }, index) => (
                <article key={id}>
                  <p>{`${index + 1}. ${label(id)}は前月から${current > previous! ? "上昇" : current < previous! ? "低下" : "横ばい"}、${display(id, current)}です。`}</p>
                  <button
                    id={monthlyBriefButtonId(index as 0 | 1)}
                    className="brief-link"
                    aria-label={`${index + 1}行目・${label(id)}の根拠を見る`}
                    onClick={() =>
                      openEvidence({
                        monthIndex: brief.report!.monthIndex,
                        indicatorId: id,
                        row: index as 0 | 1,
                      })
                    }
                  >
                    {label(id)}の根拠を見る
                  </button>
                </article>
              ))}
              <article>
                <p>{`3. ${
                  brief.cause
                    ? `保存済み寄与の数値の絶対値が最大なのは、${label(brief.cause.indicatorId)}への${describeCause(brief.cause, state)}です（指標ごとに単位が異なります）`
                    : "大きな変化はまだ確認されていません"
                }。`}</p>
                <button
                  id={monthlyBriefButtonId(2)}
                  className="brief-link"
                  aria-label={`3行目・${brief.cause ? label(brief.cause.indicatorId) : "最大寄与"}の根拠を見る`}
                  onClick={() =>
                    openEvidence({
                      monthIndex: brief.report!.monthIndex,
                      row: 2,
                      ...(brief.cause
                        ? {
                            indicatorId: brief.cause.indicatorId,
                            cause: brief.cause,
                          }
                        : {}),
                    })
                  }
                >
                  {brief.cause ? label(brief.cause.indicatorId) : "最大寄与"}
                  の根拠を見る
                </button>
              </article>
            </div>
          ) : (
            <p>
              {evidenceReturn && !brief.report
                ? "選んだ月の報告は保存されていません。ホームの詳細を切り替えて、現在の情報を確認できます。"
                : "月を進めると、主要な変化と次に注意する点を表示します。"}
            </p>
          )}
        </section>
      ),
    },
    cause: {
      title: "いちばん大きく影響したこと",
      content: (
        <section className="panel">
          <h3>いちばん大きく影響したこと</h3>
          {primaryCause ? (
            <p>
              <strong>{causeCategory(primaryCause.sourceType)}</strong>：
              {label(primaryCause.indicatorId)}には
              {describeCause(primaryCause, state)}がいちばん大きく影響しました。
            </p>
          ) : (
            <p>
              月を進めると、変化の理由を政策や外部環境などに分けて確認できます。
            </p>
          )}
          <button onClick={onOpenReport}>変化の理由を見る</button>
        </section>
      ),
    },
    milestones: {
      title: "次の節目",
      content: (
        <section className="panel">
          <h3>次の節目</h3>
          <ul>
            {milestones.map((item, index) => (
              <li key={index}>
                {item.month + 1}月目：{item.text}
              </li>
            ))}
          </ul>
        </section>
      ),
    },
    recommendations: {
      title: "首席補佐官の提案",
      content: (
        <section className="panel recommendations">
          <h3>首席補佐官の提案</h3>
          {recommendations.length ? (
            <ol>
              {recommendations.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ol>
          ) : (
            <p>今は新しい提案はありません。指標の変化を見守りましょう。</p>
          )}
          <p className="quiet">
            提案を比べて、あなたが採用するかどうかを決められます。
          </p>
          <button onClick={onOpenPolicies}>政策会議で比較する</button>
        </section>
      ),
    },
    voices: {
      title: "国民・企業・市場の声",
      content: nationVoiceContent({ state, onOpenCause: onOpenReport }) ?? (
        <p>月を進めると、国民・企業・市場の声が届きます。</p>
      ),
    },
    warnings: {
      title: "気になる兆候",
      content: (state.events.warnings ?? []).length ? (
        (state.events.warnings ?? []).map((warning) => (
          <section className="panel" key={warning.eventId}>
            <h3>気になる兆候（警戒度 {warning.severity}）</h3>
            <p>
              {eventDisplayName(warning.eventId, state)}：準備度{" "}
              {Math.round(warning.preparedness * 100)}%
            </p>
            <p>
              {warning.missingIndicatorIds.length > 0
                ? `備えが足りない項目：${warning.missingIndicatorIds.map((id) => preparednessIndicatorLabel(id, warning.eventId, state)).join("、")}。政策会議で対策を検討してください。`
                : "主要な備えは整っています。"}
            </p>
          </section>
        ))
      ) : (
        <p>今のところ、気になる兆候はありません。</p>
      ),
    },
    ...(isTutorialTime(state)
      ? {
          tutorial: {
            title: "はじめの案内",
            content: tutorialContent(state),
          },
        }
      : {}),
  };
  const selected = details[detail] ?? details.cause!;
  return (
    <div className="home-layout">
      {timeControls}
      <p
        className={`home-warning ${crisis || state.runState === "awaitingEvent" ? "crisis" : "quiet"}`}
        role="status"
      >
        {warningText}
      </p>
      <section className="home-overview" aria-label="主要5指標・前月比">
        <h3>主要5指標・前月比</h3>
        <div className="indicator-grid home-indicators">
          {cards.map(({ id, current, previous, direction, assessment }) => (
            <article
              className={`indicator home-indicator indicator-${assessment}`}
              key={id}
            >
              <h4>
                <TermHelp termId={id} name={label(id)} />
              </h4>
              <strong>{display(id, current)}</strong>
              <small>
                {previous === undefined
                  ? "開始時点"
                  : `${direction === "up" ? "↑" : direction === "down" ? "↓" : "→"} ${display(id, Math.abs(current - previous))}・${assessment === "improved" ? "改善" : assessment === "worsened" ? "悪化" : "安定"}`}
              </small>
            </article>
          ))}
        </div>
      </section>
      <label className="detail-selector">
        ホームの詳細
        <select
          value={details[detail] ? detail : "cause"}
          onChange={(event) => setDetail(event.target.value)}
          aria-controls="home-details"
        >
          {Object.entries(details).map(([id, item]) => (
            <option value={id} key={id}>
              {item.title}
            </option>
          ))}
        </select>
      </label>
      <div id="home-details" className="home-details">
        <PageDeck
          key={detail}
          label={selected.title}
          navigation={
            detail === "report" && evidenceReturn
              ? {
                  key: `home-evidence-${evidenceReturn.monthIndex}-${evidenceReturn.row}`,
                  elementId:
                    brief.prior &&
                    (evidenceReturn.row === 2 || ranked[evidenceReturn.row])
                      ? monthlyBriefButtonId(evidenceReturn.row)
                      : "monthly-brief-heading",
                }
              : undefined
          }
        >
          {selected.content}
        </PageDeck>
      </div>
    </div>
  );
}

function Trend({
  reports,
  id,
}: {
  reports: readonly MonthlyReportSnapshot[];
  id: string;
}) {
  const values = reports
    .map((report) => report.values[id])
    .filter((value): value is number => value !== undefined);
  if (values.length < 2) return <p>月を進めると、指標の推移を確認できます。</p>;
  const min = Math.min(...values),
    span = Math.max(...values) - min || 1;
  const points = values
    .map(
      (value, index) =>
        `${(index / (values.length - 1)) * 100},${44 - ((value - min) / span) * 38}`,
    )
    .join(" ");
  return (
    <figure className="trend">
      <svg
        role="img"
        aria-label={`${label(id)}の${values.length}か月の推移`}
        viewBox="0 0 100 50"
        preserveAspectRatio="none"
      >
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption>
        {label(id)}：開始 {display(id, values[0]!)} → 現在{" "}
        {display(id, values.at(-1)!)}
      </figcaption>
    </figure>
  );
}

export function Report({
  state,
  evidenceTarget,
  onReturnToReport,
  onClearEvidence,
  onSelectEvidence,
  returnToEnding = false,
}: {
  state: GameState;
  evidenceTarget?: MonthlyEvidenceTarget | undefined;
  onReturnToReport?(): void;
  onClearEvidence?(): void;
  onSelectEvidence?(target: MonthlyEvidenceTarget): void;
  returnToEnding?: boolean;
}) {
  const reports = state.history.reports ?? [];
  const latest = reports.at(-1);
  const targetKey = evidenceTarget ? monthlyEvidenceQuery(evidenceTarget) : "";
  const [selection, setSelection] = useState<MonthlyEvidenceTarget>(
    () =>
      evidenceTarget ?? {
        monthIndex: latest?.monthIndex ?? state.monthIndex,
        ...(savedReportIndicatorIds(latest).includes("realGdp")
          ? { indicatorId: "realGdp" }
          : savedReportIndicatorIds(latest)[0]
            ? { indicatorId: savedReportIndicatorIds(latest)[0]! }
            : {}),
        row: 0 as const,
      },
  );
  const selectedTarget = evidenceTarget ?? selection;
  const selectedId =
    selectedTarget.cause?.indicatorId ?? selectedTarget.indicatorId;
  const selectedReport = reports.find(
    (report) => report.monthIndex === selectedTarget.monthIndex,
  );
  const indicatorIds = savedReportIndicatorIds(selectedReport);
  const breakdown = selectReportCauses(state, {
    monthIndex: selectedTarget.monthIndex,
    indicatorId: selectedId ?? "",
  });
  const exactEvidence =
    selectedTarget.row === 2
      ? selectMonthlyEvidence(state, selectedTarget)
      : undefined;
  const causes = exactEvidence?.causes ?? breakdown.causes;
  const missing = exactEvidence?.missing ?? breakdown.missing;
  const targetLabel = `${selectedTarget.monthIndex}月目・${selectedId ? label(selectedId) : "保存された指標"}`;
  const scopeKey = monthlyEvidenceQuery(selectedTarget);
  const [expandedScope, setExpandedScope] = useState<string>();
  const expanded = expandedScope === scopeKey;
  const causeLimit = visibleCauseCount(state.learningMode ?? "standard");
  const unit = reportIndicatorUnit(state.configSnapshot, selectedId ?? "");
  const totalsMatch =
    breakdown.totalDelta !== undefined &&
    breakdown.contributionSum !== undefined &&
    Math.abs(breakdown.totalDelta - breakdown.contributionSum) <=
      Math.max(1e-9, Math.abs(breakdown.totalDelta) * 1e-8);

  function selectTarget(next: MonthlyEvidenceTarget) {
    setSelection(next);
    setExpandedScope(undefined);
    onSelectEvidence?.(next);
  }
  const [requestedNavigation, setRequestedNavigation] = useState<{
    targetKey: string;
    navigation: PageDeckNavigation;
  }>();
  function openCategory(categoryId: string, nextTargetKey = targetKey) {
    setRequestedNavigation((previous) => ({
      targetKey: nextTargetKey,
      navigation: {
        key: `${previous?.navigation.key ?? "report"}-next`,
        categoryId,
      },
    }));
  }
  const profiles = expertProfilesForContentVersion(
    state.versions.contentVersion,
  );
  const [story, setStory] = useState(() =>
    ordinaryNews(projectFacts(state), state.versions.contentVersion),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const service = useMemo(() => createBrowserAIService(), []);
  useEffect(() => {
    setStory(ordinaryNews(projectFacts(state), state.versions.contentVersion));
  }, [state]);
  const facts = {
    ...projectFacts(state),
    causes: (latest?.topCauses ?? []).map((cause) => ({
      indicator: cause.indicatorId,
      delta: cause.delta,
      source: `${cause.sourceType}:${cause.sourceId}`,
      contribution: cause.delta,
    })),
  };
  const categories: PageDeckCategory[] = [
    {
      id: "trend",
      label: "推移",
      content: (
        <>
          <p className="quiet">
            ゲーム内の計算による説明です。現実の経済を予測するものではありません。
          </p>
          <section className="panel">
            <h3>経済の推移</h3>
            {["realGdp", "inflation", "unemployment"].map((id) => (
              <Trend key={id} reports={state.history.reports ?? []} id={id} />
            ))}
          </section>
        </>
      ),
    },
    {
      id: "causes",
      label:
        reports.length || evidenceTarget
          ? `変化の理由（${targetLabel}）`
          : "変化の理由",
      content: (
        <>
          <section className="panel">
            <h3>
              {reports.length || evidenceTarget
                ? `${targetLabel}の変化の理由`
                : "変化の理由"}
            </h3>
            {(reports.length > 0 || evidenceTarget) && (
              <>
                <label>
                  報告の月
                  <select
                    value={selectedTarget.monthIndex}
                    onChange={(event) => {
                      const monthIndex = Number(event.target.value);
                      const ids = savedReportIndicatorIds(
                        reports.find(
                          (report) => report.monthIndex === monthIndex,
                        ),
                      );
                      const indicatorId =
                        selectedId && ids.includes(selectedId)
                          ? selectedId
                          : ids.includes("realGdp")
                            ? "realGdp"
                            : ids[0];
                      selectTarget({
                        monthIndex,
                        row: 0,
                        ...(indicatorId ? { indicatorId } : {}),
                      });
                    }}
                  >
                    {!selectedReport && (
                      <option value={selectedTarget.monthIndex}>
                        {selectedTarget.monthIndex}月目（記録なし）
                      </option>
                    )}
                    {reports.map((report) => (
                      <option key={report.monthIndex} value={report.monthIndex}>
                        {report.monthIndex}月目
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  報告の指標
                  <select
                    value={selectedId ?? ""}
                    disabled={!indicatorIds.length}
                    onChange={(event) =>
                      selectTarget({
                        monthIndex: selectedTarget.monthIndex,
                        indicatorId: event.target.value,
                        row: 0,
                      })
                    }
                  >
                    {(!selectedId || !indicatorIds.includes(selectedId)) && (
                      <option value={selectedId ?? ""}>
                        {selectedId
                          ? `${label(selectedId)}（記録なし）`
                          : "指標の記録なし"}
                      </option>
                    )}
                    {indicatorIds.map((id) => (
                      <option key={id} value={id}>
                        {label(id)}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {breakdown.beforeValue !== undefined &&
            breakdown.afterValue !== undefined ? (
              <p data-report-summary>
                {`因果記録の前値：${reportNumber(breakdown.beforeValue, unit)} → 後値：${reportNumber(breakdown.afterValue, unit)}`}
              </p>
            ) : selectedId &&
              selectedReport?.values[selectedId] !== undefined ? (
              <p data-report-summary>
                この月の値：
                {reportNumber(selectedReport.values[selectedId]!, unit)}
                。前月の値・変化量の因果記録は保存されていません。
              </p>
            ) : (
              selectedReport && <p>この月の指標値は保存されていません。</p>
            )}
            {breakdown.totalDelta !== undefined &&
              breakdown.contributionSum !== undefined && (
                <>
                  <p data-report-total>
                    記録された変化：
                    {reportNumber(breakdown.totalDelta, unit, true)}
                    、保存済み寄与の合計：
                    {reportNumber(breakdown.contributionSum, unit, true)}
                  </p>
                  <p>
                    合計の照合：
                    {totalsMatch
                      ? "一致（丸め前の保存値で確認）"
                      : "不一致（保存された因果記録を確認してください）"}
                    。表示値の四捨五入により合計が一致しない場合があります。
                  </p>
                </>
              )}
            {selectedReport &&
              breakdown.completeness === "legacy-incomplete" && (
                <p>
                  この月は旧形式の記録で、全指標を通じた上位8件の寄与だけが保存されています。全内訳と変化量の照合はできません。記録がないことは、影響がなかったことを意味しません。
                </p>
              )}
            {selectedReport && breakdown.completeness === "initial" && (
              <p>開始時点の記録です。月次変化の因果記録はまだありません。</p>
            )}
            {causes.length ? (
              <>
                <p className="quiet">
                  {selectedTarget.row === 2
                    ? "ホームの3行目に表示された寄与です。"
                    : `選択した月・指標の保存済み寄与を、数値の絶対値が大きい順に${expanded ? "全件" : `上位${causeLimit}件`}表示します。`}
                </p>
                <ol>
                  {causes
                    .slice(
                      0,
                      expanded || selectedTarget.row === 2
                        ? undefined
                        : causeLimit,
                    )
                    .map((cause, index) => (
                      <li key={index} data-report-cause={cause.sourceId}>
                        {label(cause.indicatorId)}：
                        {describeCause(cause, state)}（
                        {causeCategory(cause.sourceType)}）、変化への影響{" "}
                        {reportNumber(cause.delta, unit, true)}
                      </li>
                    ))}
                </ol>
                {selectedTarget.row === 2 &&
                  selectedId &&
                  breakdown.causes.length > 1 && (
                    <button
                      onClick={() => {
                        const next = {
                          monthIndex: selectedTarget.monthIndex,
                          indicatorId: selectedId,
                          row: 0 as const,
                        };
                        selectTarget(next);
                        setExpandedScope(monthlyEvidenceQuery(next));
                      }}
                    >
                      この指標の全内訳を見る
                    </button>
                  )}
                {selectedTarget.row !== 2 && causes.length > causeLimit && (
                  <button
                    aria-expanded={expanded}
                    onClick={() =>
                      setExpandedScope(expanded ? undefined : scopeKey)
                    }
                  >
                    {expanded
                      ? `上位${causeLimit}件に戻す`
                      : `保存された寄与をすべて表示（${causes.length}件）`}
                  </button>
                )}
              </>
            ) : !reports.length && !evidenceTarget ? (
              <p>月を進めると、指標が変わった理由を確認できます。</p>
            ) : (
              <>
                <p>
                  {missing === "report"
                    ? "この月の報告が保存されていないため、根拠を表示できません。"
                    : selectedTarget.row === 2
                      ? "この月の保存済み報告には、参照された寄与の因果記録がありません。"
                      : "この月の保存済み報告には、この指標の因果記録がありません。"}
                </p>
                <p>
                  「推移」でGDP・物価・失業の経過を、「国家史」で政策や出来事を確認できます。
                </p>
                <button onClick={() => openCategory("trend")}>
                  推移を確認する
                </button>
                <button onClick={() => openCategory("history")}>
                  国家史を確認する
                </button>
              </>
            )}
          </section>
        </>
      ),
    },
    {
      id: "voices",
      label: "国の声",
      content: (
        <>
          {nationVoiceContent({ state })}
        </>
      ),
    },
    {
      id: "history",
      label: "国家史",
      content: (
        <>
          <section className="panel" aria-labelledby="national-history-heading">
            <h3 id="national-history-heading">国家史</h3>
            <p>政策や出来事を月ごとにまとめています。変化の理由も振り返れます。</p>
            {nationalHistory(state).length ? (
              <div className="history-timeline">
                {nationalHistory(state).map((entry) => (
                  <article key={entry.entryId}>
                    <h4>
                      {entry.month}月目：
                      {entry.categories
                        .map((category) => HISTORY_CATEGORY_LABELS[category])
                        .join("・")}
                    </h4>
                    <p>
                      記録：
                      {[
                        ...new Set(
                          entry.referenceIds.map((id) =>
                            historyReferenceDisplay(id, state),
                          ),
                        ),
                      ].join("、")}
                    </p>
                    {entry.causeRefs.length > 0 && (
                      <p>
                        変化の理由：
                        {[
                          ...new Set(
                            entry.causeRefs.map((ref) =>
                              historyCauseDisplay(ref, state),
                            ),
                          ),
                        ].join("、")}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <p>
                まだ節目の記録はありません。政策や出来事があると、ここに残ります。
              </p>
            )}
          </section>
        </>
      ),
    },
    {
      id: "learning",
      label: "学習内容",
      content: (
        <>
          {state.learningMode === "learning" && (
            <section className="panel" aria-labelledby="school-lenses-heading">
              <h3 id="school-lenses-heading">思想比較</h3>
              <p>
                同じ結果を、異なる目的や前提から見比べます。どれが正解かを決めるものではありません。
              </p>
              <div className="school-lens-grid">
                {schoolLensesForContentVersion(state.versions.contentVersion).map(
                  (lens) => (
                    <article key={lens.schoolId}>
                      <h4>{lens.displayName}</h4>
                      <p>
                        <strong>重視する目的：</strong>
                        {lens.goals.join("、")}
                      </p>
                      <p>
                        <strong>前提：</strong>
                        {lens.premises.join("、")}
                      </p>
                      <p>
                        <strong>政策への見方：</strong>
                        {lens.view}
                      </p>
                      <p>
                        <strong>想定する利点：</strong>
                        {lens.benefits.join("、")}
                      </p>
                      <p>
                        <strong>想定するリスク：</strong>
                        {lens.risks.join("、")}
                      </p>
                    </article>
                  ),
                )}
              </div>
              <p className="quiet">
                ゲーム内の説明です。現実の思想や政策の優劣を示すものではありません。
              </p>
            </section>
          )}
          {state.learningMode === "learning" && (
            <section className="panel" aria-labelledby="forecast-records-heading">
              <h3 id="forecast-records-heading">専門家の予測記録</h3>
              {(state.history.forecastRecords ?? []).length ? (
                <div>
                  {(state.history.forecastRecords ?? [])
                    .slice()
                    .reverse()
                    .map((record) => (
                      <article key={record.recordId}>
                        <h4>{record.recordedMonth}月目の政策判断</h4>
                        <p>
                          専門家：
                          {record.expertIds
                            .map(
                              (id) =>
                                profiles.find((profile) => profile.id === id)
                                  ?.displayName ?? "当時の専門家",
                            )
                            .join("、")}
                          、確信度：
                          {
                            { low: "低", medium: "中", high: "高" }[
                              record.confidence
                            ]
                          }
                        </p>
                        {record.horizons.map((horizon) => (
                          <p key={horizon.months}>
                            {horizon.months === 12 ? "1年" : "5年"}：GDP差{" "}
                            {display("realGdp", horizon.indicators.realGdp ?? 0)}
                          </p>
                        ))}
                        <p>
                          主な不確実性：{uncertaintyExplanation(record.uncertainty)}
                        </p>
                      </article>
                    ))}
                </div>
              ) : (
                <p>政策を確定すると、そのときの1年・5年の見通しを保存します。</p>
              )}
              <p className="quiet">
                見通しの数値は全専門家で共通です。それぞれの視点から解説します。
              </p>
            </section>
          )}
          {state.learningMode === "learning" && (
            <section className="panel" aria-labelledby="notebook-heading">
              <h3 id="notebook-heading">経済学ノート</h3>
              {(state.history.learningEntries ?? []).length ? (
                <div>
                  {(state.history.learningEntries ?? [])
                    .slice()
                    .reverse()
                    .map((entry) => {
                      const entryDisplay = learningEntryDisplay(entry, state);
                      return (
                        <article key={entry.entryId}>
                          <h4>{entryDisplay.concept}</h4>
                          <p>
                            {entry.month}月目・{entryDisplay.kindLabel}
                          </p>
                          <p>根拠：{entryDisplay.evidence}</p>
                        </article>
                      );
                    })}
                </div>
              ) : (
                <p>月を進めると、用語や判断を振り返るノートが残ります。</p>
              )}
              <p className="quiet">
                ノートで用語や判断を振り返れます。記録が政策の効果を変えることはありません。
              </p>
            </section>
          )}
        </>
      ),
    },
    {
      id: "news",
      label: "経済ニュース",
      content: (
        <>
          <section className="panel">
            <h3>経済ニュース</h3>
            <h4>{story.headline}</h4>
            <p>{story.explanation}</p>
            <button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void service
                  .news({ id: `month-${facts.month}`, facts })
                  .then(setStory)
                  .catch(() =>
                    setError(
                      "特別報道を読み込めませんでした。少し待って、もう一度試してください。",
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "特別報道を読み込んでいます…" : "特別報道を読む"}
            </button>
            {error && <p role="alert">{error}</p>}
          </section>
        </>
      ),
    },
  ];
  return (
    <PageDeck
      label="経済レポート"
      categories={categories}
      navigation={
        requestedNavigation?.targetKey === targetKey
          ? requestedNavigation.navigation
          : evidenceTarget
            ? { key: `evidence-${targetKey}`, categoryId: "causes" }
            : undefined
      }
      actions={
        (evidenceTarget || returnToEnding) && (
          <>
            {onReturnToReport && (
              <button onClick={onReturnToReport}>
                {returnToEnding ? "終了評価へ戻る" : "ホームの報告へ戻る"}
              </button>
            )}
            {evidenceTarget && onClearEvidence && (
              <button
                onClick={() => {
                  setSelection({
                    monthIndex: selectedTarget.monthIndex,
                    row: 0,
                    ...(selectedId ? { indicatorId: selectedId } : {}),
                  });
                  openCategory("causes", "");
                  onClearEvidence();
                }}
              >
                すべての変化の理由を見る
              </button>
            )}
          </>
        )
      }
    />
  );
}

export type PolicyFormDraftState = {
  ruleId: string;
  value: number;
  /** Keep the entered text across screen changes without rounding the submitted value. */
  displayValue?: string | undefined;
  quartersAhead: number;
  policyId: string;
  expertIds: readonly string[];
};

/** Policy rules store decimal rates; the five built-in inputs show human-sized units. */
function policyDisplayNumber(value: number): number {
  return Number((value * 100).toPrecision(12));
}

function signedPolicyDisplayNumber(value: number): string {
  const displayed = policyDisplayNumber(value);
  return displayed > 0 ? `+${displayed}` : String(displayed);
}

export function PolicyForm({
  state,
  onPreview,
  busy,
  draftState,
  onDraftChange,
  extra,
}: {
  state: GameState;
  onPreview(draft: PolicyDraft, expertIds: readonly string[]): void;
  busy: boolean;
  draftState?: PolicyFormDraftState | undefined;
  onDraftChange?(draft: PolicyFormDraftState): void;
  extra?: ReactNode;
}) {
  const rules = policyRules(state.configSnapshot);
  const profiles = expertProfilesForContentVersion(
    state.versions.contentVersion,
  );
  const [localDraft, setLocalDraft] = useState<PolicyFormDraftState>(() => ({
    ruleId: rules[0]?.policyId ?? "",
    value:
      rules[0]?.inputs?.[0]?.defaultValue ?? rules[0]?.referenceValue ?? 0.03,
    quartersAhead: 0,
    policyId: crypto.randomUUID(),
    expertIds: ["macro"],
  }));
  const draft = draftState ?? localDraft;
  const {
    ruleId,
    value,
    quartersAhead: ahead,
    policyId: draftId,
    expertIds,
  } = draft;
  const rule = rules.find((item) => item.policyId === ruleId);
  const inputCopy = rule
    ? policyInputCopy[rule.policyType as keyof typeof policyInputCopy]
    : undefined;
  const inputId = useId();
  const inputMin = rule?.inputs?.[0]?.min ?? rule?.inputMin;
  const inputMax = rule?.inputs?.[0]?.max ?? rule?.inputMax;
  const inputStep = rule?.inputs?.[0]?.step;
  const scale = inputCopy ? 100 : 1;
  const validValue =
    Number.isFinite(value) &&
    inputMin !== undefined &&
    inputMax !== undefined &&
    value >= inputMin &&
    value <= inputMax &&
    (inputStep === undefined ||
      Math.abs(
        (value - inputMin) / inputStep -
          Math.round((value - inputMin) / inputStep),
      ) <= 1e-8);
  const rangeText =
    inputMin !== undefined && inputMax !== undefined
      ? `入力できる範囲：${inputCopy ? policyDisplayNumber(inputMin) : inputMin}〜${inputCopy ? policyDisplayNumber(inputMax) : inputMax}${inputCopy?.unit ?? ""}。`
      : "";
  const comparison = (() => {
    if (!inputCopy || !rule) return "";
    const basis =
      inputCopy.basis === "current"
        ? state.economy.rates.policyRate
        : (rule.referenceValue ?? 0);
    const basisText = `${inputCopy.basisLabel} ${policyDisplayNumber(basis)}${inputCopy.unit}`;
    if (!validValue)
      return `${basisText}。範囲内の値を入力すると、基準からの差を表示します。`;
    const difference = value - basis;
    if (difference === 0) return `${basisText}。${inputCopy.equal}`;
    return `${basisText}から ${signedPolicyDisplayNumber(difference)}ポイント（${difference > 0 ? inputCopy.positive : inputCopy.negative}）。`;
  })();
  function updateDraft(change: Partial<PolicyFormDraftState>) {
    const next = { ...draft, ...change };
    setLocalDraft(next);
    onDraftChange?.(next);
  }
  const meeting = policyMeetingStatus(state);
  let draftCosts: PolicyCosts | null = null;
  const policyIssue = (() => {
    try {
      draftCosts = createReservedPolicy(
        state,
        ruleId,
        value,
        draftId,
        ahead,
      ).costs;
      if (
        policyResourceComparison(state, draftCosts).some(
          (row) => row.shortage > 0,
        )
      )
        return {
          kind: "resources" as const,
          message:
            "費用と資源の残量で不足量を確認し、政策案を見直してください。",
        };
      return null;
    } catch {
      return {
        kind: "input" as const,
        message:
          inputMin !== undefined && inputMax !== undefined
            ? `${inputCopy?.label ?? "設定値"}は${inputCopy ? policyDisplayNumber(inputMin) : inputMin}〜${inputCopy ? policyDisplayNumber(inputMax) : inputMax}${inputCopy?.unit ?? ""}の範囲で入力してください。値を見直して、もう一度見通しを確認してください。`
            : "設定値を確認できませんでした。政策を選び直して、もう一度試してください。",
      };
    }
  })();
  return (
    <PageDeck
      label="政策会議"
      actions={
        <>
          <button
            className="primary"
            disabled={busy || meeting.slotsRemaining === 0 || !!policyIssue}
            onClick={() => {
              onDraftChange?.(draft);
              onPreview(
                {
                  status: "draft",
                  policyId: draftId,
                  ruleId,
                  value,
                  quartersAhead: ahead,
                },
                expertIds,
              );
            }}
          >
            {busy ? "見通しを計算しています…" : "見通しを確認"}
          </button>
          {(policyIssue || meeting.slotsRemaining === 0) && (
            <span role="status" className="action-warning">
              {policyIssue
                ? policyIssue.kind === "resources"
                  ? "政策を進める準備が足りません。本文の案内を確認してください。"
                  : "政策の入力を確認してください。本文の案内を確認してください。"
                : "今四半期の政策枠は使い切りました。次の四半期にもう一度検討できます。"}
            </span>
          )}
        </>
      }
    >
      <section className="panel">
        <h3>政策案を作る</h3>
        <label>
          政策の種類
          <select
            value={ruleId}
            onChange={(event) => {
              const next = rules.find(
                (item) => item.policyId === event.target.value,
              );
              updateDraft({
                ruleId: event.target.value,
                displayValue: undefined,
                value:
                  next?.inputs?.[0]?.defaultValue ??
                  next?.referenceValue ??
                  0.03,
                policyId: crypto.randomUUID(),
              });
            }}
          >
            {rules.map((item) => (
              <option key={item.policyId} value={item.policyId}>
                {label(item.policyId)}
              </option>
            ))}
          </select>
        </label>
        <label className="policy-value-field">
          <span id={`${inputId}-label`}>
            {inputCopy?.label ?? `${label(ruleId)}の設定値`}
          </span>
          {inputCopy && (
            <span id={`${inputId}-meaning`} className="policy-value-help">
              {inputCopy.meaning}
            </span>
          )}
          <input
            type="number"
            required
            aria-labelledby={`${inputId}-label`}
            aria-describedby={`${inputId}-meaning ${inputId}-range ${inputId}-comparison${inputCopy?.basis === "current" ? ` ${inputId}-reference` : ""}`}
            min={
              inputMin === undefined
                ? undefined
                : inputCopy
                  ? policyDisplayNumber(inputMin)
                  : inputMin
            }
            max={
              inputMax === undefined
                ? undefined
                : inputCopy
                  ? policyDisplayNumber(inputMax)
                  : inputMax
            }
            step={
              inputStep === undefined
                ? "any"
                : inputCopy
                  ? policyDisplayNumber(inputStep)
                  : inputStep
            }
            value={
              draft.displayValue ??
              (Number.isFinite(value)
                ? inputCopy
                  ? policyDisplayNumber(value)
                  : value
                : "")
            }
            onChange={(event) =>
              updateDraft({
                displayValue: event.target.value,
                value:
                  event.target.value === ""
                    ? Number.NaN
                    : Number(event.target.value) / scale,
              })
            }
          />
          <span id={`${inputId}-range`} className="policy-value-help">
            {rangeText}
          </span>
          {inputCopy && (
            <span
              id={`${inputId}-comparison`}
              className="policy-value-help"
              aria-live="polite"
            >
              {comparison}
            </span>
          )}
          {inputCopy?.basis === "current" &&
            rule?.referenceValue !== undefined && (
              <span id={`${inputId}-reference`} className="policy-value-help">
                効果計算の基準値は{policyDisplayNumber(rule.referenceValue)}
                %です。
              </span>
            )}
        </label>
        <label>
          政策を始める時期
          <select
            value={ahead}
            onChange={(event) =>
              updateDraft({ quartersAhead: Number(event.target.value) })
            }
          >
            {[0, 1, 2, 3].map((offset) => (
              <option key={offset} value={offset}>
                {offset === 0 ? "すぐに始める" : `${offset}四半期後`}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="expert-picker">
          <legend>解説を聞く専門家（1〜3人）</legend>
          {profiles.map((expert) => (
            <label
              key={expert.id}
              style={{ "--expert-color": expert.colorToken } as CSSProperties}
            >
              <input
                type="checkbox"
                checked={expertIds.includes(expert.id)}
                disabled={
                  expertIds.includes(expert.id)
                    ? expertIds.length === 1
                    : expertIds.length === 3
                }
                onChange={() =>
                  updateDraft({
                    expertIds: expertIds.includes(expert.id)
                      ? expertIds.filter((id) => id !== expert.id)
                      : [...expertIds, expert.id],
                  })
                }
              />
              <ExpertPortrait expertId={expert.id} />
              <span className="expert-identity-copy">
                <strong>{expert.displayName ?? expert.role}</strong>
                <span className="expert-role">
                  {expert.role} · {expert.tone}
                </span>
                <span>{expert.values}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {meeting.slotsRemaining === 0 && (
          <p>
            今四半期の3枠を使い切りました。月を進めると、次の四半期に検討できます。
          </p>
        )}
        {policyIssue && <p role="status">{policyIssue.message}</p>}
      </section>
      {draftCosts && policyResourcesContent(state, draftCosts)}
      {extra}
    </PageDeck>
  );
}

export function Preview({
  state,
  output,
  configSnapshot,
  counterfactuals,
  expertIds,
  contentVersion,
  busy,
  onConfirm,
  onBack,
  onRefresh,
}: {
  state: GameState;
  output: PreviewOutput | null;
  configSnapshot: ConfigSnapshot;
  counterfactuals: readonly PreviewOutput[];
  expertIds: readonly string[];
  contentVersion: string;
  busy: boolean;
  onConfirm(): void;
  onBack?(): void;
  onRefresh?(): void;
}) {
  const [reviewedKey, setReviewedKey] = useState<string | null>(null);
  const currentHash = useMemo(() => policyStateHash(state), [state]);
  const reviewKey = output ? `${output.stateHash}:${output.draftHash}` : null;
  const reviewed = reviewKey !== null && reviewedKey === reviewKey;
  if (!output)
    return (
      <PageDeck
        label="政策の見通し"
        actions={onBack && <button onClick={onBack}>案を修正する</button>}
      >
        <p className="panel">
          政策会議で案を作り、「見通しを確認」を押してください。
        </p>
      </PageDeck>
    );
  if (output.stateHash !== currentHash) {
    let latestCosts: PolicyCosts | null = null;
    const draft = output.previewedDraft;
    if (draft) {
      try {
        latestCosts = createReservedPolicy(
          state,
          draft.ruleId,
          draft.value,
          draft.policyId,
          draft.quartersAhead,
        ).costs;
      } catch {
        // The current state's allowed policy inputs may also have changed.
      }
    }
    return (
      <PageDeck
        label="政策の見通し"
        actions={
          <>
            {onBack && (
              <button onClick={onBack} disabled={busy}>
                案を修正する
              </button>
            )}
            {onRefresh && (
              <button className="primary" onClick={onRefresh} disabled={busy}>
                最新状態で見通しを更新
              </button>
            )}
          </>
        }
      >
        <p role="status">
          資源やゲームの状態が変わりました。以下は最新状態の残量です。見通しを更新して、費用・副作用・警告をもう一度確認してください。
        </p>
        {latestCosts && policyResourcesContent(state, latestCosts)}
      </PageDeck>
    );
  }
  const insufficient = policyResourceComparison(state, output.costs).some(
    (row) => row.shortage > 0,
  );
  const forecast = (months: 12 | 60, indicatorId: string) =>
    output.summaries.find(
      (item) =>
        item.horizonMonths === months && item.indicatorId === indicatorId,
    );
  const directionalRanges = output.indicators
    .filter((item) =>
      ["realGdp", "inflation", "unemployment"].includes(item.indicatorId),
    )
    .map(({ month12 }) =>
      month12.deltaLow > 0 && month12.deltaHigh > 0
        ? true
        : month12.deltaLow < 0 && month12.deltaHigh < 0,
    );
  const directionalCount = directionalRanges.filter(Boolean).length;
  const confidence =
    directionalCount === directionalRanges.length
      ? "高"
      : directionalCount > 0
        ? "中"
        : "低";
  const profiles = expertProfilesForContentVersion(contentVersion);
  const advisor = new RuleBasedExpertAdvisor();
  const uncertaintyNote = uncertaintyExplanation(output.uncertainty.note);
  const adviceContext = {
    effects: Object.fromEntries(
      output.summaries
        .filter((item) => item.horizonMonths === 60)
        .map((item) => [item.indicatorId, item.endDelta]),
    ),
    uncertainty: uncertaintyNote,
    contentVersion,
  };
  const dissentingExpert = profiles.find(
    (profile) => !expertIds.includes(profile.id),
  );
  const draft = output.previewedDraft;
  const rule = policyRules(configSnapshot).find(
    (item) => item.policyId === draft?.ruleId,
  );
  const inputCopy = rule
    ? policyInputCopy[rule.policyType as keyof typeof policyInputCopy]
    : undefined;
  const effectStartMonth = output.primaryEffects.length
    ? Math.min(...output.primaryEffects.map((effect) => effect.startMonth))
    : null;
  const categories: PageDeckCategory[] = [
    {
      id: "summary",
      label: "判断要約",
      content: (
        <>
          <h3>判断の要点</h3>
          <section className="panel" aria-label="判断の要点">
            <p>
              <strong>政策案：</strong>
              {draft
                ? label(rule?.policyType ?? draft.ruleId)
                : "今の政策を続ける"}
              {draft && (
                <>
                  。{inputCopy?.label ?? "設定値"}：
                  {inputCopy ? policyDisplayNumber(draft.value) : draft.value}
                  {inputCopy?.unit ?? ""}
                </>
              )}
            </p>
            <p>
              <strong>時期：</strong>政策の開始は
              {output.activationMonth === null
                ? "設定していません"
                : `${output.activationMonth + 1}月目`}
              、主効果の効き始めは
              {effectStartMonth === null
                ? "予定なし"
                : `${effectStartMonth + 1}月目`}
              。GDPへの効果がいちばん大きい時期は
              {forecast(12, "realGdp")?.peakMonth ?? "—"}
              か月後。
            </p>
            <p>
              <strong>現状維持との差（1年後）：</strong>
              {output.indicators
                .filter((item) =>
                  ["realGdp", "inflation", "unemployment"].includes(
                    item.indicatorId,
                  ),
                )
                .map(
                  (item) =>
                    `${label(item.indicatorId)} ${item.month12.deltaBase > 0 ? "+" : ""}${display(item.indicatorId, item.month12.deltaBase)}`,
                )
                .join("、")}
              。新しい政策を加えない場合と比べた中心値です。
            </p>
            <p>
              <strong>副作用：</strong>
              {output.sideEffects.length
                ? output.sideEffects
                    .map(
                      (effect) =>
                        `${label(effect.targetPath)}（${effect.startMonth + 1}月目から）`,
                    )
                    .join("、")
                : "この見通しで予定されている副作用はありません"}
              。
            </p>
            {output.interactions.length > 0 && (
              <p>
                同じ種類の政策が{output.interactions.length}
                件あります。効果が重なる点にも気をつけましょう。
              </p>
            )}
            <p>
              <strong>不確実性：</strong>確信度 {confidence}。主な要因は
              {output.uncertainty.majorDrivers.map(label).join("、")}。
            </p>
            <p>{uncertaintyNote}</p>
          </section>
          {policyResourcesContent(state, output.costs)}
          <section className="panel" aria-labelledby="interaction-heading">
            <h3 id="interaction-heading">政策の組み合わせ</h3>
            <p>
              組み合わせの追加費用は基本費用と別で、確定時の予約対象外です。上の採用後残量には含めません。開始月以降の実施時に条件と使える量を再判定し、発動した場合だけ消費します。予約した政策が未実施の場合など、見込みは変わることがあります。
            </p>
            {output.comboResults.map((combo) => {
              const reason = combo.reason
                ? {
                    "missing-required-policy": "必要な政策が揃っていません",
                    "forbidden-policy": "同時に使えない政策があります",
                    "insufficient-overlap": `重複期間が${combo.overlapMonths}か月で条件を満たしません`,
                    "insufficient-additional-cost":
                      "組み合わせの追加費用が足りません（政策自体は確定できます）",
                    "missing-required-combo":
                      "前提となる組み合わせの効果がまだ出ていません",
                    "already-fired-this-month": "今月はすでに効果が出ています",
                  }[combo.reason]
                : "すべての条件を満たします";
              return (
                <article className="combo-result" key={combo.comboId}>
                  <h4>
                    {combo.kind === "synergy"
                      ? "効果を高め合う組み合わせ"
                      : "効果を打ち消し合う組み合わせ"}
                    ：{combo.requiredPolicyIds.map(label).join(" ＋ ")}
                  </h4>
                  <p>
                    条件：{combo.requiredPolicyIds.map(label).join(" ＋ ")}
                    {combo.forbiddenPolicyIds.length
                      ? `（併用不可：${combo.forbiddenPolicyIds.map(label).join("、")}）`
                      : ""}
                  </p>
                  <p>
                    {combo.activated
                      ? "組み合わせの効果が出る見込みです"
                      : "組み合わせの効果は出ない見込みです"}
                    。 {reason}。
                  </p>
                  <p>
                    発動時の追加費用（基本費用・予約対象外）：政治資本{" "}
                    {combo.additionalCosts.politicalCapital}
                    点、実施能力 {combo.additionalCosts.implementationCapacity}
                    点、外貨準備 {combo.additionalCosts.foreignReserves} model
                    unit、予算 {combo.additionalCosts.immediateBudget} model
                    unit。
                  </p>
                </article>
              );
            })}
            {output.comboResults.length === 0 && (
              <p>今の設定には、特別な組み合わせの効果はありません。</p>
            )}
          </section>
          <label className="review-acknowledgement">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={busy}
              onChange={(event) =>
                setReviewedKey(event.target.checked ? reviewKey : null)
              }
            />
            費用・副作用・警告を確認しました
          </label>
          <p className="quiet">
            ゲーム内の計算による見通しです。外部環境の揺れを想定し、結果の幅を示しています。
          </p>
        </>
      ),
    },
    {
      id: "comparison",
      label: "現状維持との比較",
      content: (
        <>
          <section className="panel">
            <h3>新しい政策を加えない場合との12か月比較</h3>
            <div className="comparison-list">
              {output.indicators
                .filter((item) =>
                  [
                    "realGdp",
                    "inflation",
                    "unemployment",
                    "policyTrust",
                    "foreignReserves",
                  ].includes(item.indicatorId),
                )
                .map((item) => (
                  <article key={item.indicatorId}>
                    <h4>{label(item.indicatorId)}</h4>
                    <p>
                      3か月：{display(item.indicatorId, item.month3.low)} ～{" "}
                      {display(item.indicatorId, item.month3.high)}（中心{" "}
                      {display(item.indicatorId, item.month3.base)}）
                    </p>
                    <p>
                      6か月：{display(item.indicatorId, item.month6.low)} ～{" "}
                      {display(item.indicatorId, item.month6.high)}
                    </p>
                    <p>
                      12か月：{display(item.indicatorId, item.month12.low)} ～{" "}
                      {display(item.indicatorId, item.month12.high)}
                      、新しい政策を加えない場合との差{" "}
                      {item.month12.deltaBase > 0 ? "+" : ""}
                      {display(item.indicatorId, item.month12.deltaBase)}
                    </p>
                  </article>
                ))}
            </div>
          </section>
        </>
      ),
    },
    {
      id: "forecast",
      label: "長期見通し",
      content: (
        <>
          <section className="panel" aria-labelledby="forecast-heading">
            <h3 id="forecast-heading">1年・5年の見通し</h3>
            <p>
              確信度：{confidence}。主な不確実性：
              {output.uncertainty.majorDrivers.map(label).join("、")}。
            </p>
            <div className="forecast-grid">
              {["realGdp", "inflation", "unemployment"].map((indicatorId) => (
                <article key={indicatorId}>
                  <h4>{label(indicatorId)}</h4>
                  <p>
                    1年後の新しい政策を加えない場合との差：
                    {display(indicatorId, forecast(12, indicatorId)?.endDelta ?? 0)}
                  </p>
                  <p>
                    5年後の新しい政策を加えない場合との差：
                    {display(indicatorId, forecast(60, indicatorId)?.endDelta ?? 0)}
                  </p>
                </article>
              ))}
            </div>
          </section>
        </>
      ),
    },
    {
      id: "alternatives",
      label: "別案",
      content: (
        <>
          <section className="panel" aria-labelledby="counterfactual-heading">
            <h3 id="counterfactual-heading">別の政策を選んだら</h3>
            <p>
              基準時点：ゲーム内{" "}
              {output.activationMonth === null
                ? "現在"
                : `${output.activationMonth + 1}月目`}
              。今の国の状態と外部環境をそろえて比べています。
            </p>
            <div
              className="counterfactual-cards"
              aria-label="政策案と新しい政策を加えない場合の比較"
            >
              {[output, ...counterfactuals].map((candidate) => {
                const row = candidate.indicators.find(
                  (item) => item.indicatorId === "realGdp",
                )!;
                const fiveYear = candidate.summaries.find(
                  (item) =>
                    item.indicatorId === "realGdp" && item.horizonMonths === 60,
                );
                return (
                  <article key={candidate.draftHash}>
                    <h4>
                      {candidate.previewedDraft
                        ? label(candidate.previewedDraft.ruleId)
                        : "今の政策を続ける"}
                    </h4>
                    {[
                      { horizon: "3か月", value: row.month3.deltaBase },
                      { horizon: "6か月", value: row.month6.deltaBase },
                      { horizon: "1年", value: row.month12.deltaBase },
                      { horizon: "5年", value: fiveYear?.endDelta ?? 0 },
                    ].map(({ horizon, value }) => (
                      <p key={horizon}>
                        {horizon}：{value > 0 ? "+" : ""}
                        {display("realGdp", value)}
                      </p>
                    ))}
                  </article>
                );
              })}
            </div>
            <small>表示値は、新しい政策を加えない場合との成長の差です。</small>
          </section>
        </>
      ),
    },
    {
      id: "experts",
      label: "専門家",
      content: (
        <>
          <section className="panel" aria-labelledby="advice-heading">
            <h3 id="advice-heading">選択した専門家の解説</h3>
            {expertIds.map((expertId) => {
              const expert = profiles.find((item) => item.id === expertId)!;
              const advice = advisor.advise(expert, adviceContext);
              return (
                <article
                  className="expert-advice"
                  key={expertId}
                  style={{ "--expert-color": expert.colorToken } as CSSProperties}
                >
                  <header className="expert-identity" data-page-title>
                    <ExpertPortrait expertId={expert.id} />
                    <div className="expert-identity-copy">
                      <h4>{expert.role}</h4>
                      <p className="quiet">
                        {expert.displayName ?? expert.role} · 口調：{expert.tone}
                      </p>
                    </div>
                  </header>
                  <p>
                    <strong>結論：</strong>
                    {adviceExplanation(
                      advice.conclusion,
                      expert.priorityIndicators ??
                        Object.keys(adviceContext.effects),
                    )}
                  </p>
                  <p>
                    <strong>やさしい理由：</strong>
                    {advice.reason}
                  </p>
                  <p>
                    <strong>注意点：</strong>
                    {advice.caution}
                  </p>
                  <details>
                    <summary>比べている基準</summary>
                    新しい政策を加えず、現在の政策だけを続けた場合との差です。
                  </details>
                </article>
              );
            })}
            {dissentingExpert &&
              (() => {
                const dissent = advisor.advise(dissentingExpert, adviceContext);
                return (
                  <aside
                    className="expert-dissent"
                    style={
                      {
                        "--expert-color": dissentingExpert.colorToken,
                      } as CSSProperties
                    }
                  >
                    <header className="expert-identity" data-page-title>
                      <ExpertPortrait expertId={dissentingExpert.id} />
                      <div className="expert-identity-copy">
                        <strong>
                          別の視点：{" "}
                          {dissentingExpert.displayName ?? dissentingExpert.role}
                        </strong>
                        <p className="quiet">
                          {dissentingExpert.role} · 口調：{dissentingExpert.tone}
                        </p>
                      </div>
                    </header>
                    <p>
                      {adviceExplanation(
                        dissent.conclusion,
                        dissentingExpert.priorityIndicators ??
                          Object.keys(adviceContext.effects),
                      )}{" "}
                      {dissent.caution}
                    </p>
                  </aside>
                );
              })()}
          </section>
        </>
      ),
    },
  ];
  return (
    <PageDeck
      key={reviewKey}
      label="政策の見通し"
      categories={categories}
      actions={
        <>
          {onBack && (
            <button onClick={onBack} disabled={busy}>
              案を修正する
            </button>
          )}
          <button
            className="primary"
            disabled={busy || !reviewed || insufficient}
            onClick={() => {
              if (reviewed && !busy && !insufficient) onConfirm();
            }}
          >
            {busy ? "政策を保存しています…" : "政策を確定する"}
          </button>
          {!reviewed && (
            <small className="action-warning">
              先に費用・副作用・警告を確認してください。
            </small>
          )}
        </>
      }
    />
  );
}
