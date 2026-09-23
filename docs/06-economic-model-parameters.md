# Synchronized specification

> Source: Macro_Nation_Economic_Model_Parameters_v1.0
> Synced: 2026-09-22
> Repository copy for Codex implementation. The private Drive URL/ID is intentionally not stored because this repository is public.
> Model version defined by source: v0.1.0

---

MACRO NATION 経済モデル・パラメータ定義書 v1.0
Model v0.1.0 / Codex実装・チューニング基準

本書は、MACRO NATIONのSimulation Engineで使用する経済モデルの変数、単位、初期係数、ラグ、上下限、確率過程、政策反応およびテスト目標を定義する。
本書の数値は現実経済の予測値ではない。実証研究から「方向・おおよその大きさ・時間差」を拘束条件として採用し、その範囲内でゲームとして安定し説明可能な初期値を置く。
係数はEngineへ直書きせず、Model Configとして外出しする。初期値変更は原則Model Versionを更新し、式・更新順序変更はEngine Versionを更新する。

0. 文書の優先順位と適用範囲

技術境界はMacro_Nation_Architecture_Design_v1.0、ゲーム挙動はMacro_Nation_Game_Specification_v1.0、実装構造はMacro_Nation_MVP_Detailed_Design_v1.1を基準とする。
本書はそのうち「経済式と係数」「ラグ」「確率過程」「政策反応」「数値安定性」「golden response target」を具体化する。
MVPの標準国家は、先進国と新興国の中間程度の開放経済を抽象化した架空国家とし、国固有値はNationProfile modifierで変更する。

1. パラメータ分類

各パラメータに根拠区分を持たせる。
E: Empirical anchor。実証研究の数値・範囲を直接アンカーとして使用する。
C: Calibrated。実証研究の方向・オーダーを守りつつ、ゲームの月次モデルへ変換した初期値。
G: Gameplay。信頼、政治資本、イベント確率などゲーム性のために設定する値。
D: Derived。ほかの状態値から式で導出し、独立にチューニングしない値。

原則としてEは安易に変更せず、Cは0.5〜1.5倍程度、Gは0.25〜2.0倍程度を初期チューニング範囲とする。
大きく逸脱する場合はmodel presetを分ける。

2. 数値表現と単位

率は内部で小数を使う。2%は0.02、100bpは0.01とする。
指数は基準100とする。
GDP・税収・支出等の金額はmodel unitを使い、基準月次名目GDP=100とする。
スコアは原則0〜100。
FX指数は100を基準とし、上昇ほど自国通貨安。
月次成長率はlog近似ではなく原則previousValue * (1 + growth)で更新する。
年間率を月率へ変換する場合は pow(1 + annualRate, 1/12) - 1 を用いる。
内部値は丸めず、UI表示時だけ丸める。

3. 標準国家の基準状態

3.1 構造的基準値
CORE-GROW-001 | potentialGrowthAnnual | 0.018 | range 0.005〜0.035 | C | 潜在実質成長率。
CORE-INF-001 | inflationTargetAnnual | 0.020 | range 0.010〜0.040 | C | 長期物価アンカー。
CORE-U-001 | naturalUnemployment | 0.050 | range 0.035〜0.090 | C | 長期均衡失業率。
CORE-R-001 | neutralRealRateAnnual | 0.010 | range -0.005〜0.030 | C | 実質中立金利。
CORE-DEBT-001 | initialDebtToAnnualGdp | 0.90 | scenario override | G | 標準国家の参考開始水準。
CORE-IMP-001 | importShareOfDemand | 0.23 | range 0.10〜0.45 | C | 輸入依存度。
CORE-EXP-001 | exportShareOfDemand | 0.25 | range 0.10〜0.50 | C | 輸出比率。

SCNごとの開始値はScenario Configで上書きする。ここに置く値はEngineのsteady referenceであり、シナリオの実際の開始状態とは分離する。

4. 家計消費ブロック

月次消費成長を以下で構成する。
consumptionGrowth =
  baselineConsumptionMonthly
  + incomeCoefficient * realIncomeGrowth
  - realRateCoefficient * realRateGap / 12
  - unemploymentCoefficient * unemploymentGap / 12
  - inflationConcernCoefficient * inflationTargetGap / 12
  + taxTransferContribution
  + scheduledContribution
  + consumptionError

