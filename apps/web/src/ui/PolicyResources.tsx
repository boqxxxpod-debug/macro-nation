import type { GameState, PolicyCosts } from "@macro-nation/domain";
import { policyResourceComparison } from "../application/policy-resources";
import { TermHelp } from "./TermHelp";

const RESOURCE_NAMES = {
  politicalCapital: "政治資本",
  implementationCapacity: "実施能力",
  foreignReserves: "外貨準備",
  immediateBudget: "開始予算",
} as const;

function resourceNumber(value: number, showShortage = false): string {
  return Number(
    showShortage ? value.toPrecision(12) : value.toFixed(2),
  ).toString();
}

function resourceAmount(
  key: keyof PolicyCosts,
  value: number,
  showShortage = false,
): string {
  return `${resourceNumber(value, showShortage)}${key === "politicalCapital" || key === "implementationCapacity" ? "点" : " model unit"}`;
}

/** Return native blocks so PageDeck can keep each comparison together. */
export function policyResourcesContent(state: GameState, costs: PolicyCosts) {
  const rows = policyResourceComparison(state, costs);
  return (
    <>
      <h3>費用と資源の残量</h3>
      <p>
        現在量 − 予約済み ＝ 使える量。使える量 − この案の基本費用 ＝
        採用後に使える残量。
      </p>
      <p>
        採用後は、確定時に基本費用を予約した後の余力です。「すぐに始める」場合も、開始月の月次計算で予約を解除して同額を実消費します。二重には差し引きません。
      </p>
      <p>
        政治資本・実施能力は0〜100点。外貨準備・開始予算は基準月次名目GDPを100とする金額単位（model
        unit）です。開始予算は開始時の一括費用に使える予算で、継続支出は含みません。
      </p>
      {rows.map((row) => {
        const name = RESOURCE_NAMES[row.key];
        const unit =
          row.key === "politicalCapital" || row.key === "implementationCapacity"
            ? "点"
            : "model unit";
        const entries = [
          ["現在量", row.current],
          ["予約済み", row.reserved],
          ["使える量", row.available],
          ["この案の基本費用", row.cost],
          ["採用後に使える残量", row.remaining],
        ] as const;
        return (
          <article
            className="panel policy-resource"
            aria-label={`${name}の費用と残量`}
            key={row.key}
          >
            <h4>
              {row.key === "immediateBudget" ? (
                name
              ) : (
                <TermHelp termId={row.key} name={name} />
              )}
              <span className="resource-unit">
                （{unit === "点" ? "残量0〜100点" : unit}）
              </span>
            </h4>
            <dl className="resource-comparison">
              {entries.map(([title, value]) => (
                <div key={title}>
                  <dt>{title}</dt>
                  <dd>{resourceAmount(row.key, value, row.shortage > 0)}</dd>
                </div>
              ))}
            </dl>
          </article>
        );
      })}
      {rows
        .filter((row) => row.shortage > 0)
        .map((row) => (
          <p role="status" key={`shortage-${row.key}`}>
            {RESOURCE_NAMES[row.key]}が足りません。必要{" "}
            {resourceAmount(row.key, row.cost, true)}、使える量{" "}
            {resourceAmount(row.key, row.available, true)}、不足量{" "}
            {resourceAmount(row.key, row.shortage, true)}
            。設定値や政策を見直して、もう一度見通しを確認してください。
          </p>
        ))}
    </>
  );
}
