# Issue #95 肖像表示の確認画像

360×640の実ブラウザ画面です。政策会議（UI04）と専門家の助言（UI05）で、同じ8人の生成済み肖像を表示しています。

16点の元WebPは素材コミット `5b6e8d50ab3de99afd6196ce6fa5dad0b8cd49d4` のままです。予測値・助言の計算、プロフィール、保存形式は変更していません。

PC、2倍解像度、画像失敗・非表示、200%文字拡大、オフライン、Pagesのサブパスの検証はPlaywrightで実行し、CIの `expert-portrait-review` アーティファクトにも各画面の画像を保存します。

| 専門家 | UI04 選択 | UI05 助言 |
| --- | --- | --- |
| 水城 静香（中央銀行） | <img src="picker-360-centralBank.png" width="180" alt="水城 静香のpicker画面"> | <img src="advice-360-centralBank.png" width="180" alt="水城 静香のadvice画面"> |
| 大蔵 堅（財政） | <img src="picker-360-fiscal.png" width="180" alt="大蔵 堅のpicker画面"> | <img src="advice-360-fiscal.png" width="180" alt="大蔵 堅のadvice画面"> |
| 景山 めぐみ（マクロ経済） | <img src="picker-360-macro.png" width="180" alt="景山 めぐみのpicker画面"> | <img src="advice-360-macro.png" width="180" alt="景山 めぐみのadvice画面"> |
| 工藤 拓（産業政策） | <img src="picker-360-industry.png" width="180" alt="工藤 拓のpicker画面"> | <img src="advice-360-industry.png" width="180" alt="工藤 拓のadvice画面"> |
| 働木 あゆみ（雇用労働） | <img src="picker-360-labor.png" width="180" alt="働木 あゆみのpicker画面"> | <img src="advice-360-labor.png" width="180" alt="働木 あゆみのadvice画面"> |
| 福原 守（社会政策） | <img src="picker-360-social.png" width="180" alt="福原 守のpicker画面"> | <img src="advice-360-social.png" width="180" alt="福原 守のadvice画面"> |
| 世代 千歳（人口長期） | <img src="picker-360-demography.png" width="180" alt="世代 千歳のpicker画面"> | <img src="advice-360-demography.png" width="180" alt="世代 千歳のadvice画面"> |
| 風間 光（環境エネルギー） | <img src="picker-360-environmentEnergy.png" width="180" alt="風間 光のpicker画面"> | <img src="advice-360-environmentEnergy.png" width="180" alt="風間 光のadvice画面"> |
