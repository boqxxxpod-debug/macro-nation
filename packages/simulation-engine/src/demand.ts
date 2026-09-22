import {
  flowPerMonth,
  indexLevel,
  type CausalContribution,
  type CausalMetricId,
  type CausalRef,
  type ConfigSnapshot,
  type EconomyState,
  type GameState,
  type RngBundle,
  type ScheduledEffect,
} from "@macro-nation/domain";
import { createContributionBuilder } from "./causal";
import type { TickRngProvider, TickStageHandler } from "./tick";

const PARAMETER_IDS = [
  "CORE-GROW-001","CORE-INF-001","CORE-U-001","CORE-R-001",
  "CONS-BASE-001","CONS-Y-001","CONS-R-001","CONS-U-001","CONS-INF-001",
  "CONS-TRUST-001","CONS-ERR-001","INV-BASE-001","INV-GAP-001","INV-PROD-001",
  "INV-R-001","INV-UNC-001","INV-TRUST-001","INV-ERR-001","EXT-GROW-001",
  "X-FOREIGN-001","X-FX-001","M-DEMAND-001","M-FX-001",
  "GDP-SHARE-C-001","GDP-SHARE-I-001","GDP-SHARE-G-001","GDP-SHARE-X-001","GDP-SHARE-M-001",
] as const;
type DemandParameterId = (typeof PARAMETER_IDS)[number];

export interface DemandDiagnostics {
  readonly outputGapBefore: number;
  readonly outputGapAfter: number;
  readonly realGdpMonthlyGrowth: number;
  readonly componentGrowth: Readonly<Record<"consumption"|"investment"|"governmentConsumption"|"exports"|"imports", number>>;
}
export interface DemandInput {
  readonly economy: EconomyState;
  readonly effects: readonly ScheduledEffect[];
  readonly monthIndex: number;
  readonly configSnapshot: ConfigSnapshot;
  readonly rng: RngBundle;
  readonly rngProvider: TickRngProvider;
}
export interface DemandOutput {
  readonly economy: EconomyState;
  readonly rng: RngBundle;
  readonly causal: readonly CausalContribution[];
  readonly diagnostics: DemandDiagnostics;
}
interface DeltaTerm { readonly source: CausalRef; readonly delta: number; }

