import { useEffect, useMemo, useRef, useState } from "react";
import type { GameState } from "@macro-nation/domain";
import {
  policyMeetingStatus,
  policyStateHash,
  type PolicyDraft,
  type PreviewOutput,
} from "../application/policy-view";
import {
  advanceMonth,
  browserGameRepository,
  confirmPolicy,
  createGame,
  type GameRepository,
} from "../application/game-service";
import { PreviewClient } from "../infrastructure/preview-client";
import { AIPreview } from "../devtools/AIPreview";
import { Home, PolicyForm, Preview, Report } from "./GameViews";
import { label, period } from "./game-format";

type Route = "home" | "policies" | "preview" | "report";
function routeFromLocation(): Route {
  const path = window.location.pathname;
  if (path.endsWith("/policies/preview")) return "preview";
  if (path.endsWith("/policies")) return "policies";
  if (path.endsWith("/report")) return "report";
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
  if (!previewClient.current) previewClient.current = new PreviewClient();
  const [state, setState] = useState<GameState | null>(null);
  const [route, setRoute] = useState<Route>(routeFromLocation);
  const [preview, setPreview] = useState<PreviewOutput | null>(null);
  const [comparisons, setComparisons] = useState<readonly PreviewOutput[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    if (!repository) {
      setLoading(false);
      return;
    }
    void repository
      .load(1)
      .then((saved) => {
        if (active) {
          setState(saved);
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

  function navigate(next: Route, replace = false) {
    const base = import.meta.env.BASE_URL;
    const suffix =
      next === "home"
        ? "game/1"
        : next === "policies"
          ? "game/1/policies"
          : next === "preview"
            ? "game/1/policies/preview"
            : "game/1/report";
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
    const created = await createGame(repository, seedFactory());
    setState(created);
    navigate("home");
  }
  async function previewDraft(draft: PolicyDraft) {
    if (!state) return;
    const result = await previewClient.current!.request({
      state,
      draft,
      horizonMonths: 60,
    });
    setPreview(result);
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
    if (preview.stateHash !== policyStateHash(state))
      throw new Error("ゲーム状態が変わりました。再試算してください");
    const saved = await confirmPolicy(repository, state.slotId, {
      kind: "commit",
      commandId: confirmationId.current ?? crypto.randomUUID(),
      expectedStateHash: preview.stateHash,
      draft: preview.previewedDraft,
    });
    setState(saved);
    setPreview(null);
    confirmationId.current = null;
    setNotice("政策を確定し、端末に保存しました。");
    navigate("home", true);
  }

  return (
    <main className="app-shell">
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
        <section className="panel welcome">
          <h2>SCN-01 小さな開放経済</h2>
          <p>
            政策を選び、1か月ずつ進めて国の変化を確かめます。端末内に自動保存します。
          </p>
          <button
            className="primary"
            disabled={busy || !repository}
            onClick={() => void action(start)}
          >
            ゲームを始める
          </button>
          {!repository && <p role="alert">端末の保存機能を利用できません。</p>}
        </section>
      ) : (
        <>
          <nav className="nav" aria-label="ゲーム画面">
            {(["home", "policies", "report"] as const).map((id) => (
              <button
                key={id}
                type="button"
                aria-current={
                  route === id || (id === "policies" && route === "preview")
                    ? "page"
                    : undefined
                }
                onClick={() => navigate(id)}
              >
                {id === "home"
                  ? "ホーム"
                  : id === "policies"
                    ? "政策会議"
                    : "レポート"}
              </button>
            ))}
          </nav>
          <div className="game-view">
            <p className="eyebrow">
              SCN-01・{period(state)}・第{Math.floor(state.monthIndex / 3) + 1}
              四半期
            </p>
            {route === "home" && (
              <>
                <h2 tabIndex={-1}>国家ホーム</h2>
                <Home state={state} />
                <div className="actions">
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        const saved = await advanceMonth(
                          repository!,
                          state.slotId,
                        );
                        setState(saved);
                        setNotice(`${period(saved)}まで進み、保存しました。`);
                      })
                    }
                  >
                    1か月進める
                  </button>
                  <button onClick={() => navigate("policies")}>
                    政策を考える
                  </button>
                  <button onClick={() => navigate("report")}>理由を見る</button>
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
                  onPreview={(draft) => void action(() => previewDraft(draft))}
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
