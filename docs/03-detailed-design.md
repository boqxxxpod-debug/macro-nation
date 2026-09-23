# Synchronized specification

> Source: Macro_Nation_MVP_Detailed_Design_v1.1
> Synced: 2026-09-22
> Repository copy for Codex implementation. The private Drive URL/ID is intentionally not stored because this repository is public.

---

MACRO NATION MVP 詳細設計書
Codex 実装およびテスト用
本書は企画書と要件定義書を、リポジトリ作成、実装、テストへ直接移せる詳細設計へ落とし込む。最重要方針は、UIから独立した決定論的シミュレーションエンジン、設定データによる調整、月次tick単位の原子的保存、すべての結果を説明できる因果ログである。
Codexは本書のモジュール境界、型、処理順、入出力契約、テスト対応表を実装上の基準とする。ゲームバランス係数と表示文言は初期値であり調整対象だが、状態遷移、再現性、保存整合性、オフライン進行、受入条件はMVPの固定仕様として扱う。
0 アーキテクチャ基準 v1.0
本版から、システム構造に関する最上位の基準を「Macro_Nation_Architecture_Design_v1.0」とする。本書とアーキテクチャ設計が競合する場合はアーキテクチャ設計を優先する。ゲーム要件、経済式、画面要件は本書を引き続き基準とする。


確定事項
・Xserverへ静的SPA/PWAとして配布し、MVPではバックエンド、ログイン、クラウドセーブを持たない。
・npm workspacesでWebアプリと再利用可能なdomain/simulation-engine/model-config/advisor-coreを物理分離する。
・Simulation EngineはPure TypeScriptとし、React、DOM、IndexedDB、ブラウザ時計、Math.randomへ依存しない。
・基本計算単位は月次とするがClockConfigへ外出しし、policyCycleも設定値にする。
・国家固有値はNationProfile/Scenario/Model Configから注入し、Engineに国家名固有の分岐を置かない。
・専門家はExpertAdvisor contractを介し、MVPはRuleBasedExpertAdvisorとする。専門家は数値結果を変更しない。
・Engine、Model、Save、Content、RNGを独立Versionとして扱う。configVersionは配布ConfigPack全体の版として併存可能とする。
・IndexedDBはRepository Adapter経由でのみ利用し、UIやEngineから直接触れない。
・Xserver固有の.htaccessやbase path設定はdeploy/xserverへ隔離する。


目次
1. 文書の位置付けと設計方針
2. 確定する技術判断
3. システム全体構成
4. リポジトリ構成
5. ドメインモデル
6. 設定データ設計
7. シミュレーションエンジン設計
8. 政策システム設計
9. イベントとシナリオ設計
10. プレビューとレポート設計
11. オフライン進行とWorker設計
12. 保存とバージョン管理設計
13. 画面と状態遷移設計
14. PWA 非機能 セキュリティ設計
15. エラー処理と診断設計
16. テスト設計
17. 要件追跡
18. Codex実装計画
19. 付録
1 文書の位置付けと設計方針
1 1 目的
本書の目的は、企画の意図を守りながら、実装担当者が追加判断を最小限にしてMVPを構築できる状態をつくることである。対象は架空国家アステリア共和国、6産業、主要9指標、5政策系統、3シナリオ、12イベントである。実在経済を予測する機能、ログイン、クラウドセーブ、サーバー側常時計算は対象外とする。
1 2 優先順位
1. 同一入力で同一結果になる再現性を最優先する。
2. 結果の変化量と因果ログが一致する説明可能性を守る。
3. ゲーム状態の破損や重複tickを防ぐ。
4. 政策の時間差と副作用が理解できる遊びを成立させる。
5. スマートフォンで短時間に判断できるUIを作る。
6. 最後に演出と視覚表現を追加する。
1 3 固定仕様と調整仕様
1 4 詳細設計で補う事項
選択を必要とするイベントが発生した月は runState を awaitingEvent とし、選択完了まで進行を停止する。これはイベント未選択のまま次月を計算できないための実行上の補足である。
予約政策のコストは確定時に予約枠として拘束し、発動時に実消費へ振り替える。これにより予約後の資源不足で発動不能になる状態を防ぐ。
市場向け説明機能は feature flag を持つP1機能とし、初期MVPでは無効を既定値とする。
効果音 BGM イラスト 正式ロゴ 公開URLは実装骨格から分離し、MVP完成条件に含めない。
係数と初期値は本書の初期実装セットで開始し、自動実行と少人数テスト後に configVersion を更新して確定する。
2 確定する技術判断
3 システム全体構成
3 1 論理構成
React UI
  -> Application commands and selectors
      -> Game repository and UI store
          -> Engine API pure TypeScript
          -> Persistence IndexedDB
          -> Worker client
Worker
  -> Engine API
  -> Config snapshot
  -> Persistence checkpoint for offline run
Service Worker
  -> App shell cache
  -> Version update notification
engineはReact、IndexedDB、ブラウザ時刻、DOMへ依存しない。外部入力、乱数状態、現在状態、設定を明示的に受け取り、新しい状態とログを返す。UIはコマンドを発行し、成功結果だけを表示状態へ反映する。
3 2 依存方向
3 3 実行モード
4 リポジトリ構成
npm workspacesを採用し、Web固有コードと将来再利用するコアを分離する。


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
      versions/v1/
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
  simulate/
  validate-content/
  export-balance/


依存方向は web UI -> application -> public contracts、simulation-engine -> domain を基本とする。UIからsimulation-engine内部、UIからIndexedDB、simulation-engineからbrowser APIへの直接依存を禁止し、ESLint、tsconfig、package exportsで検査する。


5 ドメインモデル
5 1 数値単位
金額を実在通貨で持たず、基準月次名目GDPを100とする。初期の年間名目GDPは概ね1200model unitとなり、債務比率90パーセントなら政府債務ストックは約1080となる。画面では比率や指数を中心に表示する。
5 2 中核型
type RunState =
  | 'running' | 'paused' | 'calculating'
  | 'awaitingEvent' | 'crisisStopped'
  | 'completed' | 'failed';
interface GameState {
  gameId: string;
  slotId: 1 | 2 | 3;
  scenarioId: 'SCN-01' | 'SCN-02' | 'SCN-03';
  difficulty: 'intro' | 'standard' | 'expert';
  monthIndex: number;
  tickSequence: number;
  runState: RunState;
  economy: EconomyState;
  policies: PolicyBook;
  effects: ScheduledEffect[];
  events: EventState;
  resources: GovernmentResources;
  rng: RngBundle;
  crisisCounters: Record<string, number>;
  history: HistoryIndex;
  clock: ClockState;
  versions: VersionTuple;
  configSnapshot: ConfigSnapshot;
}
interface VersionTuple {
  saveSchemaVersion: string;
  engineVersion: string;
  configVersion: string;
  rngVersion: string;
}
5 3 EconomyState
interface EconomyState {
  indices: {
    realGdp: number; cpi: number; fx: number;
    nominalWage: number; realHouseholdIncome: number;
    potentialGdp: number; importPrice: number;
  };
  rates: {
    unemployment: number; policyRate: number; marketRate: number;
    expectedInflation: number; foreignRate: number;
  };
  flows: {
    consumption: number; investment: number; governmentConsumption: number;
    publicInvestment: number; exports: number; imports: number;
    taxRevenue: number; primarySpending: number; interestPayment: number;
    currentAccount: number; capitalFlow: number;
  };
  stocks: { governmentDebt: number; foreignReserves: number };
  sentiment: {
    consumerConfidence: number; businessConfidence: number;
    policyTrust: number; support: number; inequality: number;
    speculationPressure: number;
  };
  institutions: {
    politicalCapital: number; implementationCapacity: number;
    centralBankIndependence: number; taxCapacity: number;
    procurementTransparency: number;
  };
  industries: Record<IndustryId, IndustryState>;
  infrastructure: Record<InfrastructureId, number>;
  external: ExternalState;
}
5 4 状態の不変条件
tickSequenceは成功したtickごとに1増え、monthIndexと同じ増分を持つ。チュートリアル高速進行でも省略しない。
人口 GDP 価格指数 外貨準備など非負項目は0未満にならない。率と点数は設定された上下限内に収める。
active reserved completed cancelledの政策IDは重複しない。
ScheduledEffectの月別weight合計は定義された総weightと許容誤差1e-10以内で一致する。
同じindicatorIdの寄与度合計は丸め前totalDeltaと絶対誤差1e-9または相対誤差1e-8以内で一致する。
runStateがrunningのときだけ壁時計経過をゲーム月へ変換する。
awaitingEvent crisisStopped completed failedではオフライン経過を加算しない。
5 5 コマンドと冪等性
interface GameCommand<TPayload> {
  commandId: string;       // UUID generated once by UI
  gameId: string;
  expectedTickSequence: number;
  issuedAtClientMs: number;
  type: CommandType;
  payload: TPayload;
}
type CommandResult<T> =
  | { ok: true; value: T; committedTickSequence: number }
  | { ok: false; error: DomainError };