初期パラメータ:
CONS-BASE-001 | baselineConsumptionAnnual | 0.015 | 0.000〜0.030 | C。
CONS-Y-001 | incomeCoefficient | 0.60 | 0.35〜0.85 | C | 実質所得変化の消費への追随。
CONS-R-001 | realRateCoefficient | 0.45 | 0.20〜0.80 | C | 実質金利ギャップ1ppで年間消費成長を約0.45pp押し下げる初期設定。
CONS-U-001 | unemploymentCoefficient | 0.30 | 0.10〜0.60 | C | 失業ギャップ1ppで年間消費成長を約0.30pp押し下げる。
CONS-INF-001 | inflationConcernCoefficient | 0.15 | 0.05〜0.35 | C。
CONS-ERR-001 | monthlyShockStd | 0.0035 | 0.0005〜0.0050 | G | 1,000 run校正のcomponent-growth相関を満たす月次個別誤差。

実質所得の符号効果は即時〜3か月、金利と失業の効果は3〜12か月へ分散可能とする。

5. 企業投資ブロック

investmentGrowth =
  baselineInvestmentMonthly
  + demandOutlookCoefficient * outputGap / 12
  + productivityCoefficient * potentialGrowthAnnual / 12
  - realRateCoefficient * realRateGap / 12
  - uncertaintyCoefficient * uncertaintyGap / 12
  + corporateTaxContribution
  + scheduledContribution
  + investmentError

初期パラメータ:
INV-BASE-001 | baselineInvestmentAnnual | 0.025 | -0.010〜0.050 | C。
INV-GAP-001 | demandOutlookCoefficient | 1.20 | 0.60〜1.80 | C。
INV-PROD-001 | productivityCoefficient | 0.80 | 0.40〜1.20 | C。
INV-R-001 | realRateCoefficient | 1.50 | 0.70〜2.20 | C | 金利に消費より強く反応させる。
INV-UNC-001 | uncertaintyCoefficient | 0.80 | 0.30〜1.50 | C。
INV-ERR-001 | monthlyShockStd | 0.0015 | 0.0015〜0.0080 | G | 投資成長のGDP成長との相関を校正下限へ合わせる月次個別誤差。

投資は消費より変動を大きくし、金利・不確実性ショックへの反応を強くする。

6. GDP・供給・潜在成長

実質GDPは半構造IS型の産出gapから算出する。需要項目はGDP loadingとして分配し、compositionResidualのsigned合計を0に保つ。これにより、構成項目の直接効果を残しつつ、GDP aggregateへは一度だけ反映する。
realRateGap = marketRate - expectedInflation - neutralRealRate
fiscalImpulse = scheduledGovernmentConsumptionAndPublicInvestment / previousRealGdp
realExchangeRateGap = fxIndex / cpiIndex - 1
outputGap = clamp(
  persistence * previousOutputGap
  - rateCoefficient * realRateGap / 12
  + fiscalCoefficient * fiscalImpulse
  + foreignCoefficient * foreignGrowthGap / 12
  + fxCoefficient * realExchangeRateGap
  + confidenceCoefficient * confidenceGap / 12
  + demandShock,
  gapMin,
  gapMax
)
realGdp = potentialGdp * (1 + outputGap)
componentDelta[j] = gdpShare[j] * (realGdp - previousDemandSum) + compositionResidual[j]
sum(sign[j] * compositionResidual[j]) = 0
realGdp = C + I + G + X - M

輸出入component growth:
exportsGrowth = X-FOREIGN * foreignGrowthGap / 12 + X-FX * realExchangeRateGap / 12 + scheduled + shock
importsGrowth = M-DEMAND * previousOutputGap / 12 + M-FX * realExchangeRateGap / 12 + scheduled + shock
X-FOREIGN-001 | foreignDemandCoefficient | 0.90 | 0.20〜1.80 | C。
X-FX-001 | realExchangeRateCoefficient | 0.35 | 0〜0.80 | C。
X-ERR-001 | monthlyShockStd | 0.005 | 0.0015〜0.008 | G。
M-DEMAND-001 | demandCoefficient | 0.90 | 0.20〜1.80 | C。
M-FX-001 | realExchangeRateCoefficient | -0.25 | -0.80〜0 | C。
M-ERR-001 | monthlyShockStd | 0.005 | 0.0015〜0.008 | G。
現行stateに外国物価指数がないため、realExchangeRateGapは外国価格を100に固定し、名目為替指数を国内CPIで実質化して近似する。

基準share:
GDP-SHARE-C | 0.60
GDP-SHARE-I | 0.18
GDP-SHARE-G | 0.20
GDP-SHARE-X | 0.25
GDP-SHARE-M | 0.23
純合計が1.00となることをvalidationで確認する。出力gapは-0.15〜+0.12に制限する。

