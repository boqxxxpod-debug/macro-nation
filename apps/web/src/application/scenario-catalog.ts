import type { ScenarioId } from "@macro-nation/domain";

/** Player-facing scenario content; economic values belong to ConfigPack. */
export interface ScenarioCatalogEntry {
  readonly id: ScenarioId;
  readonly title: string;
  readonly challenge: string;
  readonly tradeoff: string;
}

export const scenarioCatalog: readonly ScenarioCatalogEntry[] = [
  {
    id: "SCN-01",
    title: "小さな開放経済",
    challenge: "穏やかな物価高と成長鈍化に向き合う導入シナリオです。",
    tradeoff:
      "物価の安定と成長の両立を考え、基本操作と政策の時間差を学びます。",
  },
  {
    id: "SCN-02",
    title: "通貨安と輸入インフレ",
    challenge: "通貨安によって輸入品の価格が上がっている状態から始めます。",
    tradeoff:
      "金利と為替介入だけでは解けない課題を、景気と物価の両面から考えます。",
  },
  {
    id: "SCN-03",
    title: "関税応酬と供給制約",
    challenge:
      "相手国との関係が悪化し、物価高と成長停滞に直面した状態から始めます。",
    tradeoff:
      "国内産業の保護と、輸入品を使う産業や家計の費用の両立を考えます。",
  },
];