保存済みprocessedCommandIdsへ直近100件を保持する。同じcommandIdは成功結果を再利用し、ブラウザの戻る、二重タップ、再送で政策確定やイベント選択が重複しない。expectedTickSequenceが一致しない場合はSTALE_STATEとして拒否し、最新状態を再読込する。
6 設定データ設計
6 1 ConfigPack
interface ConfigPack {
  configVersion: string;
  compatibleEngineVersion: string;
  model: ModelCoefficients;
  limits: StateLimits;
  effectCurves: Record<string, number[]>;
  policies: PolicyDefinitionMap;
  events: EventDefinition[];
  scenarios: ScenarioDefinition[];
  difficulties: DifficultyDefinitionMap;
  evaluation: EvaluationDefinition;
  crisisRules: CrisisRule[];
  text: TextCatalog;
}
起動時にZodで全件検証し、ID重複、参照先欠落、期間不整合、確率範囲外、weight不一致を追加検証する。
新規ゲーム開始時に必要部分をconfigSnapshotへ正規化して保存する。進行中ゲームは後から配信された係数を参照しない。
設定ファイルはJSONまたはTypeScriptの静的オブジェクトとして保持し、実行可能な式や任意コードを含めない。
条件と効果は限定DSLで表現し、evalやFunctionコンストラクタを使用しない。
6 2 シナリオ初期実装値
以下はengineと画面を接続するための暫定値であり、限定公開前に自動実行で再調整する。率は画面表示値で記載する。全シナリオの内部初期値はJSON fixtureとして固定し、configVersion 0.1.0に紐付ける。
6 3 外部環境
各シナリオは月別baselineと確率過程パラメータを持つ。baselineは海外成長率、海外金利、資源価格、相手国関係、災害警戒を定義する。liveではexternal用途の乱数streamからAR1型の偏差を加える。previewでは乱数を使わず、悲観 基準 楽観の分位偏差を加える。
externalDeviation[t]
  = persistence * externalDeviation[t - 1]
  + shockScale * deterministicNormal(rngStream);
externalValue[t]
  = baseline[t] + externalDeviation[t] + activeEventEffects[t];
6 4 初期係数の管理
7 シミュレーションエンジン設計
7 1 公開API
tick(input: TickInput): Result<TickOutput, EngineError>
runTicks(input: RunTicksInput): Result<RunTicksOutput, EngineError>
previewPolicy(input: PreviewInput): Result<PreviewOutput, EngineError>
applyCommand(input: CommandInput): Result<CommandOutput, DomainError>
evaluateGame(input: EvaluationInput): EvaluationOutput
validateState(state: GameState, config: ConfigSnapshot): ValidationIssue[]
replay(log: ReplayPackage): Result<ReplayOutput, ReplayError>
すべての関数は引数以外の状態を読まない。tickは入力状態を変更せず、新しい状態を返す。開発ビルドではdeepFreezeした入力を渡し、破壊的変更をテストで検出する。
7 2 月次tickの原子性
1. 入力stateとconfigの版および不変条件を検証する。
2. 作業用draftへ必要な値だけを複製し、tickContextを生成する。
3. 当月に発動する予約政策を有効化し、予約資源を実消費へ振り替える。
4. 外部環境を更新する。
5. 効果キューとイベント効果から当月分を取得する。
6. 消費 投資 政府支出 輸出入を更新する。
7. 実質GDP 潜在GDP 需給ギャップ 6産業を更新する。
8. CPI 輸入物価 賃金 失業を更新する。
9. 税収 歳出 利払い 財政収支 政府債務を更新する。
10. 為替 資本移動 外貨準備 市場信認を更新する。
11. 家計実質所得 格差 支持 政策信頼 政治資本を更新する。
12. イベント 危機 失敗 完了 実績を判定する。
13. 因果寄与を照合し、月次snapshotと新しい乱数状態を確定する。
14. 最終検証に成功した場合だけTickOutputを返す。失敗時は入力stateを保持してENGINE_TICK_FAILEDを返す。
7 3 基本計算
年間率はannualRateToMonthlyで月率へ変換する。内部では小数を使用し、画面でのみ丸める。需要構成は基準シェアを持つ指数として更新し、実質GDPは構成要素の恒等式から再計算する。
monthlyRate = pow(1 + annualRate, 1 / 12) - 1
consumptionGrowth =
  baselineConsumption
  + incomeCoefficient * realIncomeGrowth
  - rateCoefficient * realRateGap / 12
  - unemploymentCoefficient * unemploymentGap / 12
  - inflationConcernCoefficient * inflationTargetGap / 12
  + taxAndTransferEffects
  + scheduledEffects
  + randomError
investmentGrowth =
  baselineInvestment
  + demandOutlookCoefficient * outputGap / 12
  + productivityCoefficient * potentialGrowth / 12
  - rateCoefficient * realRateGap / 12
  - uncertaintyCoefficient * uncertainty / 12
  + corporateTaxEffects
  + scheduledEffects
  + randomError
realGdp =
  cShare * consumption
  + iShare * investment
  + gShare * governmentConsumption
  + xShare * exports
  - mShare * imports
初期の構成シェアは消費0.60、投資0.18、政府0.20、輸出0.25、輸入0.23とし、純合計を1.00にする。各シナリオで変更できる。指数更新はpreviousValue × 1 + growthとし、各growth要因をpreviousValue倍することで寄与度を厳密に合計できる。
7 4 供給 物価 雇用
potentialGrowth =
  baselineProductivity
  + infrastructureContribution
  + educationContribution
  + energyAndLogisticsContribution
  - disasterDamage
  - capacityLoss
outputGap = (realGdp / potentialGdp) - 1
inflationMonthly =
  inflationPersistence * previousInflationMonthly
  + demandPressureCoefficient * outputGap / 12
  + importPriceCoefficient * importPriceInflationMonthly
  + expectationCoefficient * expectedInflation / 12
  + supplyConstraintEffects
  + randomError
unemploymentDelta =
  adjustmentCoefficient * (naturalUnemployment - unemployment)
  - okunCoefficient * (annualizedGdpGrowth - potentialGrowthAnnual) / 12
  + industryReallocationEffects
  + employmentEffects
失業へのGDP効果はScheduledEffectとして3から9か月へ分配し、同月に全量を反映しない。期待インフレは前月期待、実績物価、政策信頼、中央銀行独立性から適応的に更新する。
7 5 財政 為替 信頼
taxRevenue =
  incomeTaxBase * incomeTaxRate
  + corporateProfitBase * corporateTaxRate
  + consumptionBase * consumptionTaxRate
  + tariffRevenue
  - lowIncomeCreditCost
primaryBalance = taxRevenue - primarySpending
interestPayment = debtStock * marketRateAnnual / 12
debtStockNext = debtStock - primaryBalance + interestPayment
fxLogChange =
  rateGapCoefficient * (foreignRate - domesticMarketRate) / 12
  - currentAccountCoefficient * currentAccountToGdp / 12
  + trustCoefficient * (trustTarget - policyTrust) / 12
  + speculationCoefficient * speculationPressure / 12
  + interventionEffect
  + randomError
policyTrustDelta =
  priceStabilityScore
  + employmentScore
  + consistencyScore
  + promiseScore
  + institutionRespectScore
  - crisisPenalty
  - reversalPenalty
為替指数は上昇ほど自国通貨安である。自国通貨買い介入はfxLogChangeへ負の寄与を与える。政府債務比率は債務stockを直近12か月名目GDP合計で割り、財政収支は直近12か月の合計を同じ分母で割る。
7 6 6産業
産業ごとにproductionIndex、employmentShare、capacityIndex、importDependency、priceIndexを持つ。集計GDPと産業生産の差はindustryResidualとして診断ログに残し、許容範囲を超えた場合は設定テストを失敗させる。
7 7 数値安定性と因果ログ
各更新関数は値だけでなくContributionDraftの配列を返す。最終値へ上限下限を適用した差分はsourceType inertia、sourceId stability clampとして寄与へ追加する。これにより安全処理で切り捨てた場合もtotalDeltaと寄与合計が一致する。
interface CausalContribution {
  indicatorId: IndicatorId;
  beforeValue: number;
  afterValue: number;
  totalDelta: number;
  contributions: Array<{
    sourceType: 'policy' | 'event' | 'external' | 'inertia' | 'random';
    sourceId: string;
    labelKey: string;
    delta: number;
    confidence: 'high' | 'medium' | 'low';
  }>;
}
NaN Infinity 0除算はclampせずtick失敗とする。
上限下限到達はtick成功とするがDiagnosticsへclamp前値、原因、影響元を残す。
表示値は丸めたコピーであり、次tickの入力へ使用しない。
前年比は12か月履歴がない場合に未算出として表示し、推測値を作らない。
7 8 乱数設計
Math randomは使用しない。rootSeed文字列をUTF8でFNV1a派生し、streamIdとrngVersionを加えてxoshiro128ssの4個のuint32状態を初期化する。ビット演算とMath imulだけを使い、ブラウザとNodeで同じgolden vectorを検証する。
interface RngStreamState {
  streamId: string;
  state: [number, number, number, number];
  drawCount: number;
}
interface RngBundle {
  rootSeed: string;
  rngVersion: 'xoshiro128ss-v1';
  streams: Record<string, RngStreamState>;
}
stream examples
  external global
  error consumption
  error investment
  error inflation
  error fx
  event EVT-01 through EVT-12
  policy intervention
各イベントを別streamにすることで、別イベントの追加が既存イベントの抽選列を変えない。previewはliveのRngBundleを更新せず、optimistic base pessimisticの固定分位を使用する。
8 政策システム設計
8 1 共通ライフサイクル
draft -> previewed -> committed -> reserved -> active -> completed
                                      |          |
                                      -> cancelled
                                                 -> terminated
