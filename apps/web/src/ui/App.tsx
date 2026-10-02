import { useEffect, useMemo, useRef, useState } from "react";
import type { DurationMode, GameState } from "@macro-nation/domain";
import {
  policyMeetingStatus,
  policyDraftHash,
  policyRules,
  policyStateHash,
  type PolicyDraft,
  type PreviewOutput,
} from "../application/policy-view";
import {
  advanceMonth,
  browserGameRepository,
  confirmPolicy,
  createGame,
  resolveEvent,
  resumeCrisis,
  type GameRepository,
} from "../application/game-service";
import { PreviewClient } from "../infrastructure/preview-client";
import { AIPreview } from "../devtools/AIPreview";
import { Home, PolicyForm, Preview, Report } from "./GameViews";
import { Ending } from "./Ending";
import { NationView } from "./NationView";
import { NationMenu } from "./NationMenu";
import { migrateFirstPlayableSave } from "../application/save-migration";
import { label, period } from "./game-format";

type Route =
  | "home"
  | "policies"
  | "preview"
  | "report"
  | "ending"
  | "nation"
  | "events"
  | "crisis";
const NAV_LABELS = {
  home: "経済指標",
  policies: "政策会議",
  report: "レポート",
  nation: "国家ビュー",
  ending: "終了評価",
} as const;
const SLOT_IDS = [1, 2, 3] as const;
const DURATIONS: readonly {
  id: Exclude<DurationMode, "custom">;
  years: number;
  months: number;
  time: string;
  focus: string;
}[] = [
  {
    id: "short",
    years: 4,
    months: 48,
    time: "約20〜30分",
    focus: "政策の基本と時間差",
  },
  {
    id: "standard",
    years: 8,
    months: 96,
    time: "約40〜60分",
    focus: "景気循環と副作用",
  },
  {
    id: "long",
    years: 20,
    months: 240,
    time: "約2〜3時間",
    focus: "構造変化と財政の持続性",
  },
  {
    id: "ultraLong",
    years: 30,
    months: 360,
    time: "約3〜4時間",
    focus: "世代をまたぐ長期運営",
  },
];
function durationLabel(state: GameState): string {
  const selected = DURATIONS.find((item) => item.id === state.durationMode);
  return selected
    ? `${selected.years}年・${selected.months}か月`
    : "期間未設定";
}
function routeFromLocation(): Route {
  const path = window.location.pathname;
  if (path.endsWith("/policies/preview")) return "preview";
  if (path.endsWith("/policies")) return "policies";
  if (path.endsWith("/report")) return "report";
  if (path.endsWith("/ending")) return "ending";
  if (path.endsWith("/indicators")) return "home";
  if (path.endsWith("/events")) return "events";
  if (path.endsWith("/crisis")) return "crisis";
  return "nation";
}
function slotFromLocation(): GameState["slotId"] | null {
  const match = window.location.pathname.match(/\/game\/([1-3])(?:\/|$)/);
  return match ? (Number(match[1]) as GameState["slotId"]) : null;
}