初期IS型パラメータ:
IS-GAP-PERSIST-001 | outputGapPersistence | 0.98 | 0.90〜0.995 | G。
IS-GAP-RATE-001 | realRateGapCoefficient | 0.48 | 0.15〜1.50 | G。
IS-GAP-FISCAL-001 | fiscalImpulseCoefficient | 0.008 | 0.001〜0.04 | G。
IS-GAP-FOREIGN-001 | foreignDemandCoefficient | 0.40 | 0.10〜0.90 | G。
IS-GAP-FX-001 | realExchangeRateCoefficient | 0.0015 | 0.0002〜0.006 | G。
IS-GAP-CONFIDENCE-001 | confidenceCoefficient | 0.01 | 0〜0.05 | G。
IS-GAP-ERR-001 | monthlyDemandShockStd | 0.0042 | 0.002〜0.008 | G。
IS-GAP-MIN-001 / IS-GAP-MAX-001 | gap bounds | -0.15 / +0.12 | range validation | G。

GDP loadingは各scenarioで変更できる。GDP成長と需要項目の相関校正は、no-policy batchの12か月warmup後に前期比年率成長で測定する。実質GDP前年比、前期比年率、output gapの標準偏差も同じbatch diagnosticsから検証する。

potentialGrowthAnnual =
  baselineProductivity
  + infrastructureContribution
  + educationContribution
  + energyLogisticsContribution
  + technologyContribution
  - agingContribution
  - disasterDamage
  - capacityLoss

初期パラメータ:
SUP-PROD-001 | baselineProductivityAnnual | 0.012 | 0.003〜0.025 | C。
SUP-LAB-001 | baselineLaborContributionAnnual | 0.006 | -0.010〜0.015 | C。
SUP-DEPR-001 | infrastructureMonthlyDepreciation | 0.0010 | 0.0004〜0.0020 | C。
SUP-GAP-MIN | outputGapMin | -0.15 | hard clamp。
SUP-GAP-MAX | outputGapMax | 0.12 | hard clamp。

7. 雇用とOkun関係

雇用は潜在成長との差で測った実質GDP成長gapへ遅れて反応させる。失業率は自然失業率へ月次で部分回帰し、Okun効果は3〜9か月のkernelに分散する。
実証アンカーとして、実質GDP成長が潜在成長を年間2pp上回ると失業率が概ね1pp低下する関係を基準にする。
unemploymentDelta = monthlyMeanReversion * (naturalUnemployment - previousUnemployment) - okunCoefficient * laggedOutputGrowthGap / 12

初期パラメータ:
LAB-OKUN-001 | okunCoefficient | 0.47 | 0.35〜0.65 | E/C | advanced-small-openの100bp paired IRFに合わせた校正値。output growth gapは3〜9か月のhump kernelで反映する。
LAB-LAG-001 | okunLagStartMonths | 3 | 1〜4 | C。
LAB-LAG-002 | okunLagPeakMonths | 6 | 4〜9 | C。
LAB-LAG-003 | okunLagEndMonths | 9 | 6〜15 | C。
LAB-MR-001 | meanReversionToNaturalAnnual | 0.20 | 0.10〜0.35 | C。
LAB-MR-MONTHLY-001 | monthlyMeanReversionSpeed | 0.04 | 0.01〜0.10 | C | advanced-small-openの探索値。
LAB-MIN | unemploymentMin | 0.020 | clamp。
LAB-MAX | unemploymentMax | 0.300 | clamp。

Okun効果は同月全量を反映せず、3〜9か月のhump curveに配分する。

8. 物価・輸入物価・期待インフレ

8.1 為替から輸入価格
為替変化はまず輸入価格へ速く反映し、CPIへは不完全かつ遅れて反映する。

初期パラメータ:
PX-FX-IMP-001 | fxToImportPricePassThrough1M | 0.65 | 0.50〜0.80 | E/C | 1%通貨安で輸入価格を初月約0.65%押し上げる。
INF-IMPORT-001 | fxToCpiCumulativePassThrough12M | 0.05 | 0.02〜0.15 | E/C | import price水準の変化に対する12か月CPI水準の累積反応。月次inflation persistenceによる過剰な累積を補正する。
IMP-STATE-001 | highInflationLowTrustModifier | 0.25 | 0〜0.75 | G/C | 高インフレ・低信頼時に輸入価格転嫁を強める。

advanced-small-openの10%通貨安テストでは輸入価格が初月5〜8%、CPI価格水準が12か月で0.2〜1.5%上昇する。旧v0.1.0の0.15は本profileの固定値ではなく、許容帯の上側候補とする。

