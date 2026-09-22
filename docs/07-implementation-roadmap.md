# Synchronized specification

> Source: Macro_Nation_Implementation_Roadmap_v1.1
> Synced: 2026-09-22
> Repository copy for Codex implementation. The private Drive URL/ID is intentionally not stored because this repository is public.

---

MACRO NATION
実装ロードマップ
企画・要件・詳細設計からCodex実装へ
0 実装前アーキテクチャゲート
Codex着手前の基準文書として「Macro_Nation_Architecture_Design_v1.0」を追加する。Issue番号は1〜30を維持し、Issue 1〜6でアーキテクチャ境界も固定する。新しい大規模な機能Issueは追加せず、既存Issueの受入条件へ反映する。


M0開始時に固定する事項
・npm workspaces: apps/web と packages/domain、packages/simulation-engine、packages/model-config、packages/advisor-core
・Xserver: 静的SPA/PWA、MVPバックエンドなし、base path設定、SPA fallback
・ClockConfig: 月次を既定とするが計算単位・政策周期を設定化
・NationProfile: MVP一国、将来複数国家
・ExpertAdvisor: RuleBasedをMVP、Provider交換可能
・Version: saveSchema / engine / model / content / rngを独立管理
・Persistence: Repository contract + IndexedDB Adapter
・Engine: Pure TypeScript、browser API非依存


アーキテクチャ変更のDone条件
Issue 1終了時点でworkspace依存境界とXserver production buildが確認できる。
Issue 2〜6終了時点でEngineがWebから独立してNode headless testから実行できる。
Engine変更とModel tuningを別PRにできる構造になっている。