同一四半期のcommit change cancelは合計3件までとする。税制パッケージは複数レバーでも1件と数える。
commit時にPolicyDecisionとResourceReservationを同一トランザクションで保存する。
開始は即時、次四半期、2四半期後、3四半期後から選ぶ。発動月は四半期先頭月へ正規化する。
cancelは発動前だけ可能で、予約資源を返却するが当四半期の政策枠を1件使う。
active政策の途中終了はpolicy定義の終了コストを即時に適用し、未実施費用を停止する。
相反政策は拒否せず、効果の相殺とconsistency penaltyを因果ログへ記録する。
8 2 資源予約
availableResource = currentResource - sum(activeReservations)
commit validation
  required politicalCapital <= available politicalCapital
  required implementationCapacity <= available implementationCapacity
  required foreignReserves <= available foreignReserves
  required immediateBudget <= available discretionaryBudget
activation
  release reservation
  deduct actual cost
  create active policy state and ScheduledEffects
公共事業の継続支出は将来予算の法的拘束ではなく、財政見通しへ反映する。外貨準備、政治資本、実施能力、開始時一括費用だけを予約対象とする。発動時の実値はcommit時予約値を使用し、途中の価格変化で予約不足を発生させない。
8 3 政策データ型
type PolicyDecision =
  | InterestRateDecision
  | TaxPackageDecision
  | PublicWorksDecision
  | TariffDecision
  | FxInterventionDecision;
interface PolicyBase {
  policyId: string;
  type: PolicyType;
  decidedMonth: number;
  activationMonth: number;
  endMonth?: number;
  status: PolicyStatus;
  slotQuarter: number;
  costs: PolicyCosts;
  reservationId?: string;
  sourceCommandId: string;
}
8 4 政策別処理
8 5 ScheduledEffect
interface ScheduledEffect {
  effectId: string;
  sourceType: 'policy' | 'event';
  sourceId: string;
  targetPath: EffectTarget;
  operation: 'addDelta' | 'addRate' | 'multiply';
  startMonth: number;
  endMonth: number;
  curveId: 'instant' | 'ramp' | 'hump' | 'decay' | string;
  weights: number[];
  baseStrength: number;
  modifierIds: string[];
  uncertainty: { low: number; high: number };
  role: 'primary' | 'sideEffect';
  labelKey: string;
}
効果はpolicy handlerが発動時に生成する。毎月のengineは汎用queueから対象月のweightを読む。modifierは許可されたIDを純粋関数へ解決し、文字列式を実行しない。終了済み効果は履歴参照に必要なIDだけを残し、詳細はsnapshot側へ圧縮する。
8 6 政策確定処理
1. draftスキーマ、値範囲、シナリオでの利用可否を検証する。
2. 四半期枠と予約可能期間を検証する。
3. 必要資源と既存予約を照合する。
4. 既存政策との相互作用を算出し、警告を返す。禁止はしない。
5. previewHashと現在stateHashを照合し、古いプレビューなら再試算を要求する。
6. PolicyDecision、ResourceReservation、processedCommandIdを原子的に保存する。
7. 成功後に画面状態を更新し、自動保存完了を通知する。
9 イベントとシナリオ設計
9 1 条件DSL
type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
Warning: truncated output (original token count: 8503)
Total output lines: 500

  | { metric: MetricRef; op: 'lt'|'lte'|'gt'|'gte'|'between'; value: number | [number, number] }
  | { trend: MetricRef; months: number; op: 'gt'|'lt'; value: number }
  | { activePolicy: PolicyType; minimumMonths?: number }
  | { cooldownElapsed: { eventId: string; months: number } };
月次tickのイベント判定では定義をeventId順に評価する。発生条件を満たしたイベントだけhazardを計算し、イベントごとの独立streamで抽選する。1か月に新規majorイベントは1件、同時activeイベントは2件を初期上限とし、シナリオ設定で変更できる。
9 2 兆候と発生
1. leading conditionを毎月評価し、severity 1から3の兆候を生成する。
2. 大事件は発生可能になる少なくとも6か月前から一つ以上の兆候を出せる定義にする。
3. 基本確率へ政策 制度 備蓄 財政余力 外部状態modifierを乗算し0から1へclampする。
4. イベント固有streamから1回だけdrawし、発生可否を決める。
5. 選択が必要な場合はEventOccurrenceを保存してawaitingEventへ遷移し、当月終了時点で停止する。
6. 選択不要イベントは即時効果と遅延効果を追加し、同じtickを完了する。
9 3 イベント選択
イベント選択肢は5政策系統とは別のEventChoiceEffectで実装する。給付、流動性支援、対話、備蓄放出などMVP政策画面にない一時対応も、イベント固有効果として表現できる。選択は1回だけ確定し、commandIdで冪等化する。確定後に即時効果とScheduledEffectを作成し、因果ログへevent sourceとして保存する。
9 4 シナリオ構造
interface ScenarioDefinition {
  id: ScenarioId;
  titleKey: string;
  durationMonths: 48 | 96;
  startYear: number;
  startMonth: number;
  initialState: InitialEconomyState;
  externalBaseline: MonthlyExternalBaseline[];
  enabledPolicies: PolicyType[];
  enabledEvents: EventId[];
  crisisRules: CrisisRule[];
  failureRules: FailureRule[];
  completionTargets: EvaluationTargetSet;
  tutorial?: TutorialDefinition;
}
SCN01の最初の12か月はTutorialDefinitionが操作手順だけを制御する。計算値の救済補正は持たない。各ステップで必要説明と選択が完了した後、同じrunTicks APIへcount 3を渡して次の四半期まで進める。
9 5 危機 失敗 完了
失敗条件の継続月数counterは毎月更新し、条件達成月末にfailedへ遷移する。
危機警戒は毎月算出し、四半期末に重大状態ならcrisisStoppedへ遷移する。
危機停止後の緊急政策は最大3件、通常政治資本コストの1.25倍、通常四半期枠は消費しない。
awaitingEventとcrisisStoppedが同時候補になった場合は、先に発生したイベント選択を完了し、その結果を含めて危機判定を行う。
monthIndexがdurationMonthsへ到達した時点で、failedでなければcompletedへ遷移する。
9 6 5軸評価
各入力は設定されたbreakpoint間を線形補間して0から100へ正規化する。軸内加重を合計した後、要件定義書の総合基礎点と最低軸上限を適用する。Fは失敗時のみであり、失敗していないDと区別する。
baseScore = living * 0.30 + growth * 0.25 + stability * 0.20
          + sustainability * 0.15 + trust * 0.10
scoreCap = 60 + min(living, growth, stability, sustainability, trust) * 0.40
finalScore = min(baseScore, scoreCap)
10 プレビューとレポート設計
10 1 政策プレビュー
previewは現在stateを複製し、draft政策を仮確定して12tick進める。将来のlive乱数を消費せず、同じengineへPreviewRandomProviderを注入する。悲観 基準 楽観は誤差項と外部偏差をそれぞれ下位 基準 上位分位へ固定する。イベントは既に確定したものだけを反映し、未発生イベントは期待値の外部リスクとしてレンジへ含める。
interface PreviewOutput {
  stateHash: string;
  draftHash: string;
  activationMonth: number;
  peakMonthRange: [number, number];
  endMonth?: number;
  indicators: Array<{
    indicatorId: IndicatorId;
    month3: RangeValue;
    month6: RangeValue;
    month12: RangeValue;
  }>;
  primaryEffects: PreviewEffect[];
  sideEffects: PreviewEffect[];
  costs: PolicyCosts;
  interactions: PolicyInteraction[];
  cancellationRule: string;
}
プレビューは予測ではなくゲーム内モデルの試算であることを表示する。stateHashが変わった後の確定は拒否し、再プレビューする。Worker処理はcancel可能とし、新しい入力が来たら前回結果を破棄する。
10 2 3行報告
1. 前回確認snapshot以降の主要9指標deltaを標準化し、絶対値上位を抽出する。
2. 良化候補から1件、悪化候補から1件を選ぶ。該当候補が閾値未満なら落ち着いた中立文を使う。
3. 将来6か月の兆候、効果キュー、危機距離から注意事項を1件選ぶ。
4. 各行へindicatorId、snapshotMonth、topContributionIdsを紐付ける。
5. 文はTextCatalogのテンプレートで端末内生成し、外部AI APIは使用しない。
10 3 レポート
月次seriesは全点を保存し、四半期 年次表示はselectorで集約する。
グラフへ政策の決定 発動 最大効果 終了、イベント発生をannotationとして重ねる。
初期表示は寄与絶対値上位3件、展開時は全件を表示する。
新聞見出しは数値やログの代替にしない。headlineKeyと根拠snapshotを一緒に保存する。
履歴が長い場合は表示解像度に応じて描画点を間引くが、元データは変更しない。
11 オフライン進行とWorker設計
11 1 壁時計の扱い
elapsedMs = max(0, nowMs - lastProcessedWallClockMs)
totalMs = remainderMs + min(elapsedMs, 8 hours)
tickCount = min(floor(totalMs / 5 minutes), 96)
nextRemainderMs = totalMs - tickCount * 5 minutes
runStateがrunning以外ならtickCountを0とする。
時計が過去へ戻った場合はelapsedMsを0とし、CLOCK_MOVED_BACKWARDを注意ログへ記録する。
8時間超過分は破棄し、後で繰り越さない。
policy編集または確認画面を開いた時点でpause commandを保存してから画面遷移する。
visibilitychangeとpagehideでlastSeenAtを保存するが、正しさは次回起動時の保存値検証に依存する。
11 2 オフライン実行
1. main threadがslotId、expectedTickSequence、nowMsをWorkerへ送る。
2. WorkerがIndexedDBからcurrent世代を読み、版とchecksumを検証する。
3. tickCountを算出し、月次tickを1回ずつ順番に実行する。
4. 各成功tick後にcurrentをpreviousへ移し、新currentとlastProcessedWallClockMsを同一transactionで保存する。
5. 4tickごとまたは250msごとにPROGRESSを通知する。
6. awaitingEvent crisisStopped failed completedに達したら残り時間を破棄して停止する。
7. 終了時に処理月数、停止理由、上位3指標、警告を返す。
8. main threadは最新保存を再読込し、帰還報告を表示する。
計算中もナビゲーションとヘルプ閲覧は可能にするが、ゲーム状態を変更する操作は無効化して進捗を表示する。Workerが異常終了しても、最後にcommit済みのtickから再開する。
11 3 Worker通信
type WorkerRequest =
  | { id: string; type: 'RUN_OFFLINE'; slotId: number; nowMs: number; expectedTick: number }
  | { id: string; type: 'PREVIEW_POLICY'; state: PreviewState; draft: PolicyDraft }
  | { id: string; type: 'RUN_BATCH'; definition: BatchDefinition }
  | { id: string; type: 'CANCEL'; targetId: string };