8.2 国内インフレ
inflationMonthly =
  inflationPersistence * previousInflationMonthly
  + demandPressureCoefficient * outputGap / 12
  + importPriceContribution
  + expectationContribution
  + supplyConstraintContribution
  + randomError

初期パラメータ:
INF-PERS-001 | inflationPersistence | 0.90 | 0.50〜0.90 | C。
INF-GAP-001 | demandPressureAnnualCoefficient | 0.08 | 0.08〜0.40 | C | advanced-small-openの100bp paired IRFでCPI価格水準をgolden responseの許容帯に合わせた校正値。
INF-WAGE-001 | wagePressureLoading | 0.08 | 0〜0.25 | C。
INF-SUPPLY-001 | capacityPressureAnnualLoading | 0.12 | 0.02〜0.40 | G/C | 産業別生産が能力を超える場合の月次物価圧力。
INF-ERR-001 | monthlyShockScale | 0.0018 | 0.0003〜0.0018 | G | advanced-small-openのgap×inflation相関上限に合わせた校正値。

expectedInflationは前月期待を0.90で保持し、残る0.10の情報部分を実績インフレ65%、目標アンカー35%へ配分する。
EXP-PERS-001 | expectedInflationPersistence | 0.90 | 0.50〜0.98 | C。
EXP-ANCHOR-001 | targetAnchorWeightWithinNewInformation | 0.35 | 0.10〜0.80 | C。

9. 金融政策の伝達

政策金利変更は「市場金利への早い伝達」と「実体経済・物価への遅い伝達」を分離する。

市場金利:
MON-PASS-001 | policyToMarketRatePassThrough | 0.80 | 0.60〜1.00 | C。
市場金利は政策金利との差の80%を月次で埋め、1〜3か月でほぼ全量を反映する。市場金利の変更は為替へ先に、需要・雇用・物価へ遅れて波及させる。

100bpの予想外の利上げに対するgolden response target:
MON-GOLD-GDP | real GDP level trough | -0.7% | 許容 -0.4〜-1.3% | peak 18〜24か月。
MON-GOLD-U | unemployment peak | +0.25pp | 許容 +0.15〜+0.50pp | peak 15〜24か月。
MON-GOLD-CPI | price level / cumulative CPI response | -0.4% | 許容 -0.2〜-1.0% | peak 18〜36か月。
MON-GOLD-FX | FX index | -0.8%方向 | 許容 -0.3〜-1.5% | 1〜6か月。

golden responseは「直接加算する効果」ではなく、需要・投資・為替・期待の各式を統合した結果が到達すべき校正目標である。
金融政策効果はhump-shapedとし、突然12か月後に全量発生するcliff effectを禁止する。

10. 財政政策と税制

10.1 一般政府支出
文献では政府支出multiplierは景気局面で大きく異なるため、output gap modifierを持たせる。

FISC-G-001 | spendingMultiplierNormal | 0.80 | 0.50〜1.10 | E/C。
FISC-G-002 | spendingMultiplierSlack | 1.20 | 0.80〜1.70 | E/C。
FISC-G-003 | spendingMultiplierBoom | 0.40 | 0.10〜0.70 | E/C。
FISC-G-004 | slackThreshold | outputGap <= -0.02 | C。
FISC-G-005 | boomThreshold | outputGap >= +0.02 | C。

10.2 税負担
税変更は可処分所得・企業利益・消費価格を直接変え、その後に消費・投資を通じてGDPへ波及させる。
税multiplierを別途二重加算しない。校正確認用targetとして以下を置く。
FISC-TAX-GOLD-N | 1%GDP相当の純増税 | 1年GDP -0.25% | 許容 -0.10〜-0.50%。
FISC-TAX-GOLD-S | 景気後退時 | 1年GDP -0.40% | 許容 -0.20〜-0.70%。
FISC-TAX-GOLD-B | 過熱時 | 1年GDP -0.15% | 許容 -0.05〜-0.35%。

税別初期値:
TAX-INC-MPC | 所得税による可処分所得変化のconsumption反映 | CONS-Y-001を利用。
TAX-CORP-INV | corporateTaxInvestmentCoefficient | 0.25 | 0.10〜0.50 | C。
TAX-VAT-PRICE | consumptionTaxImmediatePricePassThrough | 0.70 | 0.40〜1.00 | C。
TAX-VAT-LAG | 1〜3か月 | C。

11. 公共投資

公共投資は短期需要効果と長期供給効果を別のScheduledEffectにする。

実証アンカー:
1%GDP相当の公共投資増加に対し、標準効率では同年GDP水準+0.4%程度、4年後+1.5%程度という研究を上限寄りアンカーとして採用する。

