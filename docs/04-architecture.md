# Synchronized specification

> Source: Macro_Nation_Architecture_Design_v1.0
> Synced: 2026-09-22
> Repository copy for Codex implementation. The private Drive URL/ID is intentionally not stored because this repository is public.

---

MACRO NATION アーキテクチャ設計 v1.0
Codex実装の基準となるシステムアーキテクチャ


1. 目的
本書は、MACRO NATIONをCodexで実装する際の技術的な境界、依存方向、バージョニング、配布方式を固定する。経済モデルの係数やゲームバランスは後から容易に変更できる一方、Simulation Engineの純粋性、再現性、保存互換性、UIとの分離は崩さない。


2. 確定前提
・公開先は契約中のXserverとする。
・MVPはログインなし、クラウドセーブなし、サーバ側常時計算なしとする。
・ゲームはブラウザ内で実行し、端末内に保存する。
・アプリ終了中はサーバで進行せず、再開時に経過時間から必要tickをまとめて計算する。
・基本計算単位はゲーム内1か月、標準の政策判断周期は3か月とする。ただし時間単位と周期は設定から変更可能にする。
・専門家はMVPでは決定論的ルールベースとし、将来別Providerへ交換できる契約にする。
・乱数はseed付きで、同一版・同一入力・同一seed・同一操作列なら完全再現可能にする。
・経済の方向性、相関、ラグは現実寄りとし、ゲームとしての強度はModel Configで調整する。
・MVPは標準的な架空国家1国で開始するが、国家固有値をEngineへ埋め込まず、将来複数国家を追加できる。
・将来ネイティブアプリを別アプリとして作る場合にも、DomainとSimulation Engineを再利用できるようにする。


3. アーキテクチャ原則
3.1 Data-driven
計算の仕組みはコード、経済の性格と調整値は設定データに分離する。係数、ラグ、閾値、イベント確率、国家初期値、専門家プロフィール、表示文言をコードへベタ書きしない。


3.2 Deterministic
Engineはブラウザ時刻、Math.random、DOM、IndexedDB、Reactへ依存しない。外部状態、乱数Provider、Config Snapshotを明示的に受け取り、新しい状態と因果ログを返す。


3.3 Ports and Adapters
DomainとEngineを中心に置き、Web UI、IndexedDB、Web Worker、将来のNative UIやAI Providerを外側のAdapterとする。外側から内側へ依存し、内側から外側を参照しない。


3.4 Explainable
主要指標の変化はCausalContributionとして記録し、政策プレビュー、専門家、国家ビュー、教育、Nation Voice、国家史は同じ結果と同じ因果参照から派生させる。説明専用の隠れた経済計算を持たない。


3.5 Versioned
Engine、Model、Save、Content、RNGを独立してバージョン管理し、進行中ゲームは開始時のModel Snapshotを保持する。


4. 推奨技術構成
・Node.js: 開発・CIのLTS版
・Package manager: npm workspaces
・Web: React + TypeScript + Vite
・PWA: vite-plugin-pwa相当
・UI session state: Zustand
・Schema validation: Zod
・Persistence: IndexedDB。Web側AdapterではDexie等を利用してよいがDomain/Engineは依存しない。
・Tests: Vitest + Testing Library + Playwright + axe-core
・Worker: Web Worker。offline batch、preview、headless相当の重い計算をUI threadから分離する。
・Build output: 静的ファイルのみ。Xserverへdistを配置する。


5. リポジトリ構成
npm workspacesを利用し、Webアプリと再利用対象を物理的に分離する。


apps/
  web/
    src/
      application/
      infrastructure/
        persistence/
        clock/
        worker/
      store/
      ui/
      pwa/
      devtools/
    public/
    vite.config.ts


