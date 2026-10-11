import type { ExpertProfile } from "./contracts";
import content from "./content-v1.2.0.json";

/** The eight roles already specified for UI04. Portraits and names belong to its content manifest. */
const legacyProfiles: readonly ExpertProfile[] = [
  {
    id: "centralBank",
    displayName: "水城 静香",
    role: "中央銀行",
    values: "物価・金利・為替の安定",
    tone: "落ち着いて結論から説明する",
    toneKey: "measured",
    colorToken: "#315b70",
    portraitAssetKey: "central-bank",
    portraitAltText: "紺のジャケットを着た中央銀行専門家、水城静香",
    priorityIndicators: ["inflation", "policyRate", "fx"],
  },
  {
    id: "fiscal",
    displayName: "大蔵 堅",
    role: "財政",
    values: "歳入・歳出と将来の負担",
    tone: "簡潔で慎重に話す",
    toneKey: "cautious",
    colorToken: "#6b4c3b",
    portraitAssetKey: "fiscal",
    portraitAltText: "茶色のネクタイを着けた財政専門家、大蔵堅",
    priorityIndicators: ["governmentDebtRatio", "primarySpending", "realGdp"],
  },
  {
    id: "macro",
    displayName: "景山 めぐみ",
    role: "マクロ経済",
    values: "需要・供給と政策の波及",
    tone: "段階を追って教える",
    toneKey: "teacher",
    colorToken: "#4b568f",
    portraitAssetKey: "macro",
    portraitAltText: "紫のスカーフを着けたマクロ経済専門家、景山めぐみ",
    priorityIndicators: ["realGdp", "inflation", "unemployment"],
  },
  {
    id: "industry",
    displayName: "工藤 拓",
    role: "産業政策",
    values: "投資・生産性と供給網",
    tone: "現場の具体例で率直に話す",
    toneKey: "direct",
    colorToken: "#775a22",
    portraitAssetKey: "industry",
    portraitAltText: "黄土色の作業ジャケットを着た産業政策専門家、工藤拓",
    priorityIndicators: ["potentialGdp", "realGdp", "primarySpending"],
  },
  {
    id: "labor",
    displayName: "働木 あゆみ",
    role: "雇用労働",
    values: "雇用・賃金と働く人の暮らし",
    tone: "親しみやすく話す",
    toneKey: "friendly",
    colorToken: "#9b435c",
    portraitAssetKey: "labor",
    portraitAltText: "赤いカーディガンを着た雇用労働専門家、働木あゆみ",
    priorityIndicators: ["unemployment", "realGdp", "support"],
  },
  {
    id: "social",
    displayName: "福原 守",
    role: "社会政策",
    values: "所得・格差と生活の安全網",
    tone: "暮らしの例を交えて丁寧に話す",
    toneKey: "empathetic",
    colorToken: "#357060",
    portraitAssetKey: "social",
    portraitAltText: "緑のシャツを着た社会政策専門家、福原守",
    priorityIndicators: ["support", "unemployment", "inflation"],
  },
  {
    id: "demography",
    displayName: "世代 千歳",
    role: "人口長期",
    values: "人口構成と長期の持続性",
    tone: "近い将来と長期を分けて話す",
    toneKey: "longView",
    colorToken: "#66527c",
    portraitAssetKey: "demography",
    portraitAltText: "眼鏡と藤色の上着が特徴の人口長期専門家、世代千歳",
    priorityIndicators: ["potentialGdp", "governmentDebtRatio", "realGdp"],
  },
  {
    id: "environmentEnergy",
    displayName: "風間 光",
    role: "環境エネルギー",
    values: "電源・環境と移行費用",
    tone: "将来の利益と当面の費用を併記する",
    toneKey: "balanced",
    colorToken: "#2f7150",
    portraitAssetKey: "environment-energy",
    portraitAltText: "深緑のジャケットを着た環境エネルギー専門家、風間光",
    priorityIndicators: ["inflation", "potentialGdp", "primarySpending"],
  },
];

/** The approved identities and priorities stay fixed; only the new content tone changes. */
export const expertProfiles: readonly ExpertProfile[] = legacyProfiles.map(
  (profile) => ({
    ...profile,
    tone:
      (content.tones as Readonly<Record<string, string>>)[
        profile.toneKey ?? ""
      ] ?? profile.tone,
  }),
);

/** Keep advice from existing saves reproducible when profile content evolves. */
export function expertProfilesForContentVersion(
  contentVersion: string,
): readonly ExpertProfile[] {
  if (contentVersion === "1.0.0") {
    return legacyProfiles.map(
      ({ id, role, values, tone, portraitAssetKey }) => ({
        id,
        role,
        values,
        tone,
        ...(portraitAssetKey ? { portraitAssetKey } : {}),
      }),
    );
  }
  if (contentVersion === "1.1.0") return legacyProfiles;
  return expertProfiles;
}

/** Relative static asset paths let the web app resolve its configured deployment base. */
export const expertPortraitManifest = expertProfiles.map((profile) => {
  const portraitAssetKey = profile.portraitAssetKey;
  if (!portraitAssetKey) {
    throw new Error(`Missing portrait asset key for expert ${profile.id}`);
  }
  return {
    expertId: profile.id,
    portraitAssetKey,
    src: `experts/${portraitAssetKey}.webp`,
    src2x: `experts/${portraitAssetKey}@2x.webp`,
    altText: profile.portraitAltText ?? "",
  };
});