ゲーム初期値:
PINV-DEMAND-001 | sameYearOutputEffectPer1PctGdp | +0.40% | 0.20〜0.70 | E。
PINV-SUPPLY-001 | year4PotentialGdpEffectPer1PctGdp | +1.00% | 0.50〜1.50 | C/E。
PINV-EFF-001 | implementationEfficiencyBase | 0.80 | 0.50〜1.00 | C。
PINV-SLACK-001 | slackDemandMultiplier | 1.25 | 1.0〜1.6 | C。
PINV-CAP-001 | capacityOverrunThreshold | 0.80 of implementationCapacity | G。
PINV-OVR-001 | overrunCostMultiplier | 1.20 | 1.05〜1.50 | G。

短期需要effectは0〜12か月、供給effectは12〜60か月へ分散する。
教育・防災は即効性を弱く、長期効果を強くする。道路・港湾・電力は中期効果を強くする。

12. 為替・資本移動

fxLogChange =
  interestDifferentialContribution
  + riskPremiumContribution
  + currentAccountContribution
  + trustContribution
  + expectedInflationContribution
  + speculationContribution
  + interventionContribution
  + externalFxShock

初期パラメータ:
FX-RATE-DIFF-001 | monthly log FX response to foreign-domestic rate gap | 0.80 | 0.10〜2.00 | C。
FX-EXPECT-001 | expected-inflation-above-target FX response | 0.25 | 0.05〜0.60 | G/C。
FX-CA-001 | currentAccount 1%GDP surplus, 12M FX effect | -0.15% | -0.05〜-0.40 | C。
FX-TRUST-RISK-001 | policyTrust shortfall response | 0.20 | 0〜0.80 | G/C。
RISK-DEBT-001 / RISK-TRUST-001 | debt and trust derived risk premium | 0.015 / 0.010 | ConfigPack range | G/C。
FX-SPEC-001 | speculationPressure monthly effect | ±0.15 log units | ConfigPack range | G。
FX-ERR-001 | monthlyLogShockScale | 0.012 | 0.006〜0.025 | G。

FXは短期にrandom/external要因を大きくし、政策だけで完全制御できない設計とする。

13. 為替介入

介入は短期的に為替を動かせるが、外貨準備と基礎条件で効果を変える。

実証アンカーとして、外貨購入1%GDPで名目為替を約1.7〜2.0%減価させる研究、および準備が十分で政策方向と整合する場合に有効性が高いという研究を参照する。

初期パラメータ:
FXI-EFF-001 | effectPer1PctGdpIntervention | 1.50% | 0.50〜2.00 | E/C。
FXI-IMM-001 | immediateShare | 0.70 | 0.50〜0.85 | C。
FXI-HALF-001 | decayHalfLifeMonths | 3 | 1〜6 | C。
FXI-CAP-001 | maxSingleActionFxEffect | 4.0% | 2〜6 | G。
FXI-RES-LOW | reserves < 3 import months | effectiveness 0.35 | G/C。
FXI-RES-MID | reserves 3〜6 months | effectiveness 0.70 | G/C。
FXI-RES-HIGH | reserves > 6 months | effectiveness 1.00 | G/C。
FXI-ALIGN | monetary/fundamental alignment bonus | up to 1.20 total multiplier | C。
FXI-REPEAT | repeated intervention fatigue | -10% effectiveness per repeated quarter, floor 0.50 | G。

自国通貨買い介入はFX指数を低下させ、外貨準備を減少させる。自国通貨売りは逆方向。
準備不足時の大規模介入を万能解にしない。

14. 関税

関税は対象産業の輸入価格・輸入量・国内生産・川下産業へ同時に作用させる。

実証アンカーとして、米国の2018〜2021年の対象関税では輸入価格への転嫁がほぼ1対1、対象輸入は減少、対象国内生産と価格は上昇し、一部川下産業にはコスト増と生産減が確認されている。ただしこれは特定国・特定期間の結果であり、ゲームでは一般化し過ぎない。

初期パラメータ:
TRF-PT-001 | tariffToImporterPricePassThrough | 0.85 | 0.60〜1.00 | E/C。
TRF-ELAS-001 | importVolumeElasticityToLandedPrice | -1.00 | -0.50〜-2.00 | E/C。
TRF-SUB-001 | lostImportsToDomesticOutputShare12M | 0.20 | 0.10〜0.40 | C。
TRF-DOWN-001 | downstreamCostPassThrough | 0.30 | 0.15〜0.60 | C。
TRF-LAG-001 | import response peak | 6〜12か月 | C。
TRF-LAG-002 | domestic substitution peak | 12〜24か月 | C。
TRF-RET-001 | retaliationHazardPer5ppPerQuarter | +0.02 | 0.005〜0.05 | G。

