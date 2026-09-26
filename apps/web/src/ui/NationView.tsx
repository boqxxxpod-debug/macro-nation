import { useMemo, useState } from "react";
import type { GameState } from "@macro-nation/domain";
import {
  REGION_IDS,
  selectNationView,
  type RegionId,
  type RegionVisualState,
} from "../application/nation-view";
import { describeCause, label } from "./game-format";
import { NationMotion } from "./NationMotion";

const STAGE_NAMES = ["低調", "安定", "活発", "非常に活発"] as const;
const POSITIONS: Record<RegionId, { left: string; top: string }> = {
  city: { left: "46%", top: "36%" },
  industry: { left: "78%", top: "45%" },
  countryside: { left: "17%", top: "46%" },
  harbor: { left: "68%", top: "77%" },
  airport: { left: "86%", top: "21%" },
  transport: { left: "34%", top: "77%" },
  energy: { left: "90%", top: "69%" },
};

function CityBlock({
  x,
  y,
  height,
  color,
}: {
  x: number;
  y: number;
  height: number;
  color: string;
}) {
  return (
    <g>
      <path d={`M${x} ${y} l24 -10 24 10 -24 10 Z`} fill="#faf0d7" />
      <path d={`M${x} ${y} l24 10 v${height} l-24 -10 Z`} fill={color} />
      <path
        d={`M${x + 24} ${y + 10} l24 -10 v${height} l-24 10 Z`}
        fill="#194953"
      />
      {[0, 1, 2].map((row) => (
        <g key={row} fill="#ffdf92" opacity=".82">
          <rect x={x + 8} y={y + 17 + row * 14} width="5" height="6" rx="1" />
          <rect x={x + 28} y={y + 17 + row * 14} width="5" height="6" rx="1" />
        </g>
      ))}
    </g>
  );
}

