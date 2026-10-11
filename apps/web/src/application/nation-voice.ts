import type {
  CausalRef,
  GameState,
  ReactionAudience,
  ReactionSnapshot,
} from "@macro-nation/domain";
import templates from "./nation-voice-templates.json";

const AUDIENCES: readonly ReactionAudience[] = [
  "citizens",
  "business",
  "market",
];

export const VOICE_AUDIENCE_LABELS: Record<ReactionAudience, string> = {
  citizens: "国民の声",
  business: "企業の声",
  market: "市場の声",
};

export interface NationVoiceItem {
  readonly voiceId: string;
  readonly audience: ReactionAudience;
  readonly audienceLabel: string;
  readonly direction: -1 | 0 | 1;
  readonly strength: 0 | 1 | 2 | 3;
  readonly month: number;
  readonly lagMonths: number;
  readonly topicKey: string;
  readonly message: string;
  readonly causeRef: CausalRef;
}

function stableIndex(value: string, length: number): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % length;
}

function messageFor(
  reaction: ReactionSnapshot,
  contentVersion: string,
): string {
  const tone =
    reaction.direction > 0
      ? "positive"
      : reaction.direction < 0
        ? "negative"
        : "neutral";
  const edition =
    contentVersion === "1.2.0" ? templates["1.2.0"] : templates.legacy;
  const choices = edition[reaction.audience][tone];
  return choices[
    stableIndex(
      `${reaction.audience}:${reaction.representativeTopicKey}`,
      choices.length,
    )
  ]!;
}

/**
 * Builds explanation-only voices from saved reactions. One recent topic per
 * audience is shown, so repeated monthly snapshots cannot crowd out diversity.
 */
export function selectNationVoices(
  state: GameState,
  recentMonths = 6,
): readonly NationVoiceItem[] {
  const minimumMonth = Math.max(0, state.monthIndex + 1 - recentMonths);
  const reactions = (state.history.reports ?? []).flatMap(
    (report) => report.reactions ?? [],
  );
  return AUDIENCES.flatMap((audience) => {
    const selected = reactions
      .filter(
        (reaction) =>
          reaction.audience === audience &&
          reaction.month >= minimumMonth &&
          reaction.causeRefs.length > 0,
      )
      .sort(
        (left, right) =>
          right.strength - left.strength ||
          right.month - left.month ||
          left.representativeTopicKey.localeCompare(
            right.representativeTopicKey,
          ),
      )[0];
    if (!selected) return [];
    return [
      {
        voiceId: `voice:${selected.reactionId}`,
        audience,
        audienceLabel: VOICE_AUDIENCE_LABELS[audience],
        direction: selected.direction,
        strength: selected.strength,
        month: selected.month,
        lagMonths: selected.lagMonths,
        topicKey: selected.representativeTopicKey,
        message: messageFor(selected, state.versions.contentVersion),
        causeRef: selected.causeRefs[0]!,
      },
    ];
  });
}