関税を上げると、対象輸入を減らす一方で輸入価格と一部川下コストを上げることを必須とする。
国内生産増を自動的な総GDP純増として扱わず、消費者負担・投入コスト・報復を同時に評価する。

15. 財政・政府債務

taxRevenue =
  incomeTaxBase*incomeTaxRate
  + corporateProfitBase*corporateTaxRate
  + consumptionBase*consumptionTaxRate
  + tariffRevenue
  - credits

primaryBalance = taxRevenue - primarySpending
interestPayment = debtStock * effectiveDebtRateAnnual / 12
debtNext = debtStock - primaryBalance + interestPayment

市場金利変化は政府債務へ即時全量反映させず、平均満期を表すrepricingを通じて反映する。
DEBT-REPRICE-001 | monthlyRepricingShare | 0.015 | 0.008〜0.030 | C。
DEBT-RISK-001 | riskPremiumStartDebtRatio | 1.20 | 0.90〜1.60 | G/C。
DEBT-RISK-002 | trustRiskPremiumSensitivity | 0.015 per 10 trust-point loss annual | 0.005〜0.030 | G/C。
DEBT-MIN | governmentDebt | >=0 unless explicit asset-state extension is added。

16. 政策信頼・政治資本・実施能力

このブロックは実証係数ではなくゲーム上の説明可能性を優先する。

policyTrustDelta =
  priceStabilityScore
  + employmentScore
  + consistencyScore
  + promiseScore
  + institutionRespectScore
  - crisisPenalty
  - reversalPenalty

初期パラメータ:
TRUST-STAB-001 | stable inflation reward | +0.10〜+0.30 point/month | G。
TRUST-JOB-001 | unemployment deterioration penalty | -0.10 point per +0.5pp y/y | G。
TRUST-REV-001 | policy reversal within 2 quarters | -1.5 points | -0.5〜-3.0 | G。
TRUST-CBI-001 | central bank independence violation | -3 points | -1〜-6 | G。
TRUST-CRISIS-001 | unmanaged crisis monthly penalty | -1〜-4 | G。
PCAP-REGEN-001 | politicalCapital monthly regeneration | +0.5 | 0.2〜1.0 | G。
IMPL-REGEN-001 | implementationCapacity monthly regeneration | +0.4 | 0.2〜0.8 | G。

信頼は経済指標を上書きする万能変数にせず、主に為替risk premium、投資不確実性、政策コスト、イベントhazardへ弱く波及させる。

景況感は産出gapに対して部分調整し、消費者と企業で独立した乱数ストリームを使う。
confidenceTarget = anchor + gapSensitivity * outputGap * 100
confidenceNext = confidence + monthlyAdjustment * (confidenceTarget - confidence) + independentShock

CONF-ANCHOR-001 | mean-reversion anchor | 50 points | 35〜65 | G。
CONF-C-GAP-001 | consumer response per output-gap percentage point | 0.22 | 0.10〜1.20 | G。
CONF-B-GAP-001 | business response per output-gap percentage point | 0.27 | 0.10〜1.50 | G。
CONF-MR-MONTHLY-001 | monthly adjustment speed | 0.25 | 0.10〜0.50 | G。
CONF-ERR-001 | monthly innovation half-range | 0.50 points | 0.10〜1.50 | G。
consumerConfidence / businessConfidenceは0〜100にclampする。係数は相関校正用のgameplay tuningであり、実証推定値を主張しない。

17. 外部環境と確率過程

externalDeviation[t] = persistence * externalDeviation[t-1] + shockScale * deterministicNormal(rngStream)

標準初期値:
EXT-GROW-001 | foreignGrowthAnnualBaseline | 0.025 | scenario override | C。
EXT-GROW-002 | persistence | 0.80 | 0.60〜0.95 | C。
EXT-GROW-003 | monthlyAnnualizedShockStd | 0.003 | 0.001〜0.007 | G。
EXT-RATE-001 | foreignRateAnnualBaseline | 0.025 | scenario override | C。
EXT-RATE-002 | persistence | 0.90 | 0.75〜0.98 | C。
EXT-RATE-003 | monthlyShockStd | 0.0010 | 0.0005〜0.0025 | G。
EXT-COM-001 | resourcePriceLogPersistence | 0.85 | 0.65〜0.95 | C。
EXT-COM-002 | resourcePriceMonthlyLogShockStd | 0.025 | 0.010〜0.060 | G。
EXT-REL-001 | partnerRelationMeanReversion | 0.95 | 0.85〜0.99 | G。
EXT-REL-002 | partnerRelationMonthlyShockStd | 1.0 score point | 0.3〜2.5 | G。