export function App({
  repository: suppliedRepository,
  seedFactory = () => crypto.randomUUID(),
}: {
  repository?: GameRepository;
  seedFactory?: () => string;
}) {
  const repository = useMemo<GameRepository | null>(
    () => suppliedRepository ?? browserGameRepository(),
    [suppliedRepository],
  );
  const previewClient = useRef<PreviewClient | null>(null);
  const inFlight = useRef(false);
  const confirmationId = useRef<string | null>(null);
  const startCommandId = useRef(crypto.randomUUID());
  if (!previewClient.current) previewClient.current = new PreviewClient();
  const [state, setState] = useState<GameState | null>(null);
  const [route, setRoute] = useState<Route>(routeFromLocation);
  const [preview, setPreview] = useState<PreviewOutput | null>(null);
  const [comparisons, setComparisons] = useState<readonly PreviewOutput[]>([]);
  const [counterfactuals, setCounterfactuals] = useState<
    readonly PreviewOutput[]
  >([]);
  const [previewExpertIds, setPreviewExpertIds] = useState<readonly string[]>([
    "macro",
  ]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [startSeed, setStartSeed] = useState("");
  const [learningMode, setLearningMode] =
    useState<NonNullable<GameState["learningMode"]>>("learning");
  const [durationMode, setDurationMode] =
    useState<Exclude<DurationMode, "custom">>("short");
  const [difficulty, setDifficulty] =
    useState<GameState["difficulty"]>("intro");
  const [slotId, setSlotId] = useState<GameState["slotId"]>(1);
  const [slots, setSlots] = useState<ReadonlyMap<number, GameState>>(new Map());
  const [launchPanel, setLaunchPanel] = useState<"history" | "help" | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    if (!repository) {
      setLoading(false);
      return;
    }
    void Promise.all(
      SLOT_IDS.map(async (id) => {
        const result = repository.loadSlot
          ? await repository.loadSlot(id)
          : { state: await repository.load(id), recovered: false };
        const saved = result.state
          ? await migrateFirstPlayableSave(repository, result.state)
          : null;
        return {
          id,
          saved,
          recovered: result.recovered,
          reason: result.reason,
        };
      }),
    )
      .then((loaded) => {
        if (active) {
          const available = new Map<number, GameState>();
          for (const item of loaded)
            if (item.saved) available.set(item.id, item.saved);
          setSlots(available);
          const requestedSlot = slotFromLocation();
          const first = requestedSlot
            ? (available.get(requestedSlot) ?? null)
            : (loaded.find((item) => item.saved)?.saved ?? null);
          setState(first);
          if (first && routeFromLocation() === "nation")
            window.history.replaceState(
              {},
              "",
              `${import.meta.env.BASE_URL}game/${first.slotId}/nation`,
            );
          if (requestedSlot) setSlotId(requestedSlot);
          const recovery = loaded.find((item) => item.recovered);
          if (recovery?.reason) setNotice(recovery.reason);
          const corrupt = loaded.find((item) => !item.saved && item.reason);
          if (corrupt?.reason)
            setError(`スロット${corrupt.id}: ${corrupt.reason}`);
          setLoading(false);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "保存を読み込めませんでした",
          );
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [repository]);
  useEffect(() => {
    if (state) setSlots((current) => new Map(current).set(state.slotId, state));
  }, [state]);
  useEffect(() => {
    const pop = () => {
      previewClient.current?.cancel();
      const requestedSlot = slotFromLocation();
      setState((current) =>
        requestedSlot
          ? current?.slotId === requestedSlot
            ? current
            : (slots.get(requestedSlot) ?? null)
          : null,
      );
      setRoute(routeFromLocation());
      setError("");
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [slots]);
  useEffect(() => {
    if (!loading && state)
      document.querySelector<HTMLElement>(".game-view h2")?.focus();
  }, [route, loading, state]);
  useEffect(() => () => previewClient.current?.cancel(), []);

  function navigate(
    next: Route,
    replace = false,
    targetSlot = state?.slotId ?? slotId,
  ) {
    const base = import.meta.env.BASE_URL;
    const suffix = `game/${targetSlot}/${
      next === "home"
        ? "indicators"
        : next === "preview"
          ? "policies/preview"
          : next
    }`;
    window.history[replace ? "replaceState" : "pushState"](
      {},
      "",
      `${base}${suffix}`,
    );
    setRoute(next);
    setError("");
  }
  function openSlots() {
    window.history.pushState({}, "", import.meta.env.BASE_URL);
    setState(null);
  }
  async function action(work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "処理に失敗しました");
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  async function start() {
    if (!repository) throw new Error("この端末では保存機能を利用できません");
    const created = await createGame(
      repository,
      startSeed.trim() || seedFactory(),
      slotId,
      learningMode,
      durationMode,
      difficulty,
      startCommandId.current,
    );
    setState(created);
    setSlots((current) => new Map(current).set(slotId, created));
    navigate("nation", false, created.slotId);
    setNotice("ゲームを開始し、端末に保存しました。");
  }
  async function previewDraft(
    draft: PolicyDraft,
    expertIds: readonly string[],
  ) {
    if (!state) return;
    const shockPairingId = `ui05:${policyStateHash(state)}`;
    const result = await previewClient.current!.request({
      state,
      draft,
      horizonMonths: 60,
      shockPairingId,
    });
    const noPolicy = await previewClient.current!.request({
      state,
      draft: null,
      horizonMonths: 60,
      shockPairingId,
    });
    const alternateRule = policyRules(state.configSnapshot).find(
      (rule) => rule.policyId !== draft.ruleId,
    );
    const alternate = alternateRule
      ? await previewClient
          .current!.request({
            state,
            draft: {
              status: "draft",
              policyId: `alternative-${draft.policyId}`,
              ruleId: alternateRule.policyId,
              value:
                alternateRule.inputs?.[0]?.defaultValue ??
                alternateRule.referenceValue ??
                alternateRule.inputs?.[0]?.min ??
                alternateRule.inputMin ??
                0,
              quartersAhead: draft.quartersAhead,
            },
            horizonMonths: 60,
            shockPairingId,
          })
          .catch((cause: unknown) => {
            if (
              cause instanceof Error &&
              cause.message.startsWith("Insufficient available ")
            )
              return null;
            throw cause;
          })
      : null;
    setPreview(result);
    setCounterfactuals([noPolicy, ...(alternate ? [alternate] : [])]);
    setPreviewExpertIds(expertIds);
    confirmationId.current = crypto.randomUUID();
    setComparisons((items) =>
      [
        ...items.filter((item) => item.draftHash !== result.draftHash),
        result,
      ].slice(-3),
    );
    navigate("preview");
  }
  async function confirm() {
    if (!repository || !state || !preview?.previewedDraft) return;
    if (
      preview.stateHash !== policyStateHash(state) ||
      preview.draftHash !== policyDraftHash(preview.previewedDraft)
    )
      throw new Error("ゲーム状態が変わりました。再試算してください");
    const saved = await confirmPolicy(
      repository,
      state.slotId,
      {
        kind: "commit",
        commandId: confirmationId.current ?? crypto.randomUUID(),
        expectedStateHash: preview.stateHash,
        draft: preview.previewedDraft,
        selectedExpertIds: previewExpertIds,
      },
      {
        expertIds: previewExpertIds,
        confidence: preview.indicators
          .filter((item) =>
            ["realGdp", "inflation", "unemployment"].includes(item.indicatorId),
          )
          .every(
            ({ month12 }) =>
              (month12.deltaLow > 0 && month12.deltaHigh > 0) ||
              (month12.deltaLow < 0 && month12.deltaHigh < 0),
          )
          ? "high"
          : "medium",
        uncertainty: preview.uncertainty.note,
        summaries: preview.summaries,
      },
    );
    setState(saved);
    setPreview(null);
    confirmationId.current = null;
    setNotice("政策を確定し、端末に保存しました。");
    navigate("nation", true);
  }

  return (
    <main
      className={
        route === "nation" && state ? "app-shell app-shell-nation" : "app-shell"
      }
    >
      <header className="hero">
        <p className="eyebrow">国家運営シミュレーション</p>
        <h1>MACRO NATION</h1>
        <p className="lead">
          政策の時間差とトレードオフを、数字と理由から読み解く。
        </p>
      </header>
      {loading ? (
        <p role="status">保存データを読み込み中…</p>
      ) : !state ? (
        <section className="welcome" aria-labelledby="start-heading">
          <h2 id="start-heading">起動・保存スロット</h2>
          <p>
            架空国家の政策を選び、数字と理由から変化を確かめます。ゲームはこの端末だけに自動保存されます。
          </p>
          <div className="launch-actions" aria-label="起動メニュー">
            <button
              type="button"
              aria-expanded={launchPanel === "history"}
              aria-controls="save-history"
              onClick={() =>
                setLaunchPanel((current) =>
                  current === "history" ? null : "history",
                )
              }
            >
              保存履歴
            </button>
            <button
              type="button"
              aria-expanded={launchPanel === "help"}
              aria-controls="launch-help"
              onClick={() =>
                setLaunchPanel((current) =>
                  current === "help" ? null : "help",
                )
              }
            >
              遊び方・設定
            </button>
          </div>
          {launchPanel === "history" && (
            <section
              id="save-history"
              className="panel launch-panel"
              aria-labelledby="save-history-heading"
            >
              <h3 id="save-history-heading">保存履歴</h3>
              {slots.size === 0 ? (
                <p>保存された国家運営はまだありません。</p>
              ) : (
                <ol>
                  {[...slots.entries()]
                    .sort(
                      (left, right) => right[1].monthIndex - left[1].monthIndex,
                    )
                    .map(([id, saved]) => (
                      <li key={id}>
                        <strong>スロット{id}</strong>：{durationLabel(saved)}、
                        {saved.monthIndex}か月まで進行、
                        {saved.runState === "completed"
                          ? "期間満了"
                          : saved.runState === "failed"
                            ? "運営失敗"
                            : "運営中"}
                      </li>
                    ))}
                </ol>
              )}
              <p className="quiet">
                終了済みゲームの評価・国家史（最大10件）はUI11国家史で扱う後続機能です。ここでは保存スロットの進行履歴を表示します。
              </p>
            </section>
          )}
          {launchPanel === "help" && (
            <section
              id="launch-help"
              className="panel launch-panel"
              aria-labelledby="launch-help-heading"
            >
              <h3 id="launch-help-heading">遊び方・端末設定</h3>
              <ul>
                <li>新規開始では期間、難易度、説明量、seedを選びます。</li>
                <li>進行中の設定と期間は開始後に変更できません。</li>
                <li>
                  保存はこの端末内だけで行い、ログインや通信を必要としません。
                </li>
              </ul>
            </section>
          )}
          <div className="slot-grid" aria-label="保存スロット">
            {SLOT_IDS.map((id) => {
              const saved = slots.get(id);
              return (
                <article className="panel" key={id}>
                  <h3>スロット{id}</h3>
                  <p>
                    {saved
                      ? `${saved.monthIndex}か月目・${durationLabel(saved)}・${saved.difficulty}・${saved.learningMode}`
                      : "空き"}
                  </p>
                  {saved ? (
                    <button
                      onClick={() => {
                        setState(saved);
                        navigate("nation", false, saved.slotId);
                      }}
                    >
                      スロット{id}の続きから
                    </button>
                  ) : (
                    <button
                      aria-pressed={slotId === id}
                      onClick={() => setSlotId(id)}
                    >
                      スロット{id}で新しく始める
                    </button>
                  )}
                </article>
              );
            })}
          </div>
          <section
            className="panel start-options"
            aria-labelledby="scenario-heading"
          >
            <h3 id="scenario-heading">新しいゲームの設定</h3>
            <label>
              シナリオ
              <select defaultValue="SCN-01">
                <option value="SCN-01">SCN-01 小さな開放経済</option>
              </select>
            </label>
            <label>
              難易度
              <select
                value={difficulty}
                onChange={(event) =>
                  setDifficulty(event.target.value as GameState["difficulty"])
                }
              >
                <option value="intro">入門（手厚い説明）</option>
                <option value="standard">標準（要点を説明）</option>
                <option value="expert">専門（最小限の説明）</option>
              </select>
            </label>
            <fieldset>
              <legend>期間</legend>
              <div className="duration-grid">
                {DURATIONS.map((duration) => (
                  <label className="duration-card" key={duration.id}>
                    <input
                      type="radio"
                      name="duration"
                      value={duration.id}
                      checked={durationMode === duration.id}
                      onChange={() => setDurationMode(duration.id)}
                    />
                    <strong>
                      {duration.years}年（{duration.months}か月）
                    </strong>
                    <span>想定時間: {duration.time}</span>
                    <span>学べる論点: {duration.focus}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label>
              説明モード
              <select
                value={learningMode}
                onChange={(event) =>
                  setLearningMode(
                    event.target.value as NonNullable<
                      GameState["learningMode"]
                    >,
                  )
                }
              >
                <option value="casual">カジュアル（結論を中心に表示）</option>
                <option value="standard">標準（理由を短く表示）</option>
                <option value="learning">学習（用語と理論も表示）</option>
              </select>
            </label>
            <label>
              再現用seed（任意）
              <input
                value={startSeed}
                maxLength={80}
                placeholder="未入力なら自動生成"
                onChange={(event) => setStartSeed(event.target.value)}
              />
            </label>
            <button
              className="primary"
              disabled={busy || !repository}
              onClick={() => void action(start)}
            >
              ゲームを始める
            </button>
            {!repository && (
              <p role="alert">端末の保存機能を利用できません。</p>
            )}
          </section>
        </section>
      ) : (
        <>
          <nav className="nav" aria-label="ゲーム画面">
            {(["nation", "policies", "home", "report"] as const).map((id) => (
              <button
                key={id}
                type="button"
                aria-label={
                  id === "nation" && route !== "nation"
                    ? "国家ビューに戻る"
                    : NAV_LABELS[id]
                }
                aria-current={
                  route === id || (id === "policies" && route === "preview")
                    ? "page"
                    : undefined
                }
                onClick={() => navigate(id)}
              >
                {NAV_LABELS[id]}
              </button>
            ))}
          </nav>
          <div className="game-view">
            <p
              className={
                route === "nation" ? "eyebrow nation-shell-context" : "eyebrow"
              }
            >
              SCN-01・{period(state)}・第{Math.floor(state.monthIndex / 3) + 1}
              四半期
            </p>
            {route === "home" && (
              <>
                <h2 tabIndex={-1}>経済指標</h2>
                <Home
                  state={state}
                  onOpenReport={() => navigate("report")}
                  onOpenPolicies={() => navigate("policies")}
                />
              </>
            )}
            {route === "crisis" && (
              <>
                <h2 tabIndex={-1}>緊急会議</h2>
                {state.runState === "crisisStopped" ? (
                  <section className="panel crisis">
                    <p>
                      危機条件に達したため進行を停止しました。政策会議で対策を検討し、明示的に再開してください。次の月も危機が続くと失敗になります。
                    </p>
                    <button onClick={() => navigate("policies")}>
                      緊急政策を検討する
                    </button>{" "}
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          const resumed = await resumeCrisis(
                            repository!,
                            state.slotId,
                          );
                          setState(resumed);
                          setNotice(
                            "危機対応を保存し、再開できる状態になりました。",
                          );
                          navigate("nation");
                        })
                      }
                    >
                      危機対応を確認して再開
                    </button>
                  </section>
                ) : (
                  <p>いまは緊急対応が必要な危機はありません。</p>
                )}
              </>
            )}
            {route === "events" && (
              <>
                <h2 tabIndex={-1}>イベント対応</h2>
                {state.runState === "awaitingEvent" ? (
                  <section
                    className="panel crisis"
                    aria-labelledby="event-heading"
                  >
                    <h3 id="event-heading">突発イベント：対応を選択</h3>
                    <p>
                      {state.events.pendingChoiceEventId}{" "}
                      が発生しました。準備度による軽減はすでに基準被害と分けて記録されています。
                    </p>
                    <div className="actions">
                      {(
                        [
                          ["protect-households", "家計を優先"],
                          ["protect-businesses", "企業を優先"],
                          ["balanced", "均衡対応"],
                        ] as const
                      ).map(([choiceId, text]) => (
                        <button
                          key={choiceId}
                          disabled={busy}
                          onClick={() =>
                            void action(async () => {
                              const resolved = await resolveEvent(
                                repository!,
                                state.slotId,
                                choiceId,
                              );
                              setState(resolved);
                              setNotice("イベント対応を保存しました。");
                              navigate("nation");
                            })
                          }
                        >
                          {text}
                        </button>
                      ))}
                    </div>
                  </section>
                ) : (
                  <p>いまは対応を選ぶ必要のあるイベントはありません。</p>
                )}
              </>
            )}
            {route === "policies" && (
              <>
                <h2 tabIndex={-1}>政策会議</h2>
                <p className="meeting">
                  残り {policyMeetingStatus(state).slotsRemaining} /
                  3枠。次の更新は
                  {policyMeetingStatus(state).nextPolicyMonth + 1}月目。
                </p>
                <section className="panel">
                  <h3>実施中・予約中</h3>
                  {[...state.policies.active, ...state.policies.reserved]
                    .length ? (
                    <ul>
                      {[
                        ...state.policies.active,
                        ...state.policies.reserved,
                      ].map((policy) => (
                        <li key={policy.policyId}>
                          {policy.policyId}：
                          {policy.status === "active" ? "実施中" : "予約中"}、
                          {policy.activationMonth + 1}月目開始
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>政策はまだありません。</p>
                  )}
                </section>
                <PolicyForm
                  state={state}
                  busy={busy}
                  onPreview={(draft, expertIds) =>
                    void action(() => previewDraft(draft, expertIds))
                  }
                />
                {comparisons.length > 0 && (
                  <section className="panel">
                    <h3>比較した案（最大3件）</h3>
                    <ul>
                      {comparisons.map((item) => (
                        <li key={item.draftHash}>
                          {label(item.previewedDraft?.ruleId ?? "")}
                          ：12か月後の成長差{" "}
                          {item.indicators
                            .find(
                              (indicator) =>
                                indicator.indicatorId === "realGdp",
                            )
                            ?.month12.deltaBase.toFixed(2)}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
            {route === "preview" && (
              <>
                <h2 tabIndex={-1}>政策プレビュー</h2>
                <Preview
                  output={preview}
                  counterfactuals={counterfactuals}
                  expertIds={previewExpertIds}
                  contentVersion={state.versions.contentVersion}
                  busy={busy}
                  onConfirm={() => void action(confirm)}
                />
                <button onClick={() => navigate("policies")}>
                  政策会議へ戻る
                </button>
              </>
            )}
            {route === "report" && (
              <>
                <h2 tabIndex={-1}>経済レポート</h2>
                <Report state={state} />
              </>
            )}
            {route === "nation" && (
              <>
                <h2 tabIndex={-1} className="nation-page-heading">
                  国家ビュー
                </h2>
                <NationView state={state} onReport={() => navigate("report")}>
                  <NationMenu
                    state={state}
                    busy={busy}
                    onPolicies={() => navigate("policies")}
                    onIndicators={() => navigate("home")}
                    onReport={() => navigate("report")}
                    onSlots={openSlots}
                    onCrisis={() => navigate("crisis")}
                    onEvents={() => navigate("events")}
                    onEnding={() => navigate("ending")}
                    onAdvance={() =>
                      void action(async () => {
                        const saved = await advanceMonth(
                          repository!,
                          state.slotId,
                        );
                        setState(saved);
                        setNotice(`${period(saved)}まで進み、保存しました。`);
                        if (
                          saved.runState === "completed" ||
                          saved.runState === "failed"
                        )
                          navigate("ending");
                      })
                    }
                  />
                </NationView>
              </>
            )}
            {route === "ending" && (
              <>
                <h2 tabIndex={-1}>終了評価</h2>
                {state.runState === "completed" ||
                state.runState === "failed" ? (
                  <Ending state={state} onReport={() => navigate("report")} />
                ) : (
                  <p>{state.clock.endMonth}か月の終了後に評価を表示します。</p>
                )}
              </>
            )}
          </div>
        </>
      )}
      {busy && <p role="status">計算・保存中…</p>}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {import.meta.env.DEV && <AIPreview />}
    </main>
  );
}
