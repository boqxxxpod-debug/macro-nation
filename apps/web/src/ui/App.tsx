import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import {
  Home,
  PolicyForm,
  Preview,
  Report,
  type PolicyFormDraftState,
} from "./GameViews";
import { PageDeck } from "./PageDeck";
import { Ending } from "./Ending";
import { NationView } from "./NationView";
import { migrateFirstPlayableSave } from "../application/save-migration";
import { label, period } from "./game-format";

type Route = "home" | "policies" | "preview" | "report" | "ending" | "nation";
const NAV_LABELS = {
  home: "ホーム",
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
  if (path.endsWith("/nation")) return "nation";
  return "home";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [largeText, setLargeText] = useState(false);
  useLayoutEffect(() => {
    const refresh = () => {
      setLargeText(
        Number.parseFloat(
          getComputedStyle(document.documentElement).fontSize,
        ) >= 24 || (window.visualViewport?.scale ?? 1) >= 1.5,
      );
      const height = window.visualViewport?.height ?? window.innerHeight;
      if (
        document.documentElement.style.getPropertyValue("--viewport-height") !==
        `${height}px`
      )
        document.documentElement.style.setProperty(
          "--viewport-height",
          `${height}px`,
        );
    };
    refresh();
    window.addEventListener("resize", refresh);
    window.visualViewport?.addEventListener("resize", refresh);
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    // Font settings and stylesheet updates also change rem sizes without
    // changing html attributes or the viewport. Observe that layout directly.
    const fontProbe = document.createElement("span");
    fontProbe.setAttribute("aria-hidden", "true");
    Object.assign(fontProbe.style, {
      position: "fixed",
      width: "1rem",
      height: "1rem",
      left: "0",
      top: "0",
      visibility: "hidden",
      pointerEvents: "none",
      contain: "strict",
    });
    document.body.append(fontProbe);
    const fontObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(refresh);
    fontObserver?.observe(fontProbe);
    return () => {
      observer.disconnect();
      fontObserver?.disconnect();
      fontProbe.remove();
      window.removeEventListener("resize", refresh);
      window.visualViewport?.removeEventListener("resize", refresh);
    };
  }, []);
  const [messageOpen, setMessageOpen] = useState(false);
  const [policyDraft, setPolicyDraft] = useState<PolicyFormDraftState>();
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
          const first = loaded.find((item) => item.saved)?.saved ?? null;
          setState(first);
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
    const pop = () => {
      setMenuOpen(false);
      setMessageOpen(false);
      previewClient.current?.cancel();
      setRoute(routeFromLocation());
      setError("");
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    if (!loading && state)
      document.querySelector<HTMLElement>(".game-view h2")?.focus();
  }, [route, loading, state]);
  useEffect(() => () => previewClient.current?.cancel(), []);
  useEffect(() => {
    if (!menuOpen) return;
    document.querySelector<HTMLElement>(".game-view .page-content")?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        requestAnimationFrame(() =>
          document.querySelector<HTMLElement>(".shell-menu")?.focus(),
        );
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [menuOpen]);
  useEffect(() => {
    if (messageOpen)
      document
        .querySelector<HTMLElement>(".message-overlay .page-content")
        ?.focus();
  }, [messageOpen]);
  useEffect(() => {
    if (!messageOpen) return;
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMessageOpen(false);
        document.querySelector<HTMLElement>(".shell-message")?.focus();
      }
      if (event.key !== "Tab") return;
      const controls = [
        ...document.querySelectorAll<HTMLElement>(
          ".message-overlay button:not(:disabled), .message-overlay [tabindex='0']",
        ),
      ].filter((node) => !node.closest("[hidden]"));
      const first = controls[0],
        last = controls.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !controls.includes(document.activeElement as HTMLElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [messageOpen]);

  function navigate(next: Route, replace = false) {
    setMenuOpen(false);
    setMessageOpen(false);
    const base = import.meta.env.BASE_URL;
    const suffix =
      next === "home"
        ? "game/1"
        : next === "policies"
          ? "game/1/policies"
          : next === "preview"
            ? "game/1/policies/preview"
            : next === "report"
              ? "game/1/report"
              : next === "nation"
                ? "game/1/nation"
                : "game/1/ending";
    window.history[replace ? "replaceState" : "pushState"](
      {},
      "",
      `${base}${suffix}`,
    );
    setRoute(next);
    setError("");
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
    setPolicyDraft(undefined);
    setSlots((current) => new Map(current).set(slotId, created));
    navigate("home");
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
    setPolicyDraft(undefined);
    navigate("home", true);
  }

  return (
    <main
      className={`app-shell viewport-shell${largeText ? " enlarged-text" : ""}${state ? " game-shell" : " launch-shell"}${route === "nation" && state ? " app-shell-nation" : ""}`}
    >
      <header className="hero">
        <p className="eyebrow">国家運営シミュレーション</p>
        <h1>MACRO NATION</h1>
        <p className="lead">
          政策の時間差とトレードオフを、数字と理由から読み解く。
        </p>
        {(error || notice) && (
          <button
            className="shell-message"
            aria-label={error ? "エラーの詳細" : "通知の詳細"}
            onClick={() => setMessageOpen(true)}
          >
            {error ? "エラー" : "通知"}
          </button>
        )}
        {state && (
          <button
            className="shell-menu"
            aria-expanded={menuOpen}
            onClick={() => {
              setMenuOpen((open) => !open);
              setMessageOpen(false);
            }}
          >
            メニュー
          </button>
        )}
      </header>
      {loading ? (
        <p role="status">保存データを読み込み中…</p>
      ) : !state ? (
        <section className="welcome" aria-labelledby="start-heading">
          <h2 id="start-heading" tabIndex={-1}>
            起動・保存スロット
          </h2>
          <PageDeck
            label="起動・開始設定"
            actions={
              <button
                className="primary"
                disabled={busy || !repository}
                onClick={() => void action(start)}
              >
                ゲームを始める
              </button>
            }
          >
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
                        (left, right) =>
                          right[1].monthIndex - left[1].monthIndex,
                      )
                      .map(([id, saved]) => (
                        <li key={id}>
                          <strong>スロット{id}</strong>：{durationLabel(saved)}
                          、{saved.monthIndex}か月まで進行、
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
                          navigate("home");
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

              {!repository && (
                <p role="alert">端末の保存機能を利用できません。</p>
              )}
            </section>
          </PageDeck>
        </section>
      ) : (
        <>
          <nav className="nav" aria-label="ゲーム画面">
            {(["home", "policies", "report", "nation"] as const).map((id) => (
              <button
                key={id}
                type="button"
                aria-label={NAV_LABELS[id]}
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
              {period(state)}・第{Math.floor(state.monthIndex / 3) + 1}四半期・
              {state.runState === "crisisStopped"
                ? "危機停止"
                : state.runState === "awaitingEvent"
                  ? "イベント対応待ち"
                  : state.runState === "completed"
                    ? "期間満了"
                    : state.runState === "failed"
                      ? "運営終了"
                      : busy
                        ? "計算中"
                        : "運営中"}
            </p>
            {menuOpen ? (
              <PageDeck
                label="画面メニュー"
                actions={
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      requestAnimationFrame(() =>
                        document
                          .querySelector<HTMLElement>(".shell-menu")
                          ?.focus(),
                      );
                    }}
                  >
                    閉じる
                  </button>
                }
              >
                <h2 tabIndex={-1}>画面メニュー</h2>
                <button
                  onClick={() => {
                    setState(null);
                    setPolicyDraft(undefined);
                    setMenuOpen(false);
                  }}
                >
                  保存スロット
                </button>
                {import.meta.env.DEV && <AIPreview />}
                {Object.entries(NAV_LABELS).map(([id, text]) => (
                  <button key={id} onClick={() => navigate(id as Route)}>
                    {text}
                  </button>
                ))}
              </PageDeck>
            ) : (
              <>
                {route === "home" && (
                  <>
                    <h2 tabIndex={-1}>国家ホーム</h2>
                    <Home
                      state={state}
                      onOpenReport={() => navigate("report")}
                      onOpenPolicies={() => navigate("policies")}
                      response={
                        state.runState === "crisisStopped" ||
                        state.runState === "awaitingEvent" ||
                        state.runState === "completed" ||
                        state.runState === "failed" ? (
                          <>
                            {state.runState === "crisisStopped" && (
                              <section className="panel crisis">
                                <h3>緊急会議</h3>
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
                                    })
                                  }
                                >
                                  危機対応を確認して再開
                                </button>
                              </section>
                            )}
                            {state.runState === "awaitingEvent" && (
                              <section
                                className="panel crisis"
                                aria-labelledby="event-heading"
                              >
                                <h3 id="event-heading">
                                  突発イベント：対応を選択
                                </h3>
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
                                          setNotice(
                                            "イベント対応を保存しました。",
                                          );
                                        })
                                      }
                                    >
                                      {text}
                                    </button>
                                  ))}
                                </div>
                              </section>
                            )}
                            {(state.runState === "completed" ||
                              state.runState === "failed") && (
                              <section className="panel">
                                <h3>運営の終了</h3>
                                <button
                                  className="primary"
                                  onClick={() => navigate("ending")}
                                >
                                  終了評価を見る
                                </button>
                              </section>
                            )}
                          </>
                        ) : undefined
                      }
                    />
                    <div className="actions home-actions">
                      <button
                        className="primary"
                        disabled={
                          busy ||
                          state.runState === "crisisStopped" ||
                          state.runState === "awaitingEvent" ||
                          state.runState === "completed" ||
                          state.runState === "failed"
                        }
                        onClick={() =>
                          void action(async () => {
                            const saved = await advanceMonth(
                              repository!,
                              state.slotId,
                            );
                            setState(saved);
                            setNotice(
                              `${period(saved)}まで進み、保存しました。`,
                            );
                            if (
                              saved.runState === "completed" ||
                              saved.runState === "failed"
                            )
                              navigate("ending");
                          })
                        }
                      >
                        1か月進める
                      </button>
                      <button onClick={() => navigate("policies")}>
                        政策を考える
                      </button>
                      <button onClick={() => navigate("report")}>
                        理由を見る
                      </button>
                      <button onClick={() => navigate("nation")}>
                        国家の景観を見る
                      </button>
                    </div>
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
                    <PolicyForm
                      state={state}
                      {...(policyDraft ? { draftState: policyDraft } : {})}
                      onDraftChange={setPolicyDraft}
                      extra={
                        <>
                          <section className="panel">
                            <h3>実施中・予約中</h3>
                            {[
                              ...state.policies.active,
                              ...state.policies.reserved,
                            ].length ? (
                              <ul>
                                {[
                                  ...state.policies.active,
                                  ...state.policies.reserved,
                                ].map((policy) => (
                                  <li key={policy.policyId}>
                                    {policy.policyId}：
                                    {policy.status === "active"
                                      ? "実施中"
                                      : "予約中"}
                                    、{policy.activationMonth + 1}月目開始
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p>政策はまだありません。</p>
                            )}
                          </section>
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
                      }
                      busy={busy}
                      onPreview={(draft, expertIds) =>
                        void action(() => previewDraft(draft, expertIds))
                      }
                    />
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
                      onBack={() => navigate("policies")}
                    />
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
                    <NationView
                      state={state}
                      onReport={() => navigate("report")}
                    />
                  </>
                )}
                {route === "ending" && (
                  <>
                    <h2 tabIndex={-1}>終了評価</h2>
                    {state.runState === "completed" ||
                    state.runState === "failed" ? (
                      <Ending
                        state={state}
                        onReport={() => navigate("report")}
                      />
                    ) : (
                      <p>
                        {state.clock.endMonth}か月の終了後に評価を表示します。
                      </p>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}
      {busy && (
        <p role="status" className="sr-only">
          計算・保存中…
        </p>
      )}
      {notice && (
        <p role="status" className="sr-only">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="sr-only">
          {error}
        </p>
      )}
      {messageOpen && (
        <div
          className="message-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="通知の詳細"
        >
          <PageDeck
            label="通知の詳細"
            actions={
              <button
                onClick={() => {
                  setMessageOpen(false);
                  document
                    .querySelector<HTMLElement>(".shell-message")
                    ?.focus();
                }}
              >
                詳細を閉じる
              </button>
            }
          >
            <h2 tabIndex={-1}>通知の詳細</h2>
            <p>{error || notice}</p>
          </PageDeck>
        </div>
      )}
    </main>
  );
}