/** Static, accessible landscape. Animation is added in Issue #22. */
function Landscape({
  stages,
  crisis,
}: {
  stages: Record<RegionId, number>;
  crisis: boolean;
}) {
  return (
    <svg
      className="nation-landscape"
      viewBox="0 0 1000 540"
      role="img"
      aria-label="都市、農村、工業、港湾、空港、交通、発電設備を見渡す国家景観"
    >
      <defs>
        <linearGradient id="nation-sky" x2="0" y2="1">
          <stop stopColor="#a7dfe3" />
          <stop offset="1" stopColor="#eff4dc" />
        </linearGradient>
        <linearGradient id="nation-water" x2="0" y2="1">
          <stop stopColor="#77bcc4" />
          <stop offset="1" stopColor="#306f85" />
        </linearGradient>
      </defs>
      <g data-layer="Background">
        <rect width="1000" height="540" fill="url(#nation-sky)" />
        <circle cx="770" cy="78" r="43" fill="#ffdb8b" opacity=".9" />
        <path
          d="M0 220 Q140 125 280 225 Q435 105 570 220 Q765 80 1000 216 L1000 380 H0Z"
          fill="#a9c8b0"
        />
        <path
          d="M0 270 Q255 195 420 270 Q700 183 1000 265 V540 H0Z"
          fill="#77ab86"
        />
        <path
          d="M0 365 Q160 345 330 387 Q540 350 670 385 Q820 345 1000 392 V540 H0Z"
          fill="#77b898"
        />
        <path
          d="M590 395 Q780 345 1000 390 V540 H552Z"
          fill="url(#nation-water)"
        />
        <path d="M18 392 L268 330 L322 347 L38 460 Z" fill="#cbd89b" />
        <path
          d="M25 417 L268 357 M46 442 L290 378 M92 391 L103 446 M157 373 L168 431 M223 355 L234 413"
          stroke="#799962"
          strokeWidth="5"
          opacity=".75"
        />
      </g>
      <g data-layer="City">
        <path d="M330 355 L475 295 L650 347 L515 415Z" fill="#a8c6a7" />
        <CityBlock
          x={367}
          y={290}
          height={78 + stages.city * 10}
          color="#327b83"
        />
        <CityBlock
          x={436}
          y={252}
          height={100 + stages.city * 12}
          color="#35788a"
        />
        <CityBlock
          x={513}
          y={279}
          height={85 + stages.city * 8}
          color="#527e79"
        />
        <path d="M662 329 l75 -36 94 32 -74 39 Z" fill="#c4b488" />
        <path
          d="M685 295 v53 h70 v-59 Z M758 300 v48 h48 v-34 Z"
          fill="#547789"
        />
        <path
          d="M685 295 l35 -14 35 8 -70 18 Z M758 300 l25 -10 23 24 -48 2 Z"
          fill="#f4c57d"
        />
        <path d="M787 323 v-52 l20 8 v44 Z" fill="#365c69" />
        <path
          d="M801 280 l49 -10 v6 l-49 12"
          stroke="#edcc83"
          strokeWidth="4"
        />
        <path d="M790 250 H880 l20 28 H780 Z" fill="#668e8a" />
        <path
          d="M763 256 H915"
          stroke="#e9eee0"
          strokeWidth="6"
          strokeDasharray="16 9"
        />
        <path d="M803 430 l40 -24 45 18 -40 23 Z" fill="#c4d2a0" />
        <path
          d="M833 390 h18 v44 h-18 Z M869 396 h20 v36 h-20Z"
          fill="#d9e2d1"
        />
        <path
          d="M842 390 v-28 M879 396 v-26"
          stroke="#e8e8d8"
          strokeWidth="7"
        />
        <path d="M832 420 h70" stroke="#426e61" strokeWidth="7" />
        <path
          d="M612 426 l98 -17 74 17 -90 26 Z M750 447 l58 -14 35 15 -57 15 Z"
          fill="#bbd4c1"
        />
        <path
          d="M639 391 v43 h48 v-40 Z M728 385 v37 h49 v-36 Z"
          fill="#d68d67"
        />
        <path
          d="M640 390 l22 -11 26 15 -48 10 Z M728 385 l20 -10 29 11 -49 11 Z"
          fill="#f3d8a0"
        />
        <path
          d="M118 343 l19 -42 21 42 Z M186 327 l18 -37 19 37 Z M255 313 l17 -32 17 32 Z"
          fill="#427d5c"
        />
        <path d="M102 351 H305" stroke="#6b9663" strokeWidth="12" />
        {Array.from({ length: stages.countryside + 1 }, (_, index) => (
          <g key={`field-${index}`}>
            <path
              d={`M${72 + index * 55} ${390 - index * 11} l15 -7 18 7 -15 8 Z`}
              fill="#e4bd68"
            />
            <path
              d={`M${84 + index * 55} ${381 - index * 11} v-18`}
              stroke="#e2dc9a"
              strokeWidth="3"
            />
          </g>
        ))}
        {Array.from({ length: stages.industry + 1 }, (_, index) => (
          <rect
            key={`factory-${index}`}
            x={647 + index * 19}
            y={412}
            width="12"
            height="8"
            rx="2"
            fill="#f8db98"
          />
        ))}
        {Array.from({ length: stages.airport + 1 }, (_, index) => (
          <rect
            key={`freight-${index}`}
            x={791 + index * 23}
            y={282}
            width="16"
            height="8"
            rx="1"
            fill="#e2aa70"
          />
        ))}
      </g>
      <g data-layer="Transport">
        <path
          d="M0 487 Q285 410 490 456 T1000 456"
          fill="none"
          stroke="#4b7273"
          strokeWidth="28"
        />
        <path
          d="M0 487 Q285 410 490 456 T1000 456"
          fill="none"
          stroke="#ebdec4"
          strokeWidth="18"
        />
        <path
          d="M0 487 Q285 410 490 456 T1000 456"
          fill="none"
          stroke="#fff6d9"
          strokeWidth="2"
          strokeDasharray="20 15"
        />
        <path
          d="M305 400 Q500 370 705 391"
          fill="none"
          stroke="#486f75"
          strokeWidth="7"
        />
        <path
          d="M305 405 Q500 375 705 396"
          fill="none"
          stroke="#e4d9b9"
          strokeWidth="4"
        />
        <path d="M736 472 l84 -7 -23 20 -61 -1 Z" fill="#f1ead0" />
        <path
          d="M759 470 v-17 h9 v16 M790 467 v-14 h8 v14"
          stroke="#f1ead0"
          strokeWidth="4"
        />
        {Array.from({ length: stages.transport + 1 }, (_, index) => (
          <g
            key={`vehicle-${index}`}
            transform={`translate(${115 + index * 95} ${452 - index * 9})`}
          >
            <rect width="28" height="9" rx="3" fill="#e09a62" />
            <circle cx="6" cy="10" r="3" fill="#294d59" />
            <circle cx="23" cy="10" r="3" fill="#294d59" />
          </g>
        ))}
      </g>
      <g data-layer="Effect">
        {stages.city >= 2 && (
          <path
            d="M480 232 v-62 h52 M508 170 v42"
            fill="none"
            stroke="#eea85e"
            strokeWidth="6"
          />
        )}
        {stages.energy === 0 && (
          <circle cx="850" cy="415" r="31" fill="#d15d47" opacity=".35" />
        )}
        {stages.harbor >= 2 && (
          <path
            d="M700 446 h54 v8 h-54 Z M718 436 h55 v8 h-55 Z"
            fill="#edc37b"
          />
        )}
        {Array.from({ length: stages.energy + 1 }, (_, index) => (
          <rect
            key={`power-${index}`}
            x={822 + index * 22}
            y={437}
            width="16"
            height="8"
            fill="#e8d57b"
          />
        ))}
      </g>
      <g data-layer="Event">
        {crisis && (
          <path
            d="M500 153 l17 29 h-34 Z"
            fill="#a43b29"
            stroke="#fff"
            strokeWidth="3"
          />
        )}
      </g>
      <g data-layer="UI" aria-hidden="true">
        <path d="M0 520 H1000" stroke="#2a686c" strokeWidth="4" opacity=".5" />
      </g>
    </svg>
  );
}

