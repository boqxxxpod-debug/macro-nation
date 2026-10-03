# MACRO NATION 専門家肖像 アニメ版 v2

2026-10-03に、既存プロフィールの服装・役割・価値観・口調を保ち、8人の個別肖像をかわいいアニメ調へ描き直しました。
大きなきらきらした瞳、丸い輪郭、小さな口、頬の赤み、明るいセル塗りで統一しています。
小さくデフォルメした上半身の肖像で、服装・髪型・眼鏡・表情による見分けやすさを保っています。
専門家は架空の人物です。名前・役割・口調の正本は `packages/advisor-core/src/profiles.ts` のままです。
年齢・髪型・表情などは肖像の視覚デザインであり、経済モデルや助言の仕様を追加しません。

## ファイル

既存の画像ファイル名と資料ディレクトリ `docs/assets/expert-portraits-v1/` は継続使用しています。
今回の素材バージョンはmanifestの `expert-portraits-anime-v2` で識別できます。

- `apps/web/public/experts/*.webp`：256×256の1x、512×512の2x。全16ファイル、透明背景。
- `manifest.json`：expertId、portraitAssetKey、altText、寸法、容量、SHA-256。
- `generation-prompts.json`：8人それぞれの最終生成プロンプト。
- ZIP内の `sources/*.png`：1254×1254の生成原本。原本は画像用ブランチには含めません。

## 対応表

| expertId | 氏名 | 役割 | キャラクター設定 | 使用ファイル |
| --- | --- | --- | --- | --- |
| centralBank | 水城 静香 | 中央銀行 | 物価・金利・為替の安定。落ち着いて結論から説明する。紺のジャケット。 | central-bank.webp / central-bank@2x.webp |
| fiscal | 大蔵 堅 | 財政 | 歳入・歳出と将来の負担。簡潔で慎重に話す。茶色のネクタイ。 | fiscal.webp / fiscal@2x.webp |
| macro | 景山 めぐみ | マクロ経済 | 需要・供給と政策の波及。段階を追って教える。紫のスカーフ。 | macro.webp / macro@2x.webp |
| industry | 工藤 拓 | 産業政策 | 投資・生産性と供給網。現場の具体例で率直に話す。黄土色の作業ジャケット。 | industry.webp / industry@2x.webp |
| labor | 働木 あゆみ | 雇用労働 | 雇用・賃金と働く人の暮らし。親しみやすく話す。赤いカーディガン。 | labor.webp / labor@2x.webp |
| social | 福原 守 | 社会政策 | 所得・格差と生活の安全網。暮らしの例を交えて丁寧に話す。緑のシャツ。 | social.webp / social@2x.webp |
| demography | 世代 千歳 | 人口長期 | 人口構成と長期の持続性。近い将来と長期を分けて話す。眼鏡と藤色の上着。 | demography.webp / demography@2x.webp |
| environmentEnergy | 風間 光 | 環境エネルギー | 電源・環境と移行費用。将来の利益と当面の費用を併記する。深緑のジャケット。 | environment-energy.webp / environment-energy@2x.webp |

## 組み込み時の注意

この画像用ブランチは素材の受け渡し用です。UIへ接続するコードは含みません。
最新mainから実装し、画像と素材資料を取り込んで、既存の簡易SVG肖像をWebPへ切り替えてください。
共有パッケージへDOM、React、Viteを導入せず、相対アセットキーの解決はWeb UI側で行います。
GitHub Pagesの `/macro-nation/` とXserverの配信パスを両方考慮してください。
HTMLのwidth/heightやCSSで表示枠を予約し、同じexpertIdに同じ肖像を表示します。
画像がなくても氏名・役割・口調を読み取れ、専門家を1〜3人選択できることを保ちます。
政策会議の選択欄とプレビューの助言カードが最初の使用箇所です。
人物デザインを作り直したり、画像内へ名前・説明文を焼き込んだりする必要はありません。