type WorkerResponse =
  | { id: string; type: 'PROGRESS'; completed: number; total: number }
  | { id: string; type: 'RESULT'; payload: unknown }
  | { id: string; type: 'ERROR'; error: SerializedError };
全メッセージは受信側でZod検証する。PREVIEW_POLICYでは履歴全体を送らず、12か月計算に必要なstateと直近履歴だけを送る。RUN_BATCHはseed範囲とstrategyIdを受け、個別月次履歴を既定では返さず集計と失敗replay packageだけを返す。
12 保存とバージョン管理設計
12 0 独立バージョン
保存には少なくともsaveSchemaVersion、engineVersion、modelVersion、contentVersion、rngVersionを保持する。configVersionはConfigPack全体の配布版として必要に応じて保持する。
saveSchemaVersion変更はmigration必須、Engine挙動変更はengineVersion更新、係数・ラグ・閾値だけの変更はmodelVersion更新、文言・専門家Profile等はcontentVersion更新とする。
進行中ゲームは開始時のConfig Snapshotを優先し、配布後のModel変更で途中結果を変えない。


12 保存とバージョン管理設計
12 1 IndexedDB
12 2 SaveEnvelope
interface SaveEnvelope {
  format: 'macro-nation-save';
  saveSchemaVersion: string;
  engineVersion: string;
  configVersion: string;
  rngVersion: string;
  gameId: string;
  slotId: 1 | 2 | 3;
  revision: number;
  savedAtMs: number;
  payload: GameState;
  checksum: { algorithm: 'sha-256'; value: string };
}
checksumはkey順を固定したcanonical JSONのpayloadからWeb Crypto SHA256で計算する。エクスポート時はenvelope全体をJSONへ出す。インポートはUTF8で5MB以下、ネスト深度50以下、履歴と配列の上限内であることを確認し、Zod、checksum、状態不変条件、対応版をすべて通過してから新しいgameIdとして保存する。
12 3 二世代保存
1. 新envelopeをメモリ上で作成しschemaとstateを検証する。
2. checksumを計算する。
3. IndexedDBのreadwrite transactionを開始する。
4. 既存currentが有効ならpreviousへ複製する。
5. 新envelopeをcurrentへ書く。
6. slotMetaのrevisionと時刻を更新する。
7. transactionをcommitする。途中失敗時は全変更をrollbackする。
起動時はcurrentを先に検証し、失敗した場合だけpreviousを検証する。previousから復旧した場合は新しいcurrentとして書き戻さず、利用者へ復旧通知を表示し、次の正常保存で世代を更新する。
12 4 エンジンと設定の版
engine registryをengineVersionで引ける構造にし、MVPはv1入口だけを実装する。
進行中ゲームは開始時configSnapshotを保存し、配信設定の変更を受けない。
saveSchemaVersion変更には純粋なmigration関数とgolden fixtureを用意する。
engineVersionを跨ぐ結果変更は自動移行しない。互換adapterか旧engineをバンドルできない更新は有効化しない。
Service Workerは新buildをwaitingに置き、全active saveが対応可能と確認した後だけ利用者へ更新を案内する。プレイ中の強制reloadは禁止する。
12 5 自動保存契機
13 画面と状態遷移設計
13 1 ルート
13 2 ゲーム状態遷移
paused <-> running -> calculating -> running
running -> awaitingEvent -> paused or running
running -> crisisStopped -> paused or running
running -> completed
running -> failed
completed and failed are terminal for that gameId
政策編集と最終確認を開く前にrunningからpausedへ保存する。閉じても自動再開せず、元の状態がrunningだった場合だけ再開確認を出す。
calculating中は状態変更コマンドを拒否し、閲覧操作だけ許可する。
awaitingEventではイベント選択、help、reportを許可し、通常政策確定と再開を禁止する。
crisisStoppedでは緊急政策、help、reportを許可し、明示的な再開まで進めない。
ブラウザ戻るでは未確定draftだけ破棄確認し、保存済みコマンドを再実行しない。
13 3 ホーム画面
1. 危機警告を1行表示する。警告がなければ重大な警告なしと明記する。
2. 国民生活 成長 物価 雇用 信頼の5カードを表示する。色に加え矢印、状態語、比較期間を付ける。
3. 帰還時だけ3行報告を先頭付近に表示し、各行から根拠レポートへ遷移する。
4. 政策発動 終了 選挙 シナリオ終了など次の節目を最大3件表示する。
5. 入門では推奨操作を最大3件表示するが、確定ボタンを設けず政策会議へ誘導する。
13 4 政策会議とプレビュー
上部に四半期枠の使用数、残数、次に枠が更新される月を常時表示する。
実施中 予約中 終了予定を状態別に表示し、同一政策の重複を見分けられるIDと開始月を付ける。
最大3案を比較し、効果開始、最大効果、12か月レンジ、副作用、全コスト、相互作用を同じ順序で並べる。
不足時は確定ボタンをdisabledにするだけでなく、不足資源と必要量を文章で示す。
最終確認はcommandIdを生成して一度だけ送信する。保存成功後に完了画面へ進む。
13 5 予算 市場 レポート
13 6 アクセシビリティ
主要操作のタップ領域を44×44 CSS px以上にする。
見出し階層、landmark、label、description、aria liveを意味順に付ける。
政策確定、イベント選択、危機再開後は結果見出しへfocusを移す。
良化 悪化は色だけでなく上昇 低下 安定などの語と形で示す。
prefers reduced motionでは数値遷移、チャート描画、新聞演出を停止する。
360px幅および200パーセント文字拡大で横スクロールを主要操作に要求しない。比較表はカード縦積みに切り替える。
14 PWA 非機能 セキュリティ設計
14 0 Xserver配布
Viteのbuild成果物をXserverへ静的配置する。Vite base pathは環境設定化し、ルート配下・サブディレクトリ配下の双方へ対応する。BrowserRouter採用時はdeploy/xserver/.htaccessでSPA fallbackを提供する。Service Worker更新でプレイ中を強制reloadしない。


14 PWA 非機能 セキュリティ設計
14 1 PWAと更新
app shell、フォント、必須設定、helpをprecacheする。
HTMLはnetwork first with timeout、hash付きJS CSSはcache first、外部API通信は定義しない。
新Service Workerはwaitingとし、プレイ中にskipWaitingしない。
保存成功後の安全な画面で更新可能を表示し、利用者が選んだ場合だけ再読込する。
機内モードでは保存 新規ゲーム 既存ゲーム 終了評価 JSON入出力を完了できる。
14 2 性能予算
14 3 プライバシーと通信
ログイン、氏名、メール、資産、収入、位置情報を扱わない。
分析SDK、広告SDK、外部AI API、外部フォントを含めない。
ゲーム状態とテスト指標を自動送信しない。共有は利用者がJSONを明示的に書き出した場合だけとする。
本番E2EでService Worker更新確認以外の外部requestがないことを検査する。
情報画面に保存先、削除、エクスポート、架空モデルの免責を表示する。
14 4 セキュリティ
Content-Security-Policy
  default-src 'self';
  script-src 'self';
  style-src 'self';
  img-src 'self' data:;
  font-src 'self';
  connect-src 'self';
  object-src 'none';
  base-uri 'self';
  frame-ancestors 'none';
