import type { GameState } from "@macro-nation/domain";
import { selectNationVoices } from "../application/nation-voice";
import { label } from "./game-format";

const DIRECTIONS = { "-1": "懸念", "0": "様子見", "1": "期待" } as const;
const STRENGTHS = ["変化なし", "小さい", "中程度", "大きい"] as const;

interface NationVoiceProps {
  state: GameState;
  onOpenCause?: () => void;
}

/** Native markup lets the surrounding page deck split every voice and cause. */
export function nationVoiceContent({ state, onOpenCause }: NationVoiceProps) {
  const voices = selectNationVoices(state);
  if (voices.length === 0) return null;
  return (
    <>
      <section className="panel" aria-labelledby="nation-voice-heading">
        <h3 id="nation-voice-heading">Nation Voice</h3>
        <p className="quiet">
          支持率や全員の総意ではなく、今月までの反応を表す代表的な声です。
        </p>
      </section>
      {voices.map((voice) => (
        <article
          className="panel"
          key={voice.voiceId}
          aria-label={voice.audienceLabel}
        >
          <h4>{voice.audienceLabel}</h4>
          <p>「{voice.message}」</p>
          <small>
            {DIRECTIONS[String(voice.direction) as keyof typeof DIRECTIONS]}
            ・強さ {STRENGTHS[voice.strength]}・反応まで
            {voice.lagMonths}か月
          </small>
          <p>
            理由：{label(voice.topicKey)}（{voice.causeRef.sourceType}:
            {voice.causeRef.sourceId}）
          </p>
          {onOpenCause ? (
            <button type="button" onClick={onOpenCause}>
              関連指標と因果を見る
            </button>
          ) : (
            <small>関連する因果記録は、このレポート上部で確認できます。</small>
          )}
        </article>
      ))}
    </>
  );
}

export function NationVoice(props: NationVoiceProps) {
  return nationVoiceContent(props);
}