packages/
  domain/
    src/
      state/
      policy/
      event/
      version/
      errors/
      invariants/


  simulation-engine/
    src/
      api/
      versions/
        v1/
      economy/
      policies/
      events/
      effects/
      causal/
      evaluation/


  model-config/
    src/
      schemas/
      loader/
    data/
      models/
      nations/
      policies/
      events/
      scenarios/
      experts/
      tuning/


  advisor-core/
    src/
      contracts/
      rule-based/
      templates/


tests/
  e2e/
  fixtures/
  golden/
  performance/


scripts/
  validate-content/
  simulate/
  export-balance/


6. 依存方向
許可する主な依存:
web ui -> web application -> domain / simulation-engine public API
web infrastructure -> domain contracts
simulation-engine -> domain
model-config -> domain
advisor-core -> domain と engineが返した公開Result型


禁止する依存:
simulation-engine -> React / DOM / IndexedDB / Date.now / Math.random
domain -> Web API
ui -> simulation-engine内部実装
ui -> IndexedDB直接アクセス
model-config -> 実行可能な任意式
advisor-core -> GameStateを書き換える処理


ESLint、tsconfig、package exportsで境界を機械的に検査する。


7. Simulation Engine公開契約
代表API:
tick(input)
runTicks(input)
previewPolicy(input)
evaluateGame(input)
replay(input)
validateState(input)


すべてのAPIは入力を破壊しない。tickは1計算ステップを処理し、TickOutputとして次状態、因果ログ、診断、更新済みRNG状態を返す。


時間粒度をmonthへ固定した関数名だけに依存しない。内部標準は月次で開始するが、ClockConfigでsimulationStepとpolicyCycleを保持する。MVPのsimulationStepは1 month、policyCycleは3 monthsとする。将来step変更を行う場合はEngine Version更新と互換性テストを必須にする。


8. 時間と放置進行
ClockConfig例:
simulationStep = month
policyCycleSteps = 3
realSecondsPerStep = 300
offlineMaxSteps = 設定値


Web側Clock Adapterが壁時計経過をstep数へ変換する。Engineは実時刻を読まない。
再開時:
1. lastActiveAtと現在時刻からelapsedを計算する。
2. runStateを確認する。
3. 実行可能step数をClockConfigで算出する。
4. WorkerへrunTicksを依頼する。
5. 危機、イベント選択、終了に到達したらそのstepで停止する。
6. 成功したResultだけを保存する。


9. Model Configとチューニング
Model ConfigはJSONまたは静的TypeScript objectとし、evalやFunctionを使用しない。
少なくとも以下をコードから分離する。
・需要、投資、物価、雇用、為替、財政、信頼の係数
・政策効果、ラグ、effect curve、副作用
・上限、下限、clamp
・外部環境の平均回帰、分散、ショック強度
・イベント条件と確率
・危機、失敗、評価閾値
・国家初期値と構造特性
・ゲーム性のstrength multiplier


モデルpresetを将来追加可能にする。
balanced: MVP既定
realistic: より穏やかな反応
experimental: 調整検証用


本番プレイ中にModel Configを差し替えない。新規ゲーム開始時に必要部分をConfig Snapshotとして保存し、同じゲームは同じModelを使い続ける。


10. 国家の抽象化
NationProfileをEngineとは別データとして定義する。
例:
nationId
displayNameKey
initialEconomy
demographics
industryStructure
tradeStructure
energyStructure
institutions
infrastructure
resourceEndowment
policyConstraints
visualThemeKey


MVPはstandard nationのみを提供する。Engine内に「アステリアだから」という分岐を書かない。国家差はProfile、Scenario、Model modifierから注入する。


11. 専門家アーキテクチャ
ExpertAdvisor contract:
advise(context) -> ExpertAdvice


MVP実装:
RuleBasedExpertAdvisor
・EngineのPreviewOutputとCausalContributionを入力にする。
・専門家ごとの重視指標、語彙、tone、説明順をExpertProfileから取得する。
・専門家を変えても経済数値やEngine結果は変えない。
・同一入力で同一助言を返す。