function RegionDetails({
  region,
  state,
  onReport,
}: {
  region: RegionVisualState;
  state: GameState;
  onReport(): void;
}) {
  const change =
    region.previous === undefined ? null : region.value - region.previous;
  return (
    <section
      className="panel nation-details"
      aria-live="polite"
      aria-label={`${region.label}の地域詳細`}
    >
      <p className="eyebrow">地域のいま · {STAGE_NAMES[region.stage]}</p>
      <h3>{region.label}</h3>
      <p className="nation-metric">
        <strong>{region.value.toFixed(1)}</strong> {region.metricLabel}
      </p>
      <p>
        {change === null
          ? "前月比較は記録がありません。"
          : `前月差 ${change >= 0 ? "+" : ""}${change.toFixed(2)}（${region.previous!.toFixed(1)} → ${region.value.toFixed(1)}）`}
      </p>
      {region.related.length > 0 && (
        <p>
          {region.related
            .map((item) => `${item.label} ${item.value}`)
            .join(" · ")}
        </p>
      )}
      <p>
        {region.topCause
          ? `主な要因：${label(region.topCause.indicatorId)}に対して${describeCause(region.topCause, state)}（寄与 ${region.topCause.delta >= 0 ? "+" : ""}${region.topCause.delta.toFixed(2)}）`
          : "今月、この地域に関連する因果記録はありません。"}
      </p>
      <button onClick={onReport}>経済レポートで理由を見る</button>
    </section>
  );
}

export function NationView({
  state,
  onReport,
}: {
  state: GameState;
  onReport(): void;
}) {
  const model = useMemo(() => selectNationView(state), [state]);
  const [selected, setSelected] = useState<RegionId>("city");
  return (
    <div className="nation-view">
      <section className="nation-intro">
        <p className="eyebrow">LIVING NATION · {model.month + 1}月目</p>
        <p>
          国の変化を、街並みと地域の数字から見てみましょう。景観はゲームの経済状態に連動します。
        </p>
      </section>
      <div
        className="nation-scene"
        data-time={model.timeOfDay}
        data-weather={model.weatherKey}
      >
        <Landscape
          stages={
            Object.fromEntries(
              REGION_IDS.map((id) => [id, model.regions[id].stage]),
            ) as Record<RegionId, number>
          }
          crisis={model.overlays.length > 0}
        />
        <NationMotion model={model} />
        {REGION_IDS.map((id) => (
          <button
            className="nation-hotspot"
            style={POSITIONS[id]}
            key={id}
            aria-label={`${model.regions[id].label}を選択`}
            aria-pressed={selected === id}
            onClick={() => setSelected(id)}
          >
            <span>{model.regions[id].label}</span>
          </button>
        ))}
      </div>
      <div className="nation-news" role="status">
        <strong>今月のニュース：{model.news.headline}</strong>
        <span>{model.news.explanation}</span>
      </div>
      {model.eventMarkers.length > 0 && (
        <p className="crisis">
          出来事：{model.eventMarkers.join("・")}
          。この画面から時間は進みません。
        </p>
      )}
      <div className="nation-columns">
        <section className="panel nation-list" aria-label="地域一覧">
          <h3>地域を選ぶ</h3>
          <p>
            景観が表示できないときも、こちらから同じ地域情報を確認できます。
          </p>
          <div className="nation-region-grid">
            {REGION_IDS.map((id) => (
              <button
                key={id}
                aria-pressed={selected === id}
                onClick={() => setSelected(id)}
              >
                <strong>{model.regions[id].label}</strong>
                <small>
                  {STAGE_NAMES[model.regions[id].stage]} ·{" "}
                  {model.regions[id].value.toFixed(1)}
                </small>
              </button>
            ))}
          </div>
        </section>
        <RegionDetails
          region={model.regions[selected]}
          state={state}
          onReport={onReport}
        />
      </div>
      <p className="nation-disclaimer">
        景観はゲーム内モデルの目安です。現実の経済予測ではありません。
      </p>
    </div>
  );
}
