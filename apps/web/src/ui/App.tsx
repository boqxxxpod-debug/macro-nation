import { getFoundationStatus } from "../application/foundation";

export function App() {
  const status = getFoundationStatus();

  return (
    <main className="app-shell">
      <section className="hero" aria-labelledby="app-title">
        <p className="eyebrow">国家運営シミュレーション</p>
        <h1 id="app-title">MACRO NATION</h1>
        <p className="lead">
          政策の時間差とトレードオフを、一貫したルールで体験するためのゲーム基盤です。
        </p>
      </section>

      <section className="foundation-card" aria-labelledby="foundation-title">
        <h2 id="foundation-title">Foundation ready</h2>
        <dl>
          <div>
            <dt>Simulation Engine</dt>
            <dd>{status.engine}</dd>
          </div>
          <div>
            <dt>Headless probe</dt>
            <dd>{status.probeResult}</dd>
          </div>
          <div>
            <dt>PWA</dt>
            <dd>offline shell enabled</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