将来:
LLMExpertAdvisor等を追加可能にする。ただしブラウザへ秘密API keyを埋め込まない。外部AIを利用する場合は別途安全なserver-side proxy等を設計し、MVPの静的Xserver構成とは分離する。


12. UIと国家ビュー
UIはGameStateを直接加工して経済結果を生成しない。Application Selector/ViewModelを介する。
Living NationはNationViewModelのみを描画し、景観オブジェクトを保存データへ持たない。
GDP、失業、輸出、インフラ等から景観段階を導出するが、描画結果からGameStateを変更しない。
アニメーションframeとsimulation tickを分離する。


13. 保存とRepository
PersistenceはRepository contractを介する。
Web MVP:
IndexedDbGameRepository


将来Native:
NativeGameRepository


保存単位には最低限以下を含める。
・gameId
・nationId
・saveSchemaVersion
・engineVersion
・modelVersion
・contentVersion
・rngVersion
・configSnapshot
・rngState
・gameState
・processedCommandIds
・lastActiveAt
・checksumまたは整合性検査情報


UI stateや一時的な描画状態はGame Saveへ混ぜない。


14. バージョニング
独立バージョン:
App Version: リリース全体
Save Schema Version: 保存構造
Engine Version: 計算アルゴリズムと更新順
Model Version: 係数、ラグ、閾値
Content Version: シナリオ、専門家文言、イベント文言、画面content
RNG Version: 乱数アルゴリズム


互換性規則:
・Save Schema変更にはmigrationを必須にする。
・Engineの挙動変更はEngine Versionを更新する。
・経済係数だけの変更は原則Model Versionを更新する。
・文章やExpert Profileだけの変更はContent Versionを更新する。
・進行中ゲームは開始時のModel Snapshotを優先する。
・migration fixtureを旧Save Versionごとに保持する。


15. Xserver配布
MVPは静的SPAとしてbuildする。
・Vite base pathを環境変数またはdeploy configで変更可能にする。
・ルート配下、サブディレクトリ配下のどちらにも配置できる構成にする。
・BrowserRouterを利用する場合はXserver用.htaccessでSPA fallbackを定義する。
・API serverはMVPでは不要。
・Service Workerとasset hashを利用する。
・新バージョン検出時にプレイ中を強制reloadしない。
・deploy手順はnpm ci -> test -> build -> dist uploadを基本とする。
・Xserver固有設定はdeploy/xserverへ隔離し、Engineへ持ち込まない。


16. セキュリティとプライバシー
・ログイン情報や個人資産情報を扱わない。
・MVPは外部AIや外部解析へGameStateを送信しない。
・CSP等の静的サイト向けsecurity headerをXserver側で設定可能にする。
・設定データを実行コードとして評価しない。
・ImportするSave JSONはSchema、サイズ、Versionを検証する。
・開発者画面は本番buildで既定無効とする。


17. テスト戦略
Unit:
Domain invariants、Engine各式、Config schema、RNG、Advisor


Golden:
同一seed、同一入力、同一Versionのstateと因果ログ


Integration:
Policy -> ScheduledEffect -> tick -> report
Save -> reload -> resume
offline batch -> sequential ticks equivalence
migration


E2E:
開始 -> 政策 -> preview -> commit -> 進行 -> 報告 -> 保存 -> 再開


Batch:
政策なしbaseline、代表戦略、複数seed、8年・30年


Architecture test:
・Engineからbrowser API import禁止
・UIからengine internal import禁止
・Math.random / Date.nowのEngine利用禁止
・Config hard-codeの検出対象を定義


18. Codex実装ルール
・Issue単位で実装し、無関係なrefactorを混ぜない。
・最初にpublic contractとtestを作り、その後に実装する。
・Engine変更PRとModel tuning PRを分ける。
・新しい係数はModel Configへ追加し、Engineへ数値を直書きしない。
・保存形式変更時はmigration testを同時追加する。
・UIはpublic Engine API以外をimportしない。
・専門家、国家ビュー、教育機能はGameStateやPreviewOutputから派生させ、別の経済ロジックを持たない。
・Xserver配布可否をIssue 1から継続的に確認する。