dangerouslySetInnerHTMLを使用しない。利用者入力のseedと表示名はReactのtext nodeとして描画する。
JSON取込は5MB、文字列長、配列長、ネスト深度、数値範囲、ID形式を検証する。
開発者画面はVITE ENABLE DEVTOOLSがtrueの開発buildだけに含め、本番routeとnavigationからコードごと除外する。
exportファイル名は固定接頭辞と安全な日時だけで生成し、利用者文字列を直接使わない。
依存関係のlockfileをcommitし、CIで監査する。ただし監査修正…503 tokens truncated…。
イベント兆候、抽選、awaitingEvent、選択、効果、cooldown、因果ログを通す。
48または96回の逐次tickとoffline Workerの最終SaveEnvelopeをdeep equal比較する。
各tickで保存を故意に中断し、currentかpreviousから正しいtickSequenceへ復旧する。
schema migration前後のfixtureを読み、版とchecksumを再作成する。
Service Worker更新中もactive saveを旧buildで再開できることを確認する。
16 4 自動実行とバランス
scripts simulateはUIを起動せずengine APIを呼ぶ。各戦略は現在状態から政策draftを返す純粋botとして実装する。policyなし、物価安定、雇用需要、財政健全化、成長投資、通貨防衛、保護貿易を最低セットとする。
16 5 CIコマンド
npm run format:check
npm run lint
npm run typecheck
npm run validate:content
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:a11y
npm run simulate:smoke
npm run build
release candidate only
npm run simulate:1000
npm run test:performance
npm run test:offline
17 要件追跡
17 1 機能要件群
17 2 受入条件対応
18 Codex実装計画
18 1 実装単位
18 2 Codex作業規則
1 issueで1つの観察可能な振る舞いを実装し、対応テストを同じ変更に含める。
engineを先に実装し、計算ゲートに合格するまで大規模なUIを追加しない。
係数変更とengine式変更を同じcommitに混在させない。
公開API、型、config schemaを変更した場合は設計上の版とmigration要否を確認する。
golden fixtureの更新は意図した結果変更を説明できる場合だけ行う。失敗を通すために一括更新しない。
UIからDBやengine内部へ直接アクセスする近道を作らない。application commandを追加する。
Math random、Date nowのengine内使用、実行可能な設定式、外部APIへの状態送信を禁止する。
各issue完了時にtypecheck、関連unit、integrationを実行し、節目で全CIを実行する。
性能対応は測定結果を残し、再現性や因果ログを省略する最適化を行わない。
18 3 最初の10 issue
18 4 Pull Request完了条件
要件IDまたは設計節をPR説明に記載している。
受入条件と異常系をテストしている。
型検査、lint、対象テストが成功している。
engine結果を変えた場合はgolden差分と理由を記載している。
設定追加時はschemaと参照整合性検査が成功している。
保存形式変更時はmigration fixtureを追加している。
UI変更時は360px、keyboard、focus、色以外の表現を確認している。
外部通信、個人情報、開発者画面の本番混入がない。
19 付録
19 1 tick擬似コード
function tick(input): Result<TickOutput, EngineError> {
  validateInput(input)
  const before = input.state
  const ctx = createTickContext(before, input.config, input.mode)
  activateReservedPolicies(ctx)
  updateExternalEnvironment(ctx)
  collectScheduledEffects(ctx)
  updateDemandComponents(ctx)
  updateOutputPotentialAndIndustries(ctx)
  updatePricesWagesAndEmployment(ctx)
  updateFiscalState(ctx)
  updateFxCapitalAndReserves(ctx)
  updateHouseholdsTrustAndPolitics(ctx)
  evaluateEventsCrisisFailureAndCompletion(ctx)
  reconcileContributions(ctx)
  const after = finalizeState(ctx)
  validateOutput(after)
  return ok({ state: after, snapshot: ctx.snapshot, diagnostics: ctx.diagnostics })
}
19 2 保存処理擬似コード
async function saveGeneration(slotId, state) {
  const envelope = await buildAndValidateEnvelope(state)
  await db.transaction('readwrite', stores, async () => {
    const current = await getCurrent(slotId)
    if (current && await verify(current)) await putPrevious(slotId, current)
    await putCurrent(slotId, envelope)
    await updateSlotMeta(slotId, envelope)
  })
}
19 3 EventDefinition例
{
  "id": "EVT-11",
  "titleKey": "event.retaliatoryTariff.title",
  "leadingIndicators": [
    { "metric": "external.relation", "op": "lt", "value": 45 },
    { "metric": "policy.tariffAverage", "op": "gt", "value": 0.10 }
  ],
  "condition": {
    "all": [
      { "metric": "policy.tariffAverage", "op": "gte", "value": 0.10 },
      { "cooldownElapsed": { "eventId": "EVT-11", "months": 18 } }
    ]
  },
  "baseMonthlyProbability": 0.02,
  "modifierIds": ["higherTariff", "longDuration", "poorRelations"],
  "choices": ["negotiate", "withdraw", "retaliate"],
  "cooldownMonths": 18
}
19 4 調整時に確定する値
19 5 MVP完成判定
MVPは、P0要件を実装し、AT001からAT022を満たし、3シナリオが終了または失敗まで進み、逐次進行とオフライン進行が一致し、Android 9 RAM4GB級端末で性能基準を満たした時点で完成とする。さらに、1000回自動実行で数値発散と進行不能がなく、初見5人中4人が帰還後1分以内に最大変化要因を説明できることを公開ゲートとする。
20 追加設計の位置付け
設計版 0.2 / 2026年9月22日
本章は要件版0.2のFR-DU、FR-BA、FR-EX、FR-NV、FR-ID、FR-EDを実装するための追補設計である。既存設計と矛盾する場合は本章を優先する。既存の決定論、因果寄与、原子的tick、保存世代管理を壊さず、新しい表示と説明は原則としてGameStateから導出する。
20 1 追加技術判断
20 2 追加モジュール
21 期間と長期シミュレーション設計
21 1 DurationConfig
type DurationMode = 'short' | 'standard' | 'long' | 'ultraLong';
interface DurationConfig {
  id: DurationMode; totalMonths: 48 | 96 | 240 | 360;
  reviewIntervalMonths: 60; structuralIntervalMonths: 120;
  expectedPlayLabelKey: string; learningFocusKeys: string[];
}
interface GameClock { monthIndex: number; endMonth: number; durationMode: DurationMode; }
createGameはscenarioId difficulty durationMode learningMode seed slotIdを1 commandで受ける。
SCN-01はshortを既定値とし tutorial完了後も48か月まで同じengineで進行する。
月次tick完了後にmonthIndexがendMonthへ達したらcompletedへ遷移する。
5年レビューは60 120 180 240 300 360か月で生成し 10年構造更新は120 240 360か月で実行する。
21 2 月次更新順序の追加
既存の予約政策 発動 期限切れを処理する。
外部環境と既存政策から主要経済指標を更新する。
ReactionSnapshotとComboEffectを計算し因果寄与へ統合する。
10年境界の場合は人口 技術 産業構成 インフラ老朽化を更新する。
危機 イベント 失敗 シナリオ完了を判定する。
5年境界の場合はReviewSnapshotとHistoryEntryを生成する。
保存前に不変条件とdelta reconciliationを検証する。
構造更新は同じtickを再実行しても重複しないよう appliedMilestonesにキーを保存する。キーは gameId:milestoneType:monthIndex とし commandIdと同様に冪等化する。
21 3 無操作基準
PolicyPreviewServiceは必ずcloneStateから無操作baselineを先に実行する。variantとの差は同じseed streamを使ったpaired comparisonとし、ランダムショック差ではなく政策差を示す。
22 選択式専門家と助言設計
22 1 プロフィール契約
type ExpertRole = 'centralBank' | 'fiscal' | 'macro' | 'industry' |
  'labor' | 'social' | 'demography' | 'environmentEnergy';
