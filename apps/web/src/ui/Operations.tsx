import type { GameState } from "@macro-nation/domain";
import { useMemo } from "react";
import { previewPolicy } from "../application/policy-view";
import { display, label } from "./game-format";

function Metric({
  name,
  value,
  note,
}: {
  name: string;
  value: string;
  note: string;
}) {
  return (
    <article className="indicator">
      <h3>{name}</h3>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

export function Budget({ state }: { state: GameState }) {
  const { flows, ratios, stocks } = state.economy;
  const outlook = useMemo(
    () => previewPolicy({ state, draft: null, horizonMonths: 12 }),
    [state],
  );
  const fiscalOutlook = outlook.indicators.find(
    (item) => item.indicatorId === "fiscalBalanceRatio",
  )!.month12;
  const debtOutlook = outlook.indicators.find(
    (item) => item.indicatorId === "governmentDebtRatio",
  )!.month12;
  return (
    <>
      <p className="quiet">
        月次Engineの同じ国家勘定から、現在の財政余力を表示します。
      </p>
      <section className="indicator-grid" aria-label="財政の主要指標">
        <Metric
          name="税収"
          value={display("taxRevenue", flows.taxRevenue)}
          note="今月の歳入"
        />
        <Metric
          name="基礎的歳出"
          value={display("primarySpending", flows.primarySpending)}
          note="利払いを除く今月の歳出"
        />
        <Metric
          name="財政収支"
          value={display("fiscalBalanceRatio", ratios.fiscalBalanceRatio)}
          note="GDP比・黒字はプラス"
        />
        <Metric
          name="政府債務"
          value={display("governmentDebtRatio", ratios.governmentDebtRatio)}
          note="GDP比・将来負担の目安"
        />
      </section>
      <section className="panel" aria-labelledby="budget-outlook-heading">
        <h3 id="budget-outlook-heading">現在政策を続けた12か月見通し</h3>
        <p className="quiet">
          政策プレビューと同じEngineを固定ショック分位で実行した、悲観・基準・楽観の試算です。
        </p>
        <table>
          <thead>
            <tr>
              <th scope="col">指標</th>
              <th scope="col">悲観</th>
              <th scope="col">基準</th>
              <th scope="col">楽観</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">財政収支（GDP比）</th>
              <td>{display("fiscalBalanceRatio", fiscalOutlook.low)}</td>
              <td>{display("fiscalBalanceRatio", fiscalOutlook.base)}</td>
              <td>{display("fiscalBalanceRatio", fiscalOutlook.high)}</td>
            </tr>
            <tr>
              <th scope="row">政府債務（GDP比）</th>
              <td>{display("governmentDebtRatio", debtOutlook.high)}</td>
              <td>{display("governmentDebtRatio", debtOutlook.base)}</td>
              <td>{display("governmentDebtRatio", debtOutlook.low)}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section className="panel">
        <h3>債務と将来負担</h3>
        <dl className="data-list">
          <div>
            <dt>政府債務残高</dt>
            <dd>{stocks.governmentDebt.toFixed(1)}</dd>
          </div>
          <div>
            <dt>国内債務</dt>
            <dd>{stocks.domesticGovernmentDebt.toFixed(1)}</dd>
          </div>
          <div>
            <dt>対外債務</dt>
            <dd>{stocks.externalGovernmentDebt.toFixed(1)}</dd>
          </div>
          <div>
            <dt>今月の利払い</dt>
            <dd>{flows.interestPayment.toFixed(2)}</dd>
          </div>
        </dl>
        <p>
          収支と債務は政策費用、景気、金利、為替の結果を含みます。表示値から別の計算は行いません。
        </p>
      </section>
    </>
  );
}

export function Market({
  state,
  onOpenReport,
}: {
  state: GameState;
  onOpenReport(): void;
}) {
  const { rates, indices, stocks, flows, sentiment } = state.economy;
  return (
    <>
      <p className="quiet">
        市場が反応している指標と、因果ログへ続く入口です。
      </p>
      <section className="indicator-grid" aria-label="市場の主要指標">
        <Metric
          name={label("fx")}
          value={display("fx", indices.fx)}
          note="為替指数"
        />
        <Metric
          name="市場金利"
          value={display("marketRate", rates.marketRate)}
          note={`政策金利 ${display("policyRate", rates.policyRate)}`}
        />
        <Metric
          name="外貨準備"
          value={stocks.foreignReserves.toFixed(1)}
          note={`今月の増減 ${flows.foreignReserveChange?.toFixed(2) ?? "—"}`}
        />
        <Metric
          name="市場の緊張"
          value={`${sentiment.speculationPressure.toFixed(1)}点`}
          note={`政策信認 ${sentiment.policyTrust.toFixed(1)}点`}
        />
        <Metric
          name="海外金利"
          value={display("foreignRate", rates.foreignRate)}
          note="海外の政策金利"
        />
        <Metric
          name="経常収支"
          value={flows.currentAccount.toFixed(2)}
          note="今月の収支額"
        />
      </section>
      <section className="panel">
        <h3>市場反応の読み方</h3>
        <p>
          金利差、物価、経常収支、政策信認などの寄与は、月次レポートの因果記録で確認できます。
        </p>
        <button onClick={onOpenReport}>因果ログで要因を見る</button>
      </section>
    </>
  );
}

export function Help({ state }: { state: GameState }) {
  return (
    <>
      <section className="panel">
        <h3>遊び方と表示設定</h3>
        <dl className="data-list">
          <div>
            <dt>説明モード</dt>
            <dd>{state.learningMode ?? "standard"}</dd>
          </div>
          <div>
            <dt>動き</dt>
            <dd>端末の「動きを減らす」設定に従います</dd>
          </div>
          <div>
            <dt>音</dt>
            <dd>使用していません</dd>
          </div>
        </dl>
        <p>
          政策を比較して確定し、月を進め、ホームとレポートで結果と理由を確認します。
        </p>
      </section>
      <section className="panel">
        <h3>データ・プライバシー・免責</h3>
        <ul>
          <li>保存先はこの端末のブラウザ内です。ログインはありません。</li>
          <li>通常プレイでゲーム状態や個人情報を外部へ自動送信しません。</li>
          <li>
            保存データを消す場合は、ブラウザのサイトデータ設定を使用してください。
          </li>
          <li>
            すべての数値と説明は架空のゲームモデル上の試算であり、現実経済の予測ではありません。
          </li>
        </ul>
      </section>
    </>
  );
}

export function Developer({ state }: { state: GameState }) {
  const latestReport = state.history.reports?.at(-1);
  const nonFinitePaths: string[] = [];
  const visit = (value: unknown, path: string) => {
    if (typeof value === "number" && !Number.isFinite(value))
      nonFinitePaths.push(path);
    else if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value))
        visit(child, path ? `${path}.${key}` : key);
  };
  visit(state.economy, "economy");
  return (
    <>
      <section className="panel">
        <h3>再現情報</h3>
        <dl className="data-list">
          <div>
            <dt>seed</dt>
            <dd>
              <code>{state.rng.rootSeed}</code>
            </dd>
          </div>
          <div>
            <dt>tick / month</dt>
            <dd>
              {state.tickSequence} / {state.monthIndex}
            </dd>
          </div>
          <div>
            <dt>Engine</dt>
            <dd>{state.versions.engineVersion}</dd>
          </div>
          <div>
            <dt>Model / Config</dt>
            <dd>
              {state.versions.modelVersion} / {state.versions.configVersion}
            </dd>
          </div>
          <div>
            <dt>状態</dt>
            <dd>{state.runState}</dd>
          </div>
        </dl>
        <p className="quiet">
          この画面は開発buildだけで利用できます。表示は国家状態を変更しません。
        </p>
      </section>
      <section className="panel" aria-labelledby="rng-heading">
        <h3 id="rng-heading">現在の乱数ストリーム</h3>
        {Object.values(state.rng.streams).length ? (
          <table>
            <thead>
              <tr>
                <th>stream</th>
                <th>draws</th>
                <th>state</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(state.rng.streams).map((stream) => (
                <tr key={stream.streamId}>
                  <th scope="row">
                    <code>{stream.streamId}</code>
                  </th>
                  <td>{stream.drawCount}</td>
                  <td>
                    <code>{stream.state.join(", ")}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>まだ乱数ストリームは使用されていません。</p>
        )}
      </section>
      <section className="panel" aria-labelledby="effects-heading">
        <h3 id="effects-heading">予約中・実行中の効果キュー</h3>
        {state.effects.length ? (
          <ul>
            {state.effects.map((effect) => (
              <li key={effect.effectId}>
                <code>{effect.effectId}</code> — {effect.targetPath} /{" "}
                {effect.operation} / 月{effect.startMonth}〜{effect.endMonth}
              </li>
            ))}
          </ul>
        ) : (
          <p>効果キューは空です。</p>
        )}
      </section>
      <section className="panel" aria-labelledby="contributions-heading">
        <h3 id="contributions-heading">当月の保存済み寄与</h3>
        {latestReport?.topCauses.length ? (
          <table>
            <thead>
              <tr>
                <th>指標</th>
                <th>原因</th>
                <th>寄与</th>
              </tr>
            </thead>
            <tbody>
              {latestReport.topCauses.map((cause, index) => (
                <tr key={`${cause.indicatorId}:${cause.sourceId}:${index}`}>
                  <th scope="row">
                    <code>{cause.indicatorId}</code>
                  </th>
                  <td>
                    <code>
                      {cause.sourceType}:{cause.sourceId}
                    </code>
                  </td>
                  <td>{cause.delta}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>当月の寄与記録はまだありません。</p>
        )}
      </section>
      <section className="panel" aria-labelledby="constraints-heading">
        <h3 id="constraints-heading">制約・整合性診断</h3>
        <p>非有限値（NaN / Infinity）: {nonFinitePaths.length}件</p>
        {nonFinitePaths.length > 0 && (
          <ul>
            {nonFinitePaths.map((path) => (
              <li key={path}>
                <code>{path}</code>
              </li>
            ))}
          </ul>
        )}
        <p>Engineの上限調整・残差診断は因果記録生成時に検証されます。</p>
      </section>
      <section className="panel" aria-labelledby="batch-heading">
        <h3 id="batch-heading">ヘッドレス自動実行と出力</h3>
        <p>
          <code>
            npm run simulate -- --ticks 96 --runs 1000 --seed &lt;seed&gt; --out
            &lt;directory&gt;
          </code>
        </p>
        <p>結果は同じEngineからCSVとJSONで出力されます。</p>
      </section>
    </>
  );
}