function getParameters(snapshot: ConfigSnapshot): Readonly<Record<string, number>> {
  const value = snapshot.normalizedConfig.parameters;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ConfigSnapshot.normalizedConfig.parameters is required");
  }
  return value as Readonly<Record<string, number>>;
}
function parameter(p: Readonly<Record<string, number>>, id: DemandParameterId): number {
  const value = p[id];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Missing or invalid demand parameter ${id}`);
  return value;
}
function annualToMonthly(rate: number): number {
  if (rate <= -1) throw new RangeError("annual rate must be greater than -100%");
  return Math.pow(1 + rate, 1 / 12) - 1;
}
function macroSource(sourceId: string, confidence: CausalRef["confidence"] = "medium"): CausalRef {
  return { sourceType:"inertia", sourceId, labelKey:`model.${sourceId}`, confidence };
}
function scheduledTerms(
  effects: readonly ScheduledEffect[], monthIndex: number, targetPath: string, before: number,
): DeltaTerm[] {
  const terms: DeltaTerm[] = [];
  for (const effect of effects) {
    if (effect.targetPath !== targetPath || monthIndex < effect.startMonth || monthIndex > effect.endMonth) continue;
    const weight = effect.weights[monthIndex - effect.startMonth] ?? 0;
    if (!Number.isFinite(weight) || weight === 0) continue;
    const strength = effect.baseStrength * weight;
    const delta = effect.operation === "addDelta" ? strength : before * strength;
    terms.push({
      source:{sourceType:effect.sourceType,sourceId:effect.sourceId,labelKey:effect.labelKey,confidence:"high"},
      delta,
    });
  }
  return terms;
}
function buildComponent(metricId: CausalMetricId, before: number, terms: readonly DeltaTerm[]) {
  const builder = createContributionBuilder(metricId, before);
  for (const term of terms) builder.add(term.source, term.delta);
  builder.clamp(0);
  const causal = builder.build();
  return { value: causal.afterValue, causal };
}
function growth(after:number,before:number):number { return before === 0 ? 0 : after / before - 1; }
function assertGdpShares(p: Readonly<Record<string, number>>): void {
  const identity = parameter(p,"GDP-SHARE-C-001")+parameter(p,"GDP-SHARE-I-001")+
    parameter(p,"GDP-SHARE-G-001")+parameter(p,"GDP-SHARE-X-001")-parameter(p,"GDP-SHARE-M-001");
  if (Math.abs(identity - 1) > 1e-10) throw new Error("GDP shares must satisfy C + I + G + X - M = 1");
}

export function updateDemandAndGdp(input: DemandInput): DemandOutput {
  const p = getParameters(input.configSnapshot);
  for (const id of PARAMETER_IDS) parameter(p,id);
  assertGdpShares(p);
  const e = input.economy;
  const outputGapBefore = e.indices.realGdp / e.indices.potentialGdp - 1;
  const realRateGap = e.rates.marketRate - e.rates.expectedInflation - parameter(p,"CORE-R-001");
  const unemploymentGap = e.rates.unemployment - parameter(p,"CORE-U-001");
  const inflationGap = e.rates.inflationAnnual - parameter(p,"CORE-INF-001");
  const incomeGap = e.indices.realHouseholdIncome / 100 - 1;
  const trustGap = (e.sentiment.policyTrust - 50) / 100;
  const uncertainty = e.sentiment.speculationPressure / 100;
  const fxGap = e.indices.fx / 100 - 1;
  const foreignGrowthGap = e.external.foreignGrowthAnnual - parameter(p,"EXT-GROW-001");

  let rng = input.rng;
  const cDraw = input.rngProvider.drawFloat01(rng,"error.consumption"); rng = cDraw.bundle;
  const iDraw = input.rngProvider.drawFloat01(rng,"error.investment"); rng = iDraw.bundle;

  const c0=e.flows.consumption;
  const consumption=buildComponent("consumption",c0,[
    {source:macroSource("CONS-BASE-001","high"),delta:c0*annualToMonthly(parameter(p,"CONS-BASE-001"))},
    {source:macroSource("CONS-Y-001"),delta:c0*parameter(p,"CONS-Y-001")*incomeGap/12},
    {source:macroSource("CONS-R-001"),delta:-c0*parameter(p,"CONS-R-001")*realRateGap/12},
    {source:macroSource("CONS-U-001"),delta:-c0*parameter(p,"CONS-U-001")*unemploymentGap/12},
    {source:macroSource("CONS-INF-001"),delta:-c0*parameter(p,"CONS-INF-001")*inflationGap/12},
    {source:macroSource("CONS-TRUST-001"),delta:c0*parameter(p,"CONS-TRUST-001")*trustGap/12},
    {source:{sourceType:"random",sourceId:"error.consumption",labelKey:"random.consumption",confidence:"low"},
      delta:c0*parameter(p,"CONS-ERR-001")*(2*cDraw.value-1)},
    ...scheduledTerms(input.effects,input.monthIndex,"economy.flows.consumption",c0),
  ]);

  const i0=e.flows.investment;
  const investment=buildComponent("investment",i0,[
    {source:macroSource("INV-BASE-001","high"),delta:i0*annualToMonthly(parameter(p,"INV-BASE-001"))},
    {source:macroSource("INV-GAP-001"),delta:i0*parameter(p,"INV-GAP-001")*outputGapBefore/12},
    {source:macroSource("INV-PROD-001"),delta:i0*parameter(p,"INV-PROD-001")*parameter(p,"CORE-GROW-001")/12},
    {source:macroSource("INV-R-001"),delta:-i0*parameter(p,"INV-R-001")*realRateGap/12},
    {source:macroSource("INV-UNC-001"),delta:-i0*parameter(p,"INV-UNC-001")*uncertainty/12},
    {source:macroSource("INV-TRUST-001"),delta:i0*parameter(p,"INV-TRUST-001")*trustGap/12},
    {source:{sourceType:"random",sourceId:"error.investment",labelKey:"random.investment",confidence:"low"},
      delta:i0*parameter(p,"INV-ERR-001")*(2*iDraw.value-1)},
    ...scheduledTerms(input.effects,input.monthIndex,"economy.flows.investment",i0),
  ]);

  const g0=e.flows.governmentConsumption;
  const government=buildComponent("governmentConsumption",g0,
    scheduledTerms(input.effects,input.monthIndex,"economy.flows.governmentConsumption",g0));

  const x0=e.flows.exports;
  const exports=buildComponent("exports",x0,[
    {source:{sourceType:"external",sourceId:"foreign-growth",labelKey:"external.foreignGrowth",confidence:"medium"},
      delta:x0*parameter(p,"X-FOREIGN-001")*foreignGrowthGap/12},
    {source:{sourceType:"external",sourceId:"real-fx-gap",labelKey:"external.fx",confidence:"medium"},
      delta:x0*parameter(p,"X-FX-001")*fxGap/12},
    ...scheduledTerms(input.effects,input.monthIndex,"economy.flows.exports",x0),
  ]);

  const m0=e.flows.imports;
  const imports=buildComponent("imports",m0,[
    {source:macroSource("M-DEMAND-001"),delta:m0*parameter(p,"M-DEMAND-001")*outputGapBefore/12},
    {source:{sourceType:"external",sourceId:"real-fx-gap",labelKey:"external.fx",confidence:"medium"},
      delta:m0*parameter(p,"M-FX-001")*fxGap/12},
    ...scheduledTerms(input.effects,input.monthIndex,"economy.flows.imports",m0),
  ]);

  const gdp0=e.indices.realGdp;
  const gdpBuilder=createContributionBuilder("realGdp",gdp0);
  for (const [causal,sign] of [[consumption.causal,1],[investment.causal,1],[government.causal,1],[exports.causal,1],[imports.causal,-1]] as const) {
    for (const term of causal.contributions) gdpBuilder.add(term,sign*term.delta);
  }
  const accountingBefore=c0+i0+g0+x0-m0;
  if (Math.abs(accountingBefore-gdp0)>1e-9) {
    gdpBuilder.add({sourceType:"inertia",sourceId:"gdp-accounting-alignment",labelKey:"diagnostic.gdpAccountingAlignment",confidence:"high"},accountingBefore-gdp0);
  }
  gdpBuilder.clamp(0);
  const gdpAfter=consumption.value+investment.value+government.value+exports.value-imports.value;
  const realGdpCausal=gdpBuilder.build(gdpAfter);

  const economy: EconomyState={
    ...e,
    indices:{...e.indices,realGdp:indexLevel(realGdpCausal.afterValue)},
    flows:{...e.flows,consumption:flowPerMonth(consumption.value),investment:flowPerMonth(investment.value),
      governmentConsumption:flowPerMonth(government.value),exports:flowPerMonth(exports.value),imports:flowPerMonth(imports.value)},
  };
  return {
    economy,rng,
    causal:[consumption.causal,investment.causal,government.causal,exports.causal,imports.causal,realGdpCausal],
    diagnostics:{
      outputGapBefore,outputGapAfter:economy.indices.realGdp/economy.indices.potentialGdp-1,
      realGdpMonthlyGrowth:growth(economy.indices.realGdp,gdp0),
      componentGrowth:{consumption:growth(consumption.value,c0),investment:growth(investment.value,i0),
        governmentConsumption:growth(government.value,g0),exports:growth(exports.value,x0),imports:growth(imports.value,m0)},
    },
  };
}

export const updateDemandStage: TickStageHandler=({state,context})=>{
  const result=updateDemandAndGdp({economy:state.economy,effects:state.effects,monthIndex:state.monthIndex,
    configSnapshot:context.configSnapshot,rng:state.rng,rngProvider:context.rngProvider});
  const next:GameState={...state,economy:result.economy,rng:result.rng};
  return {state:next,causal:result.causal,notes:[
    `demand.outputGap=${result.diagnostics.outputGapAfter}`,
    `demand.realGdpMonthlyGrowth=${result.diagnostics.realGdpMonthlyGrowth}`,
  ]};
};
