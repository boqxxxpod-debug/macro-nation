import type { ExpertProfile } from "./contracts";

/** The eight roles already specified for UI04. Portraits and names belong to its content manifest. */
export const expertProfiles: readonly ExpertProfile[] = [
  {
    id: "centralBank",
    role: "中央銀行",
    values: "物価・金利・為替の安定",
    tone: "落ち着いて結論から説明する",
  },
  {
    id: "fiscal",
    role: "財政",
    values: "歳入・歳出と将来の負担",
    tone: "簡潔で慎重に話す",
  },
  {
    id: "macro",
    role: "マクロ経済",
    values: "需要・供給と政策の波及",
    tone: "段階を追って教える",
  },
  {
    id: "industry",
    role: "産業政策",
    values: "投資・生産性と供給網",
    tone: "現場の具体例で率直に話す",
  },
  {
    id: "labor",
    role: "雇用労働",
    values: "雇用・賃金と働く人の暮らし",
    tone: "親しみやすく話す",
  },
  {
    id: "social",
    role: "社会政策",
    values: "所得・格差と生活の安全網",
    tone: "暮らしの例を交えて丁寧に話す",
  },
  {
    id: "demography",
    role: "人口長期",
    values: "人口構成と長期の持続性",
    tone: "近い将来と長期を分けて話す",
  },
  {
    id: "environmentEnergy",
    role: "環境エネルギー",
    values: "電源・環境と移行費用",
    tone: "将来の利益と当面の費用を併記する",
  },
];
