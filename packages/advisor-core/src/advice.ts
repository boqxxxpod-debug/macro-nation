import type {
  Advice,
  ExpertProfile,
  RuleBasedAdviceContext,
} from "./contracts";
import content from "./content-v1.2.0.json";
import { indicatorDisplayName, renderContent } from "./display-names";

const legacyEndings: Readonly<Record<string, string>> = {
  measured: "数字の振れを見ながら進めるのが妥当です。",
  cautious: "財源と将来負担を同時に確認しましょう。",
  teacher: "短期と長期を分けて考えてみましょう。",
  direct: "実行段階の詰まりまで先に確認すべきです。",
  friendly: "働く人への届き方を忘れずに見ていきましょう。",
  empathetic: "家計ごとの違いにも目を配りましょう。",
  longView: "次の世代まで時間軸を伸ばして考えましょう。",
  balanced: "移行期の費用と将来便益を並べて判断しましょう。",
};

/** Deterministic wording over shared preview facts; it never calls or mutates the engine. */
export class RuleBasedExpertAdvisor {
  advise(profile: ExpertProfile, context: RuleBasedAdviceContext): Advice {
    const priorities =
      profile.priorityIndicators ?? Object.keys(context.effects);
    const ranked = priorities
      .map((indicator) => ({
        indicator,
        value: context.effects[indicator] ?? 0,
      }))
      .sort(
        (a, b) =>
          Math.abs(b.value) - Math.abs(a.value) ||
          a.indicator.localeCompare(b.indicator),
      );
    const focus = ranked[0] ?? { indicator: "realGdp", value: 0 };
    if (
      context.contentVersion === "1.0.0" ||
      context.contentVersion === "1.1.0"
    ) {
      const direction =
        focus.value > 0 ? "改善" : focus.value < 0 ? "悪化" : "ほぼ横ばい";
      return {
        expertId: profile.id,
        conclusion: `${focus.indicator}は無追加政策比で${direction}する見通しです。`,
        reason: `${profile.values}を重視し、共通の予測結果から影響の大きい項目を先に確認しました。`,
        caution: `${context.uncertainty} ${legacyEndings[profile.toneKey ?? ""] ?? "前提が変わる可能性も確認しましょう。"}`,
      };
    }
    // Missing priority facts are not evidence of a zero effect.
    const available = ranked.filter(
      ({ indicator, value }) =>
        Object.hasOwn(context.effects, indicator) && Number.isFinite(value),
    );
    const currentFocus = available[0];
    const direction =
      currentFocus && currentFocus.value > 0
        ? content.directions.up
        : currentFocus && currentFocus.value < 0
          ? content.directions.down
          : content.directions.flat;
    return {
      expertId: profile.id,
      conclusion: currentFocus
        ? renderContent(content.adviceConclusion, {
            indicator: indicatorDisplayName(currentFocus.indicator),
            direction,
          })
        : content.noEvidenceConclusion,
      reason: renderContent(
        currentFocus ? content.adviceReason : content.noEvidenceReason,
        { values: profile.values },
      ),
      caution: [
        context.uncertainty,
        (content.endings as Readonly<Record<string, string>>)[
          profile.toneKey ?? ""
        ] ?? content.defaultCaution,
      ]
        .filter(Boolean)
        .join(" "),
    };
  }
}