interface ExpertProfile {
  expertId: string; role: ExpertRole; displayNameKey: string;
  portraitAssetKey: string; portraitAltKey: string; colorToken: string;
  toneKey: string; priorityIndicators: IndicatorId[];
  openingTemplateKeys: string[]; cautionTemplateKeys: string[];
}
氏名 役割 画像 配色 口調はexperts.jsonとassets manifestを同じexpertIdで結ぶ。
UI04で確定したキャラクタープロフィールを正とし 文書内の仮名よりcontentを優先する。
portraitは正方形WebP 1倍2倍を用意し 顔の輪郭 髪 服 小物 色で相互に識別できるようにする。
実在人物に似せず altTextは外見だけでなく役割も含める。
22 2 AdviceRecord
interface AdviceRecord {
  adviceId: string; decisionId: string; expertId: string;
  createdAtMonth: number; horizonMonths: 12 | 60;
  conclusionKey: string; reasonRefs: CausalRef[]; cautionRefs: CausalRef[];
  confidence: 'low' | 'medium' | 'high'; uncertaintyKeys: string[];
  engineVersion: string; configVersion: string; templateVersion: string;
}
表示文はAdviceRecordとExpertProfileから構築する。AdviceRecordには完成文を保存せず、根拠参照とテンプレート版を保存する。過去記録を再表示する際に文言版が変わった場合は当時版または当時の根拠を表示する。
22 3 助言生成パイプライン
UI04で政策draftとexpertId 1件から3件を選択する。
PreviewWorkerへbaselineとvariantを12か月 60か月で送る。
deltaとCausalContributionを専門家のpriorityIndicatorsで並べ替える。
結論を改善 悪化 混合 不確実の4分類から選ぶ。
上位理由2件と注意点1件を同じcausalRefから選ぶ。
toneKeyに対応する語尾 語彙 比喩テンプレートへ安全な値だけを差し込む。
選択外の専門家から最も論点が異なる1件を反対意見候補として返す。
22 4 UI04コンポーネント
選択変更時は300msのdebounce後に既存PreviewWorker requestを中止し、政策draft hashが同じなら予測値をキャッシュして助言の並べ替えだけを行う。選択専門家が結果を変更してはならない。
23 国家ビュー設計
23 1 ルートと責務
UI14のrouteは /game/:slot/nation とする。下部ナビの国家またはホーム上の景観カードから開く。画面はNationViewSelectorが返す読み取り専用view modelだけを受け取り、engineやIndexedDBへ直接触れない。
interface NationViewModel {
  month: number; timeOfDay: 'day' | 'evening' | 'night'; weatherKey: string;
  regions: Record<RegionId, RegionVisualState>;
  trafficLevel: 0 | 1 | 2 | 3; constructionLevel: 0 | 1 | 2 | 3;
  overlays: OverlayState[]; eventMarkers: EventMarker[]; news: NationNewsItem[];
}
23 2 描画層
23 3 指標から景観への写像
状態段階はenter thresholdとexit thresholdを別に持ち、境界付近の月次変動でオブジェクトが点滅しないようにする。景観から数値を推測させるだけにせず、地域タップで関連指標、前月差、上位因果を必ず表示する。
23 4 性能とアクセシビリティ
requestAnimationFrameを使い 画面非表示時は停止する。目標30fps 最低20fpsとする。
offscreen領域 object pooling sprite atlasでDOM node数とGCを抑える。
低性能判定時は人 車 天候の順に密度を下げ 静止背景と指標は維持する。
prefers-reduced-motionでは交通と粒子を停止し 状態変化をラベルと静止差分で示す。
Canvasには代替の地域一覧と説明をDOMで併設し keyboard操作を提供する。
24 反応 コンボ Voice イベント 国家史
24 1 ReactionSnapshot
interface ReactionSnapshot {
  month: number; audience: 'citizens' | 'business' | 'market';
  direction: -1 | 0 | 1; strength: 0 | 1 | 2 | 3; lagMonths: number;
  causeRefs: CausalRef[]; representativeTopicKey: string;
}
各主体のreaction scoreは政策と経済指標の寄与を設定係数で合成し -1から1へclampする。UIは方向と4段階強度だけを表示する。Nation Voiceは最大強度かつ直近のtopicを選び、同じcauseRefsへリンクする。乱数で感情を捏造しない。
24 2 ComboEvaluator
interface ComboDefinition {
  comboId: string; requiredPolicies: PolicyPredicate[];
  forbiddenPolicies?: PolicyPredicate[]; minOverlapMonths: number;
  effects: ScheduledEffectSpec[]; additionalCosts?: ResourceCost;
  explanationKey: string; priority: number;
}
preview時とcommit時に同じpure evaluatorを使い 表示と結果を一致させる。
combo由来effectにはsourceType comboとcomboIdを付け 因果ログで単体政策と区別する。
相互に発火するcomboは禁止し 最大発火数とpriorityで循環を防ぐ。
追加費用を払えないcomboは未発動理由を返し 政策自体の確定可否と分ける。
24 3 イベントと準備度
EventDefinitionへpreparednessIndicatorsとmitigationCurveを追加する。兆候は発生確率だけでなく準備度の不足を示す。発生後は被害の基準値、準備で軽減した量、選択で変わった量を別々のCausalContributionとして保存する。
24 4 国家史
25 教育機能設計
25 1 説明レベル
learningModeはUIの説明量だけを変え、engine inputへ渡さない。
25 2 なぜ と反実仮想
結果指標のdeltaから絶対寄与上位3件を選ぶ。
sourceTypeごとに政策 外部環境 イベント 惰性の順で説明ラベルを作る。
前月比と政策採用前比を混同しないよう基準時点を表示する。
反実仮想は同じsnapshot seed streamsでalternative commandだけを差し替える。
予測と実績の差はショック モデル誤差 条件変化に分けて学習ノートへ記録する。
25 3 SchoolLens
interface SchoolLens {
  schoolId: string; displayNameKey: string; goalKeys: string[];
  premiseKeys: string[]; favoredIndicatorIds: IndicatorId[];
  questionTemplateKeys: string[]; riskTemplateKeys: string[];
}
自由主義 社会主義 新自由主義 マルクス主義 共産主義等は同じ政策結果を異なる目的と前提から読む比較レンズとして実装する。score 勝敗補正 正解フラグを持たせない。表示順は固定または利用者選択とし、特定思想を既定の正解として強調しない。
26 画面状態とルーティング追補
UI04を開く時点でrunningをpausedへ保存し 離脱時も明示操作なしに再開しない。
専門家選択はpolicy draftのUI状態だが 確定時にdecision logへ保存する。
UI14は閲覧画面でありrunStateを変更しない。危機時も見られるが再開操作はUI10だけに置く。
戻る操作でworker結果を再commitしないようrequestId draftHash commandIdを分離する。
27 保存 バージョン 移行
saveSchemaVersionを上げるmigrationでは既存セーブにstandard duration 96か月を設定せず、scenarioIdがSCN-01なら48、それ以外の既存シナリオなら96をendMonthとして補完する。ExpertProfile本文や画像は保存せずexpertIdとtemplateVersionだけを保存する。
28 Workerと性能設計
worker messageはZodで検証しrequestIdとengineVersion不一致を拒否する。
30年実行は12tickごとに進捗を通知し96tickごとに取消可能checkpointを置く。
previewは政策draft hashとsnapshot checksumでLRU cacheし expert変更だけでは再計算しない。
Canvas描画はworker計算完了通知を受けたselector出力だけで更新し 計算途中の状態を描かない。
29 テスト追補
portrait manifestは全expertIdに1x 2x altTextがあることをCIで検証する。
文章snapshotはtoneKey別に固定し 数値やcausalRefを曖昧な文言で隠さない。
PlaywrightでUI04 keyboard選択 200パーセント拡大 画像失敗 reduced motionを確認する。
通信監査で助言生成時に外部requestが0件であることを確認する。
30 Issue実装順
31 視覚基準
以下はUI04、UI05、UI14の情報階層と雰囲気の基準である。実装では画像の文字を写すのではなく、本書のcomponent contract、状態、アクセシビリティを優先する。UI04にはExpertPickerとAdviceCarouselを追加する。
図 D1 UI04 政策会議
図 D2 UI05 政策プレビュー
図 D3 UI14 Living Nation
項目
内容
文書版
0.2
作成日
2026年9月22日
対象
スマートフォン向けPWA MVPおよび段階拡張
原典
Macro Nation Game Proposal および Macro Nation MVP Requirements
主な読者
Codexによる実装担当者 テスト担当者 バランス調整担当者
区分
固定するもの
調整できるもの
エンジン
月次更新順序 再現可能乱数 原子的tick 因果ログ
式の係数 上下限 誤差幅
ゲーム
四半期3政策 5政策系統 危機停止 評価5軸
政策コスト ラグ 強度 危機閾値
コンテンツ
3シナリオ 12イベント 主要9指標
初期値 外部環境 文言 発生確率
保存
3スロット 二世代 JSON入出力 版管理
履歴保持数 表示用集計量
UI
主要14画面 下部5ナビ 360px対応
文言 アイコン 簡易グラフ表現
ID
判断
設計内容
D001
言語とUI
TypeScript React Viteを使用する。ゲーム状態はUIライブラリ型へ依存させない。
D002
状態管理
画面状態はZustand、永続ゲーム状態はリポジトリ層で管理し、UIから直接書き換えない。
D003
ルーティング
React Routerを使い、確定処理はURL遷移ではなく一意なcommandIdで冪等化する。
D004
検証
Zodスキーマで設定 保存 JSON取込 Workerメッセージを境界ごとに検証する。
D005
保存
IndexedDBをidbラッパーから利用し、各スロットのcurrentとpreviousを同一トランザクションで更新する。
D006
乱数
32bit整数演算だけで実装するxoshiro128ssを採用し、用途別streamIdとアルゴリズム版を保存する。
D007
重い処理
オフライン進行 政策プレビュー 1000回自動実行はWeb Workerで実行する。
D008
グラフ
MVPではSVGベースの軽量チャートを自作し、主要9指標と注記だけを描画する。
D009
PWA
Vite PWAプラグインとWorkboxで必須資産を事前キャッシュし、更新は利用者確認後に適用する。
D010
テスト
Vitest Testing Library Playwright axe coreを使用し、ヘッドレス自動実行はNodeから同じengineを呼ぶ。
D011
日付
ゲーム内時刻は開始月からの整数monthIndexで持つ。表示年月はシナリオ定義から導出する。
D012
バージョン
engineVersionごとに実装入口を分け、開始時のconfigSnapshotを保存して進行中ゲームの係数を凍結する。
層
依存してよいもの
依存してはいけないもの
engine
domain types config contracts
React DOM IndexedDB Date Math random
content
schema types
engineの実行コード UI
application
engine persistence worker contracts
具体的な画面部品
persistence
domain serialization schema
Reactと画面状態
ui
application selectors commands
engine内部関数 DB直接操作
devtools
公開されたengine API diagnostics
本番ナビゲーション
モード
用途
乱数と保存
live
通常の月次進行
保存済み乱数を更新し各tick後に保存
tutorial
SCN01最初の4四半期
liveと同じengineを3tickずつ実行
offline
離席時間の逐次反映
liveと同じ乱数を更新し各tick後にcheckpoint
preview
政策の12か月試算
状態を複製し分位条件を使用 保存しない
batch
1から1000回の自動実行
seed集合を明示し結果集計だけを出力
replay
不具合再現
保存したseed command列 engine版 config版を使用
種類
内部表現
例と表示
率
decimal number
0.025を2.5パーセントと表示
指数
基準100のnumber
CPI 103.2 為替指数125
月
0始まりのinteger monthIndex
開始年月と加算して表示
フロー
基準月次名目GDPを100とするmodel unit
税収 支出 輸出入
ストック
同じmodel unit
政府債務 外貨準備
点数
0から100
信頼 政治資本 実施能力
確率
0以上1以下
イベント基本確率
シナリオ
初期状況
主な開始値
狙い
SCN01
穏やかな物価高と成長鈍化
成長1.0 物価3.0 失業6.0 債務85 準備7か月 信頼65
基本操作と時間差を学ぶ
SCN02
通貨安と輸入インフレ
成長0.5 物価7.0 失業6.5 FX125 債務100 準備5か月 信頼55
金利と介入だけでは解けない状態
SCN03
関税応酬と供給制約
成長0.0 物価4.5 失業7.0 FX108 債務95 準備6か月 関係40
保護と川下コストの両立
係数群
初期実装の考え方
自動テスト
需要
月次変化が通常プラスマイナス2パーセント以内
金利 税 所得への方向性
物価
慣性を持ち需給と輸入物価へ反応
大幅利上げで12か月平均が低下
雇用
GDP変化に3から9か月遅れて反応
遅延と上下限
為替
金利差 経常収支 信頼 投機 介入で構成
介入剥落と準備減少
財政
税率と活動量から歳入を算出
収支と債務の恒等式
信頼
安定 雇用 一貫性 制度尊重 危機対応
場当たり変更で低下
産業
主要入力
主な出力
農業資源
天候 資源価格 関税 為替
食料供給 輸入依存 物価
製造
海外需要 為替 関税 投資
輸出 雇用 生産性
建設
公共事業 金利 能力稼働
短期雇用 インフラ 費用超過
生活サービス
実質所得 雇用 消費税
内需 雇用 満足
金融不動産
金利 信頼 資産価格
信用 投資 銀行不安
エネルギー物流
資源価格 為替 電力 港湾
供給能力 輸入価格
政策
入力
主処理
副作用
政策金利
0.25ポイント刻み シナリオ上下限
policyRateを変更 市場金利と期待へ即時反映 需要物価雇用へ遅延
方向反転 大幅変更 独立性無視で信頼低下
税制
所得 法人 消費 控除を1パッケージ
activeTaxSystemを期間付きで更新 税収 可処分所得 消費 投資 格差へ反映
時限終了時は自動復帰 急変更で一貫性低下
公共事業
6分野 小中大 4 8 12四半期
支出と建設雇用を早期 インフラと潜在GDPを遅延
能力超過で費用増 物価 効率低下 中止損失
関税
産業 税率 期間
輸入量 国内生産 価格 関税収入へ継続反映
川下コスト 消費者物価 報復hazard上昇
為替介入
通貨買い売り 準備の1 2.5 5 10 20パーセント
準備を即時変更しFXへ6か月以内の減衰効果
基礎条件不良で効果減衰 反復で準備制約
軸
初期構成
代表入力
暮らし
実質所得40 雇用25 物価20 格差15
所得指数 失業 目標物価乖離 格差
成長
GDP水準40 成長率30 潜在成長30
開始比 実質成長 潜在GDP
安定
物価30 雇用20 為替25 危機25
変動幅 危機停止回数
持続性
債務35 財政25 準備20 基盤20
債務比率 収支 準備月数 インフラ
信頼
政策信頼60 一貫性25 制度尊重15
信頼 反転回数 独立性
store
key
内容
slotMeta
slotId
表示名 currentRevision 状態 最終保存時刻
saveGenerations
slotId generation
current previousのSaveEnvelope
completedGames
gameId
最大10件の評価と主要履歴
settings
key
表示 音 速度 更新許可 feature flag
testMetrics
gameId
端末内テスト指標
migrationJournal
migrationId
移行開始 完了 失敗 復旧情報
契機
保存内容
失敗時
政策確定前
現在状態の安全checkpoint
確定を開始しない
政策確定後
決定 予約 資源 commandId
UIを成功扱いにしない
各月tick後
新状態 snapshot rng clock
入力状態を維持
イベント選択後
選択 効果 runState commandId
未選択状態を維持
危機と終了
停止理由 評価 最終snapshot
直前tickから再判定
画面
route
主要責務
UI01 起動保存
/
新規 再開 履歴 設定 復旧通知
UI02 シナリオ
/new
シナリオ 難易度 slot seed
UI03 ホーム
/game slot home
警告 5指標 3行報告 節目
UI04 政策会議
/game slot policies
実施 予約 比較 3枠
UI05 プレビュー
/game slot policies preview
レンジ ラグ 副作用 コスト 確定
UI06 予算
/game slot budget
歳入 歳出 収支 債務 12か月見通し
UI07 市場
/game slot market
為替 金利 準備 経常収支 要因
UI08 レポート
/game slot reports
系列 因果 政策 イベント
UI09 イベント
/game slot event id
兆候 状況 選択 結果
UI10 緊急会議
/game slot crisis
危機理由 緊急政策 再開
UI11 終了評価
/game slot result
5軸 総合点 判断 再挑戦
UI12 ヘルプ設定
/help および settings
用語 表示 データ 免責
UI13 開発者
/dev
開発build限定 診断 自動実行
画面
初期表示
詳細
予算
歳入 歳出 基礎収支 利払い 財政収支 債務
12か月の基準 楽観 悲観レンジ 税制 公共事業への導線
市場
為替 政策金利 市場金利 準備 海外金利 経常収支
為替上位3要因 投機圧力 金利と介入への導線
レポート
変化上位3指標と因果上位3件
月次 四半期 年次系列 全寄与 政策とイベント注記
対象
合格基準
測定方法
96tick
Android 9 RAM4GBで5秒以内 目標2秒
production build 実機 5回中央値と最大
1tick
main threadを50ms以上連続占有しない
PerformanceObserver long task
主要表示
一般的4Gで3秒以内を目標
Lighthouse相当と実機cold start
グラフ
96か月9系列で操作遅延100ms未満を目標
interaction計測
保存
通常tick保存で体感停止を起こさない
IndexedDB時間をdiagnostics集計
分類
例
利用者への動作
入力
範囲外政策 不足資源 古いstate
確定せず修正内容を表示
設定
参照欠落 確率不正 weight不一致
起動を止め開発用詳細と一般向け案内
計算
NaN Infinity 不変条件違反
tickを破棄し直前保存を維持
保存
quota transaction abort checksum不一致
再試行 previous復旧 JSON書出し案内
Worker
timeout crash protocol不正
Worker再生成 最後のcommitから再開
PWA
cache更新不整合
現行版を継続し更新を延期
層
主な対象
実行
unit
純粋関数 schema RNG curve formula score policy validation
Vitest 毎commit
property
有限値 上下限 再現性 寄与一致 恒等式
fast check 毎PR
integration
policyからtick report 保存 Worker offline
Vitest browser 毎PR
golden
seed command列 月次snapshot event列
engineまたはconfig変更時
E2E
主要利用フロー AT条件
Playwright 毎PRとrelease
performance
96tick 1000run chart save
release候補と実機
accessibility
axe keyboard focus 200パーセント
毎PRと手動確認
security
import fuzz CSP outbound request
CIとrelease
出力
内容
summary json
完了率 失敗種別 評価分布 危機回数 指標範囲
strategy csv
seed別戦略 最終点 完了月 失敗理由
invariant failures
NaN Infinity 負値 上限違反 進行不能
replay package
最初の失敗seed command列 version config hash
dominance report
戦略間の完了率差 平均点差 外部環境別順位
要件
主設計
主テスト
FR GM
application game lifecycle persistence UI01 UI02
game management integration and AT001 AT005
FR HM BR
selectors report generator UI03
home report E2E and AT009 AT021
FR PC
policy command reservation preview
policy integration and AT002 AT003 AT004
FR IR TX PW TR FX
five policy handlers config effects
policy unit direction lag side effect suites
FR BG MK RP
fiscal market report selectors SVG chart
screen integration AT009 AT010
FR EV
event DSL streams choice effects
event integration deterministic replay
FR DF UL HP
difficulty config feature flags help catalog
configuration and navigation tests
FR OF
clock offline worker checkpoint
offline equality AT006 AT007 AT008
FR SV
IndexedDB generations import export
persistence AT011 AT012 AT013 AT018
FR DV
build gated devtools batch runner
batch and production route absence
NFR PF
worker performance budget
AT015 and performance suite
NFR OF RL
PWA update rollback version registry
AT014 recovery and offline suite
NFR AC
semantic UI focus reduced motion responsive
AT016 AT017 axe keyboard tests
NFR PR SC
local only CSP validation no dev route
AT018 AT022 security suite
ID
検証対象
テスト名
AT001
SCN01新規開始から最初の政策確定
e2e tutorial first policy
AT002
四半期3枠と4件目拒否
integration policy slot limit
AT003
3四半期先予約が1回だけ発動
integration scheduled activation
AT004
プレビュー全項目
e2e preview content
AT005
同一seed同一操作の完全一致
golden replay deterministic
AT006
48逐次と4時間offline一致
integration offline equality 48
AT007
8時間超でも96tick上限
worker clock boundary
AT008
危機停止後に時間停止
e2e crisis stop resume
AT009
3行報告から根拠へ遷移
e2e report deep link
AT010
寄与合計と変化一致
property causal reconciliation
AT011
3slot独立
persistence multi slot
AT012
保存中断から復旧
fault injection generations
AT013
削除後JSON復元
e2e export delete import
AT014
機内モード12か月と再起動
offline browser E2E
AT015
基準端末96tick 5秒
physical device performance
AT016
360px 200パーセント完了
responsive E2E manual
AT017
色なし識別
visual and semantic assertion
AT018
不正巨大範囲外JSON拒否
import fuzz and E2E
AT019
1000回不変条件違反0
simulate 1000 gate
AT020
3方針完了 支配戦略なし
balance dominance report
AT021
初見5人中4人が主因説明
manual usability protocol
AT022
外部送信なし
Playwright request audit
段階
テーマ
実装
完了条件
M0
基盤
Vite React TypeScript lint format CI PWA shell
buildと機内起動
M1
型と設定
domain units Zod ConfigPack SCN01 fixture
validate content全件成功
M2
決定論エンジン
RNG tick skeleton causal builder state validation
基準ケース8年完走
M3
5政策
policy handlers queue reservation preview
方向 ラグ 副作用テスト
M4
イベント評価
12イベント 危機 失敗 5軸評価 batch
1000回計算ゲート
M5
主要UI
home policy preview report navigation
AT001からAT010主要部
M6
全コンテンツ
SCN02 SCN03 budget market event crisis result
3シナリオ完走
M7
保存放置
IndexedDB generations import offline Worker PWA update
放置ゲート AT011からAT014
M8
品質
tutorial a11y responsive security performance
AT015からAT019 AT022
M9
調整
strategies 1000run coefficients usability
AT020 AT021 公開ゲート
Issue
題名
完了成果
I001
プロジェクト雛形とCI
production build PWA shell test runner
I002
domain型と単位
GameState EconomyState Result invariants
I003
ConfigPack schema
SCN01最小fixtureとvalidate script
I004
決定論乱数
stream map golden vectors serialization
I005
因果寄与builder
delta reconciliation clamp diagnostics
I006
月次tick骨格
14工程のEngine Version別golden順序 snapshot atomic failure
I007
需要とGDP
消費 投資 政府 輸出入 GDP tests
I008
物価 雇用 為替
lag and directional tests
I009
財政 信頼 産業
identities limits diagnostics
I010
ヘッドレス48 96tick
baseline scenario golden and batch smoke
項目
初期状態
確定方法
SCN初期値
本書6章の暫定値
基準ケースと手動プレイで調整
モデル係数
config 0.1.0
単独政策試験と1000run
評価breakpoint
仮の目標帯
3戦略以上が完了可能になるよう調整
難易度倍率
intro 0.75 standard 1.0 expert 1.35を出発点
予測幅と外部shockを分離して確認
イベント確率
base monthly probability
兆候頻度と1play発生数を確認
市場向け説明
feature flag false
主要P0完成後にP1採否
音と画像
未実装
性能とアクセシビリティ合格後
ID
判断
設計内容
D013
期間
DurationConfigを設定化し 4 8 20 30年をtotalMonthsで表す
D014
長期更新
5年レビューと10年構造更新を月次tick内の決定論的工程として実行する
D015
国家ビュー
React UIと描画面を分離し Canvas 2Dを既定 Phaserを差替候補とする
D016
描画状態
NationViewStateはGameStateからselectorで導出し保存の正本にしない
D017
専門家
ExpertProfileをcontentとして管理し UI04承認プロフィールを唯一の正とする
D018
助言
因果ログと予測結果を決定論的テンプレートへ渡し 外部生成AIを使わない
D019
反応
国民 企業 市場のReactionSnapshotを同じ政策寄与から生成する
D020
Voice
Nation VoiceはReactionSnapshotの代表ラベルをテンプレート展開する
D021
コンボ
ComboDefinitionを設定化し policy set確定前後に同一Evaluatorを使う
D022
教育
LearningEntryとHistoryEntryをevent busの購読側で構築しengineを書き換えない
D023
思想比較
SchoolLensは政策を評価する説明レンズで結果補正を持たない
D024
長期性能
30年一括実行はWorkerでcheckpointを挟み UI描画と分離する
パス
責務
依存してよい先
src/domain/duration
期間 終了月 5年10年節目
domain unitsのみ
src/engine/longTerm
人口 技術 産業 老朽化更新
domain config causal
src/engine/reactions
3主体の反応とcausalRef
engine result causal
src/engine/combos
政策組合せ検出と効果生成
policy config scheduled effects
src/application/advice
選択専門家ごとの助言組立
selectors preview content
src/content/experts
プロフィール 口調 テンプレート画像manifest
静的content
src/application/learning
なぜ 反実仮想 ノート 思想比較
reports preview content
src/application/history
国家史項目 5年レビュー 最終要約
domain events reports
src/ui/nationView
描画層 カメラ hit testing reduced motion
NationViewModelのみ
src/ui/policies/experts
候補選択 助言 比較 予測履歴
application advice
処理
無操作時の入力
出力
政策
既存activeとscheduledのみ
新規政策0件
需要
所得 金利 信頼 人口 外需
消費 投資 政府 輸出入
供給
資本 生産性 労働力 インフラ
潜在GDP 供給制約
財政
自動安定化 現行税率 利払い
収支 債務
長期
人口動態 老朽化 技術トレンド
構造変化と蓄積コスト
表示枠
上限
内容
結論
1文 50字目安
採用 修正 見送りの示唆と最重要指標
やさしい理由
2文 90字目安
変化の経路と時間差
注意点
1文 60字目安
副作用 費用 不確実性
詳しく見る
任意
12か月 1年 5年レンジ 因果ログ 用語
コンポーネント
責務
状態
ExpertPicker
1から3人を画像 名前 役割で選ぶ
selectedExpertIds draftId
ExpertProfileSheet
プロフィール 口調 重視指標を表示
expertId
AdviceCarousel
専門家別の結論 理由 注意点を切替
adviceRecords activeExpertId
DissentCard
別視点1件と相違点を表示
dissentAdvice
ForecastRecord
過去予測と実績を比較
adviceId realizedMetrics
層
内容
更新頻度
Background
空 海 山 昼夜 天候
月次または時刻演出
City
都市 工場 農地 港 空港 発電所 建設
月次状態変更時
Transport
車 列車 船 航空機 人
animation frame
Effect
煙 明かり 停電 混雑 再エネ稼働
月次状態変更時
Event
災害 供給網 危機 政策工事marker
イベント開始終了時
UI
指標 地域hit area news tooltips
React state更新時
入力
景観
安定化
実質GDP 成長
建設クレーン 商業照明 物流量
3か月移動平均
失業率
通勤者 店舗稼働 工場稼働
0.5ptヒステリシス
輸出入
港コンテナ 船便 空港貨物
基準比4段階
インフラ
道路 鉄道 工事 劣化overlay
閾値を設定データ化
エネルギー
火力 再エネ 停電 汚染
電源構成比と供給余力
政策信頼
集会 ニュース 警備 公共空間
急変時のみevent marker
種別
生成契機
保存する参照
政策転換
大幅な開始 変更 終了
decisionId policyId causalRefs
危機
兆候 発生 解除 失敗
eventId crisisId choiceId
節目
5年レビュー 10年構造更新
reviewId scoreRefs
社会変化
主体反応の強度3が継続
reactionIds indicatorRefs
終幕
completed failed
評価5軸 主要判断 上位因果
モード
初期表示
任意で開けるもの
casual
結論 状態語 推奨導線
理由1件 用語
standard
結論 理由上位3件 副作用
因果ログ 反実仮想
learning
因果経路 用語 理論レンズ 問い
全寄与 ノート 思想比較 予測記録
画面
route
追加state
UI02
/new
durationMode learningMode
UI03
/game/:slot/home
nationSummary milestoneSummary assistantSuggestion
UI04
/game/:slot/policies
selectedExpertIds adviceStatus activeAdviceId
UI05
/game/:slot/policies/preview
baseline variant comboResults counterfactual horizon
UI08
/game/:slot/reports
learningEntries historyEntries forecastRecords
UI11
/game/:slot/result
historySummary reviewSnapshots comparison
UI14
/game/:slot/nation
selectedRegion overlay reducedMotion qualityTier
保存先
追加データ
方針
GameState
durationMode endMonth appliedMilestones
engineの正本
DecisionLog
selectedExpertIds advice record refs
判断時点の監査
Reports
reaction snapshots combo refs review snapshots
月次集計を圧縮
Learning
notebook entries forecast records
任意削除可能
History
history entries final summary
参照ID中心で保存
UI settings
learningMode reducedMotion nationQuality
ゲーム外設定
message
入力
出力
previewPolicyV2
snapshot draft horizons expertIds
baseline variants combos advice inputs
simulateOfflineV2
snapshot elapsed maxTicks
final snapshots checkpoints reports
simulateLongRun
scenario duration seed strategy
invariant summary reviews final
buildHistory
decision event review refs
history entries final summary
対象
必須テスト
対応受入
期間
48 96 240 360境界 終了 冪等milestone save migration
AT-023 035
無操作
4 8 20 30年baseline 不変条件 危機
AT-024
専門家
1から3選択 profile schema tone snapshot 結果不変
AT-025 026 027
プレビュー
paired seed 12 60か月 cache cancel
AT-028
国家ビュー
selector mapping hysteresis reduced motion fallback DOM
AT-029 030
反応 Voice
causeRef一致 強度境界 同一seed
AT-031 036
コンボ
発動 非発動 相殺 循環禁止 費用不足
AT-032 036
教育
モード結果不変 反実仮想 思想非正解表示
AT-033 034
国家史
5年項目 順序 重複なし 終幕要約
AT-035 036
Issue
主要モジュール
先行条件
16
domain/duration engine/longTerm baseline
1から15
17
UI01 UI02 createGame save migration
16
18
UI03 selectors return summary
15 17
19
content/experts application/advice UI04
13 14 18
20
previewPolicyV2 counterfactual forecast
13 19
21
nation selector static UI14
18
22
nation animation mapping performance a11y
21
23
engine/reactions
11 16
24
Nation Voice UI links
23
25
engine/combos preview integration
11 20
26
events preparedness crisis
9 23
27
learning notebook why counterfactual
20 23
28
SchoolLens forecast records
19 27
29
application/history UI08 UI11
16 26 27
30
UI06からUI13 integration 30year QA
16から29