RNG streamは外部成長、資源価格、外貨、各イベントへ分離する。

18. 難易度とModel preset

難易度は式を変えずmodifierだけで表現する。
intro | shockScale 0.75 | previewWidth 0.80 | crisisTolerance 1.15。
standard | shockScale 1.00 | previewWidth 1.00 | crisisTolerance 1.00。
expert | shockScale 1.35 | previewWidth 1.25 | crisisTolerance 0.90。

Model preset:
balanced: 本書の初期値。MVP既定。
realistic: gameplay amplificationを0.75、外生ショックを0.85にして変化を穏やかにする。
experimental: tuning用。productionでは選択不可。

presetはEngine式を変更せず、Config Snapshotで保存する。

19. 主要clamp・validation

CPI index > 0。
realGdp > 0。
potentialGdp > 0。
unemployment 0.02〜0.30。
policyRate -0.02〜0.30。
inflation annualized display -0.10〜0.50。内部CPIは正値。
FX index 20〜500。
foreignReserves >= 0。
policyTrust / support / politicalCapital / implementationCapacity 0〜100。
tax rate 0〜0.70、消費税0〜0.40、tariff 0〜1.00をhard safety上限とし、Scenario側でより狭いUI範囲を指定する。
1 tickでrealGdpが±10%を超える場合はwarning、±20%超はengine error候補とする。
1 tickでCPIが±10%を超える場合はwarning、設定・イベント根拠がない場合はtest fail。
NaN、Infinity、undefined参照はtick fail。

20. Golden response tests

20.1 金融政策
基準状態から政策金利を100bp引き上げて12か月維持し、同一seedの外部shock pathでbaselineと比較する。
必須方向:
3〜12か月: 投資・需要が低下方向。
12〜24か月: GDP差が負、失業差が正。
12〜36か月: CPI差が負。
FXは短期に通貨高方向。
peak rangeはMON-GOLD-*を満たす。

20.2 公共投資
1%GDP相当の効率的公共投資で、
12か月以内にGDP levelが+0.2〜+0.7%。
48か月でpotential GDPが+0.5〜+1.5%。
implementationCapacity不足時は費用超過と物価圧力が大きくなる。

20.3 Okun
外部条件を固定し、実質GDP成長を潜在成長より年間2pp高いpathにすると、約1年後の失業率差が概ね-1pp方向になる。
効果は3〜9か月へ分散する。

20.4 為替pass-through
一度だけ10%通貨安ショックを与える。
import priceは初月に+5〜+8%。
advanced-small-open-v1.0.0ではCPI price levelは12か月で+0.2〜+1.5%とする（旧v0.1.0の+0.8〜+3.0%帯を置き換える）。
高インフレ/低信頼presetでは標準よりpass-throughが大きい。

20.5 関税
対象関税+10pp:
importer price上昇。
対象輸入量低下。
対象国内生産は一定の代替余地があれば上昇。
川下コストが上昇。
総GDPへの符号は事前固定しない。

20.6 為替介入
1%GDP相当の自国通貨買い:
FX指数は短期に低下方向。
外貨準備は減少。
reserves>6か月の方がreserves<3か月より効果が強い。
反復介入のみでは効果が逓減する。

20.7 平常期の主要相関
産出gapは持続性0.98、月次innovation scale 0.0042の決定論的AR(1) pathを与え、価格・労働ブロックを16 seedで168か月実行する。最初の24か月をwarmupとして除き、残る指標のPearson相関を測る。
産出gap×失業率: -0.90〜-0.60。
産出gap×年率インフレ: +0.15〜+0.55。
産出gap×平均景況感: +0.50〜+0.85。
相関校正はgolden responseのpaired baseline/variant比較と別の診断として扱う。産出gapの生成機構は需要ブロック側の診断で確認する。

21. 自動チューニング手順

1. 無介入baselineを各SCNで1,000 seed実行する。
2. 主要指標の中央値、P10/P90、危機率、失敗率を出す。
3. 各政策を最小・標準・最大で単独shock testする。
4. Golden responseの方向・peak・lagを確認する。
5. 代表7戦略を各200 seed以上で比較する。
6. 支配戦略、無効政策、頻発危機、発散を検出する。
7. Model Configだけで調整し、式変更が必要な場合のみEngine変更Issueを起こす。
8. Model Versionを上げ、旧Versionのgolden fixtureを保持する。

調整の原則:
まずshockScaleとpolicy strengthを調整する。
次にlag curveを調整する。
次にstate-dependent modifierを調整する。
最後に評価閾値を調整する。
評価点を合わせるために経済式を歪めない。