19. Architecture Decision Records
ADR-001: Xserver上の静的PWA、MVPバックエンドなし。
ADR-002: npm workspacesでWebと再利用Engineを分離。
ADR-003: Pure TypeScript deterministic Simulation Engine。
ADR-004: Data-driven Model Config。
ADR-005: IndexedDBをRepository Adapter経由で利用。
ADR-006: Web Workerでpreview/offline batchを実行。
ADR-007: seed付き用途別RNG stream。
ADR-008: NationProfileで複数国家拡張。
ADR-009: ExpertAdvisor Providerを交換可能にする。
ADR-010: Engine/Model/Save/Content/RNGを独立Version管理。
ADR-011: 月次を既定とするがClockConfigで時間設定を外出し。
ADR-012: Living NationはViewModel派生でEngineへ逆流しない。
ADR-013: 政策入力と指標は安定IDと設定定義を介して追加する。政策の実行処理は型別Registryへ明示登録し、未実装型は起動時に拒否する。指標の値は検証済みGameState参照または登録済み純粋Selectorから読み、計算式をJSONへ埋め込まない。詳細な実装契約と追加手順は `docs/08-extension-architecture.md` を参照する。

20. 実装開始ゲート
CodexでIssue 1へ着手する前に、次を満たす。
・workspace構成と依存方向がIssue 1に記載されている。
・VersionTupleの項目名がIssue 2/3に反映されている。
・ClockConfigの外出しがIssue 2/6/16に反映されている。
・NationProfileの境界がIssue 2/3に反映されている。
・ExpertAdvisor contractがIssue 19に反映されている。
・Xserver build/deploy smokeがIssue 1/30に反映されている。

## 追補: 任意のAI Layer（2026-09-22）

この追補は上記MVPの「外部AIなし」という初期方針を、後方互換の任意機能として拡張する。AIを有効にしない配布・オフライン利用では従来の静的PWAがそのまま動く。ゲームの完成度や保存・再現性はAIに依存しない。

- **Game Core**: Domain、Simulation Engine、Model Config、政策・イベント・時計・国家ビュー・保存。GDPや物価を含む全結果、因果寄与、通常ニュースを決定する。AIへ依存しない。
- **AI Layer**: `packages/advisor-core` に読み取り専用の `NationFacts` / `CauseFact`、AIProvider、Mock、出力検証、ニューステンプレート、ニュースキャッシュを置く。Web InfrastructureはHTTP Adapterを持つ。専門家・自由入力・特別報道・国家史は利用者操作時のみ呼び出す。
- **サーバー境界**: ブラウザ→同一オリジンのXserver PHP `/api/ai.php`→OpenAI Responses API。サーバーにのみキーとモデルを設定する。PHP経路は任意で、ゲームの経済計算や時間進行を担当しない。
- **データ境界**: EngineのCausalContributionから許可済み指標と最大18件の寄与を投影する。AI応答は助言・表示文または政策候補に限定し、GameState、ConfigSnapshot、TickOutputを変更しない。政策候補の確定には既存Policy Engineでの検証、プレビュー、プレイヤーの承認が必要。
- **保存境界**: AI文はゲームの必須保存形式、command列、replay同値性に含めない。通常ニュースと決定論的国家史の基礎記録は同一seedで再現する。AI文は表示用キャッシュであり、変更時にsaveSchemaVersionを上げない。
- **失敗境界**: Timeout、schema不一致、API制限時は機能別フォールバックを返す。通常ニュースとゲーム進行はローカルで継続する。

ADR-013: 既存静的PWAを維持しつつ、任意のXserver PHP proxyで読み取り専用AI説明を提供する。外部AIは決定論的replayの対象外とし、プロンプトと単価はサーバー側の版付きデータとして管理する。