1 ゴールと進め方
本ロードマップは、最初のプレイ可能版を早期に成立させ、その上に期間選択、選択式専門家、Living Nation、反応とドラマ、教育、国家史を積み上げる順序を定める。各Issueは観察可能な振る舞いと自動テストを同じ変更に含める。期間は1人の実装者を想定した目安であり、完了ゲートを満たすまでは次段階へ広げない。
最優先は決定論 再現性 因果ログ 保存整合性である。
画面は縦切りで早く動かし UIだけを先に作り込まない。
専門家 国家ビュー Voice 教育は同じengine結果から導出し 隠れた別計算を作らない。
4年と8年を先に品質化し 20年と30年は長期更新と性能ゲート後に公開する。
文書よりIssueの受入条件を実装単位とし 要件IDと設計節をPRへ記録する。
2 全体マイルストーン
3 クリティカルパス
Issue 1から6でworkspace境界、Xserver配布骨格、型、設定、乱数、因果、ClockConfig、月次tickを固定する。
Issue 7から10で経済モデルを48 96tick完走させる。
Issue 11から15で政策から画面までの縦切りを完成させる。
Issue 16で期間と長期更新の土台を作り Issue 17から20へ渡す。
Issue 19の専門家プロフィールと助言契約を先に固定し Issue 27 28で教育へ再利用する。
Issue 23の反応モデルをIssue 24 Nation VoiceとIssue 26危機へ共有する。
Issue 29で国家史を統合し Issue 30で全画面と30年品質を閉じる。
4 M0 基盤と決定論エンジン
目安 1から4週 / Issues 1から10
ゲート: 同じ入力で状態と因果ログが完全一致する。
ゲート: NaN Infinity 範囲外 state 保存不能が0件である。
保留: 画面の作り込み キャラクター演出 長期係数調整。
5 M1 最初のプレイ可能版
目安 5から8週 / Issues 11から15
ここで限定的なfirst playableを作り、以降の機能は必ずこの縦切りへ接続する。Issue 15が終わるまでは国家ビューや長期演出を本実装しない。
6 M2 期間と主要UX
目安 9から12週 / Issues 16から20
専門家マイルストーン
UI04で承認した8プロフィールを唯一のマスターにする。
各専門家へ固有portraitAssetKey、altText、配色、toneKey、重視指標を設定する。
助言は 結論 やさしい理由 注意点 の順に表示する。
専門家を変えても予測値は不変で、説明の焦点と口調だけが変わる。
外部生成AIは使わず 因果ログと決定論的テンプレートで生成する。
7 M3 Living Nation
目安 13から15週 / Issues 21から22
静止版で情報設計を検証してから動きを足す。
背景 都市 交通 効果 イベント UIを層分離する。
Canvasが使えない場合も地域一覧と因果説明をDOMで利用できる。
低性能端末では人 車 天候の順に密度を落とし 状態情報は残す。
8 M4 反応とドラマ
目安 16から19週 / Issues 23から26
9 M5 教育と国家史
目安 20から22週 / Issues 27から29
自由主義 社会主義 新自由主義 マルクス主義 共産主義等は比較レンズとして扱う。
説明はゲームモデルの試算であり現実予測ではないと常時明示する。
国家史は政策 イベント 危機 反応 レビューの参照IDから再生成可能にする。
10 M6 統合公開候補
目安 23から24週以降 / Issue 30
11 品質ゲート
12 リスクと対策
13 Codexでの作業ルール
最初はIssue 1から着手し 完了したら依存順に次へ進む。
1 Issue 1 branch 1 PRを基本とし 無関係なリファクタを混ぜない。
PR本文へIssue番号 要件ID 設計節 実行したテストを記載する。
engine変更とバランス係数変更を同じPRへ混ぜない。
保存schema変更にはmigration fixtureを必須とする。
UI変更には360px keyboard focus 200パーセント拡大の確認を含める。
golden更新は差分理由を説明できる場合だけ行う。
外部通信 Math.random Date.nowのengine利用をCIとレビューで防ぐ。
14 着手チェックリスト
15 視覚的な到達像
M2では政策会議に選択式専門家UIを足し、M3では国家ビューを実装する。以下の画像は色、情報密度、世界観の参考であり、実装時は要件とコンポーネント設計を優先する。
図 RM1 M2 政策会議の到達像
図 RM2 M3 Living Nationの到達像
項目
内容
版
1.0
基準日
2026年9月22日
対象
GitHub Issues 1から30
前提
個人開発を基本とし CodexでIssue単位に実装
完了像
4 8 20 30年 国家ビュー 専門家 教育 国家史を含むPWA
段階
目安
Issue
到達点
出口ゲート
M0 基盤とエンジン
1から4週
1から10
SCN-01を48 96tickヘッドレス完走
決定論 数値不変条件 CI
M1 最初のプレイ可能版
5から8週
11から15
政策を決め 結果と理由を確認
縦切りE2E 初見操作
M2 期間と主要UX
9から12週
16から20
4 8 20 30年とUI01からUI05 専門家
選択 保存 予測整合
M3 Living Nation
13から15週
21から22
動く国家と数値連動
性能 動作軽減 因果遷移
M4 反応とドラマ
16から19週
23から26
主体反応 Voice コンボ 危機
同一seed 因果一致
M5 教育と国家史
20から22週
27から29
なぜ ノート 思想比較 国家史
非正解化 5年レビュー
M6 統合公開候補
23から24週以降
30
全画面 30年 安定PWA
30年性能 実機 a11y
依存元
依存先
理由
5 因果寄与
13 19 23 27 29
予測 助言 反応 教育 国家史の根拠
6 月次tick
7から12 16 23 26
全機能の原子的な時間進行
13 プレビュー
19 20 25 27
専門家助言 反実仮想 コンボ 教育
16 期間長期
17 29 30
開始設定 5年レビュー 30年品質
19 専門家
20 27 28
予測説明 ノート 思想比較
23 反応
24 26 29
Voice 危機 国家史
Issue
成果物
確認
1
npm workspaces + Vite React TypeScript PWA shell CI + Xserver deploy骨格
build lint typecheck unitとXserver production build smokeがCIで成功
2
GameState EconomyState VersionTuple ClockConfig NationProfile 数値単位 不変条件
境界値とinvalid stateを拒否
3
ConfigPack/Model/Nation schema SCN-01 fixture
全参照と範囲とVersion整合を検証
4
xoshiro128ss stream分離
golden vectorとserialize復元
5
CausalContribution builder
delta reconciliation一致
6
原子的月次tick骨格
失敗時rollback 重複tickなし
7
需要 GDP
方向性 恒等式 上下限
8
物価 雇用 為替
ラグとショックのテスト
9
財政 信頼 6産業
勘定一致と産業寄与
10
48 96tickヘッドレス
基準seed完走とgolden snapshot
Issue
ユーザー価値
出口条件
11
5政策が異なるラグと副作用で効く
ScheduledEffectと方向性テスト
12
四半期3枠で実施 予約 変更できる
command冪等性 資源予約
13
確定前に12か月先まで比較できる
baselineとvariantの再現性
14
ホーム 政策会議 プレビュー レポートを操作
360px keyboard 主要遷移
15
SCN-01を開始から終了まで遊べる
縦切りE2E 初見5人
Issue
範囲
完了判定
16
4 8 20 30年 無操作基準 5年10年節目
期間境界 保存 移行 30年smoke
17
UI01 UI02 保存 シナリオ 期間 学習モード
開始 再開 復旧 E2E
18
UI03 危機 3行報告 5指標 節目 提案
5秒で状況把握 初見テスト
19
UI04 選択専門家 画像 口調 助言
1から3人 画像なしでも識別 結果不変
20
UI05 反実仮想 コンボ枠 1年5年
基準と政策差 予測根拠
Issue
実装順
出口条件
21
静止2.5D 国家ビュー 地域選択 因果への導線
指標と景観段階が一致
22
交通 建設 天候 イベント animation 性能tier
30fps目標 reduced motion
Issue
成果
テスト
23
国民 企業 市場の方向 強さ 遅延 理由
政策寄与とcausalRef一致
24
Nation Voice代表意見と理由遷移
同一seed同一文言 支持率代用にしない
25
政策コンボ 相乗 相殺 追加費用
previewとcommit一致 循環禁止
26
突発イベント 危機 兆候 準備度
基準被害 軽減 選択効果を分離
Issue
成果
出口条件
27
3学習モード なぜ 反実仮想 経済学ノート
modeでengine結果不変
28
思想比較 専門家1年5年予測記録
単一の正解扱いなし
29
5年レビュー 国家史 最終比較
30年で重複なし 完全な年表
検証領域
基準
画面
UI06からUI13を含む14画面の状態 遷移 エラー 復旧
期間
4 8 20 30年の開始 保存 再開 終了 失敗
性能
96tick 5秒以内 360tick 10秒以内 UI14最低20fps
再現性
助言 反応 Voice コンボ 国家史まで同一seed一致
アクセシビリティ
360px 200パーセント keyboard 読み上げ 動作軽減
オフライン
初回読込後に開始 プレイ 保存 終了可能
利用者検証
主要因を説明でき 再挑戦意図が確認できる
ゲート
合格条件
未達時
計算
1,000回8年 100回30年で不変条件違反0
UI拡張を止めengine修正
説明
表示deltaと因果寄与が一致
助言 Voice 教育の追加を止める
保存
強制終了 版移行 破損から復旧
公開候補を作らない
性能
基準端末のtickとUI14予算を満たす
表現密度を下げ再測定
教育
思想を正解化せず予測免責が見える
コンテンツレビュー
利用者
初見5人中4人が最大要因を説明
UI03 UI05 助言を改善
リスク
兆候
対策
機能過多
first playableが遅れる
Issue 15完了までP1を本実装しない
長期数値発散
20年以降に上限張付き
無操作baselineと30年batchをIssue16で導入
専門家が装飾化
誰を選んでも文章が同じ
重視指標 説明順 tone snapshotをテスト
専門家が攻略化
特定キャラで結果が有利
expertIdをengine inputへ渡さない
国家ビューが重い
20fps未満 発熱
静止MVP quality tier object pooling
Voiceと結果の矛盾
反応理由が因果と不一致
ReactionSnapshotのcausalRefだけから生成
教育が断定的
思想や現実予測を正解扱い
比較軸と免責を受入テスト化
文書と実装の乖離
Issueに要件IDがない
PR templateとDoDで参照必須
時点
確認
Issue開始前
依存Issue完了 要件ID明確 入出力と異常系が定義済み
実装中
pure domain先行 fixtureとtestを同時追加
PR前
format lint typecheck unit integration 必要なE2E
PRレビュー
結果差分 保存互換 a11y privacy performanceを確認
Issue完了
完了条件を再現でき 設計またはIssueへ判断を残した