22. Config実装例

model:
  version: "0.1.0"
  core:
    potentialGrowthAnnual: 0.018
    inflationTargetAnnual: 0.02
    naturalUnemployment: 0.05
    neutralRealRateAnnual: 0.01
  labor:
    okunCoefficient: 0.50
    okunLagMonths: [3,4,5,6,7,8,9]
  prices:
    fxToImportPricePassThrough1M: 0.65
    fxToCpiPassThrough12M: 0.15
    inflationPersistence: 0.70
  monetary:
    policyToMarketRatePassThrough: 0.80
  fiscal:
    spendingMultiplier:
      boom: 0.40
      normal: 0.80
      slack: 1.20
  publicInvestment:
    sameYearOutputEffectPer1PctGdp: 0.004
    year4PotentialGdpEffectPer1PctGdp: 0.010
  tariff:
    importerPricePassThrough: 0.85
    importVolumeElasticity: -1.00
  fxi:
    effectPer1PctGdp: 0.015
    decayHalfLifeMonths: 3

実際のJSON/TypeScript schemaでは単位をfield名またはmetadataで明示し、暗黙の「%」を禁止する。

23. Codex実装ルール

係数リテラルをsimulation-engineへ直接書かない。
各係数はparameterId、description、unit、default、min、max、evidenceClassを持つ。
state-dependent modifierは限定DSLまたは純粋関数で実装し、evalを使わない。
empirical anchorとgameplay tuningを同じfieldで混ぜない。
golden response testを壊す変更はModel Version更新と差分説明を必須にする。
主要政策は必ずbaselineとの差分でテストする。
同じ政策効果をdirect effectとmacro equationで二重計上しない。
CPI、GDP、失業、FXの因果寄与は最終deltaと一致させる。

24. 実装開始時に作成するConfigファイル

packages/model-config/data/models/balanced-v0.1.0.json
packages/model-config/data/tuning/limits-v1.json
packages/model-config/data/tuning/effect-curves-v1.json
packages/model-config/data/nations/standard-nation-v1.json
packages/model-config/data/scenarios/scn01-v1.json
packages/model-config/data/policies/monetary-v1.json
packages/model-config/data/policies/tax-v1.json
packages/model-config/data/policies/public-investment-v1.json
packages/model-config/data/policies/tariff-v1.json
packages/model-config/data/policies/fx-intervention-v1.json

各ファイルはZod schemaで起動時とCI時に検証する。

25. 主要研究アンカー

以下は本書の初期校正に用いた代表ソースである。個々の推計値は国・時期・識別手法で幅が大きいため、単一推計を真値として扱わない。
Federal Reserve: Monetary policy lags 12–24 months
Bank of England: Monetary transmission quantitative estimates
Federal Reserve: Okun's law
IMF: Public infrastructure investment and output
IMF: State-dependent exchange-rate pass-through
IMF: Fiscal multipliers
USITC: Section 232/301 tariff effects
IMF: Foreign-exchange intervention evidence
IMF: Integrated Policy Framework / FX intervention principles

26. v0.1.0の確定事項と未確定事項

以下は旧v0.1.0文書の履歴値である。現行profile `advanced-small-open-v1.0.0` では、Okun 0.47、月次物価ショック0.0018、FX→CPI累積転嫁0.05、物価持続性0.90を既定値とし、Issue #8の実証校正追補と20章の受入帯を優先する。

確定:
方向性、更新ブロック、単位。
当時の値はOkun 0.50、FX→import price 0.65、FX→CPI 12M 0.15。
金融政策100bpのgolden response range。
政府支出multiplierの景気依存。
公共投資の短期需要と長期供給の分離。
関税の輸入価格・輸入量・国内代替・川下コストの同時処理。
為替介入の準備制約と減衰。
全係数をConfig化しVersion管理する。

未確定:
SCN-01/02/03ごとのmodifier最終値。
6産業ごとのelasticity。
税制各項目のdistributional coefficient。
長期人口・技術パラメータ。
12イベントのshock size。
信頼・政治資本の最終balance値。

未確定値はIssue単位でチューニングし、Model v0.2.0以降へ反映する。

27. 完了定義

本定義書v1.0に基づくModel v0.1.0は、SCN-01の無介入48か月を安定完走し、主要5政策のgolden response testが方向・時間差・大きさの許容範囲を満たし、1,000 seedの8年実行でNaN、Infinity、進行不能を発生させないことを最初の完成条件とする。
その後、SCN-02/03、20年、30年へ拡張して係数を再調整する。
