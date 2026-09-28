import type { GameState } from "@macro-nation/domain";
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
  return (
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
        <div>
          <dt>効果キュー</dt>
          <dd>{state.effects.length}件</dd>
        </div>
      </dl>
      <p className="quiet">
        この画面は開発buildだけで利用できます。表示は国家状態を変更しません。
      </p>
    </section>
  );
}
