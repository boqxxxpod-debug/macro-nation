import {
  flowPerMonth,indexLevel,logIndex,percentRate,
  type CausalContribution,type CausalMetricId,type CausalRef,type ConfigSnapshot,
  type EconomyState,type RngBundle,type ScheduledEffect,
} from "@macro-nation/domain";
import { createContributionBuilder } from "./causal";
import type { TickRngProvider,TickStageHandler } from "./tick";

type MacroParameterId =
  | "CORE-GROW-001"|"CORE-INF-001"|"CORE-U-001"
  | "LAB-OKUN-001"|"LAB-MR-MONTHLY-001"
  | "INF-PERS-001"|"INF-GAP-001"|"INF-ERR-001"|"INF-IMPORT-001"|"INF-WAGE-001"
  | "IMP-FX-001"|"IMP-RESOURCE-001"|"IMP-STATE-001"
  | "EXP-PERS-001"|"EXP-ANCHOR-001"|"WAGE-INF-001"|"WAGE-LABOR-001"
  | "FX-RATE-DIFF-001"|"FX-CA-001"|"FX-TRUST-RISK-001"|"FX-SPEC-001"|"FX-ERR-001";

interface Term { readonly source:CausalRef; readonly delta:number; }
export interface MacroInput {
  readonly economy:EconomyState;
  readonly effects:readonly ScheduledEffect[];
  readonly monthIndex:number;
  readonly configSnapshot:ConfigSnapshot;
  readonly rng:RngBundle;
  readonly rngProvider:TickRngProvider;
}
export interface MacroOutput {
  readonly economy:EconomyState;
  readonly rng:RngBundle;
  readonly causal:readonly CausalContribution[];
}
function params(snapshot:ConfigSnapshot):Readonly<Record<string,number>>{
  const value=snapshot.normalizedConfig.parameters;
  if(!value||typeof value!=="object"||Array.isArray(value)) throw new Error("ConfigSnapshot.normalizedConfig.parameters is required");
  return value as Readonly<Record<string,number>>;
}
function p(values:Readonly<Record<string,number>>,id:MacroParameterId):number{
  const value=values[id];
  if(typeof value!=="number"||!Number.isFinite(value)) throw new Error(`Missing or invalid macro parameter ${id}`);
  return value;
}
function annualToMonthly(rate:number):number{
  if(rate<=-1) throw new RangeError("annual rate must exceed -100%");
  return Math.pow(1+rate,1/12)-1;
}
function monthlyToAnnual(rate:number):number{
  if(rate<=-1) return -0.999999;
  return Math.pow(1+rate,12)-1;
}
function source(id:string,type:CausalRef["sourceType"]="inertia",confidence:CausalRef["confidence"]="medium"):CausalRef{
  return {sourceType:type,sourceId:id,labelKey:`model.${id}`,confidence};
}
function activeEffects(effects:readonly ScheduledEffect[],month:number,target:string,before:number):Term[]{
  const result:Term[]=[];
  for(const effect of effects){
    if(effect.targetPath!==target||month<effect.startMonth||month>effect.endMonth) continue;
    const weight=effect.weights[month-effect.startMonth]??0;
    if(!Number.isFinite(weight)||weight===0) continue;
    const strength=effect.baseStrength*weight;
    result.push({source:{sourceType:effect.sourceType,sourceId:effect.sourceId,labelKey:effect.labelKey,confidence:"high"},
      delta:effect.operation==="addDelta"?strength:before*strength});
  }
  return result;
}
function build(id:CausalMetricId,before:number,terms:readonly Term[],min?:number,max?:number){
  const builder=createContributionBuilder(id,before);
  for(const term of terms) builder.add(term.source,term.delta);
  builder.clamp(min,max);
  const causal=builder.build();
  return {value:causal.afterValue,causal};
}
function distributeDelta(before:number,after:number,monthlyTerms:readonly Term[]):Term[]{
  const totalMonthly=monthlyTerms.reduce((s,t)=>s+t.delta,0);
  const total=after-before;
  if(Math.abs(totalMonthly)<1e-15) return total===0?[]:[{source:source("nonlinear-reconciliation"),delta:total}];
  return monthlyTerms.map(term=>({source:term.source,delta:total*(term.delta/totalMonthly)}));
}

export function updatePricesLabor(input:MacroInput):MacroOutput{
  const values=params(input.configSnapshot); const e=input.economy;
  let rng=input.rng;
  const inflationDraw=input.rngProvider.drawFloat01(rng,"error.inflation"); rng=inflationDraw.bundle;
  const target=p(values,"CORE-INF-001"), naturalU=p(values,"CORE-U-001");
  const outputGap=e.indices.realGdp/e.indices.potentialGdp-1;
  const inflationStress=Math.max(0,e.rates.inflationAnnual-target);
  const lowTrust=Math.max(0,(50-e.sentiment.policyTrust)/50);
  const passThrough=Math.min(1.2,p(values,"IMP-FX-001")*(1+p(values,"IMP-STATE-001")*(inflationStress*10+lowTrust)));
  const fxGap=e.indices.fx/100-1,resourceGap=e.external.resourcePriceIndex/100-1;
  const importTarget=Math.max(1,100*(1+passThrough*fxGap+p(values,"IMP-RESOURCE-001")*resourceGap));
  const importPrice=build("importPrice",e.indices.importPrice,[
    {source:source("fx-import-pass-through","external","high"),delta:importTarget-e.indices.importPrice},
  ],1);
  const importGrowth=e.indices.importPrice===0?0:importPrice.value/e.indices.importPrice-1;

  const expectedNext=p(values,"EXP-PERS-001")*e.rates.expectedInflation+
    (1-p(values,"EXP-PERS-001"))*((1-p(values,"EXP-ANCHOR-001"))*e.rates.inflationAnnual+p(values,"EXP-ANCHOR-001")*target);
  const expected=build("expectedInflation",e.rates.expectedInflation,[
    {source:source("expected-inflation-adaptation"),delta:expectedNext-e.rates.expectedInflation},
  ],-0.1,0.5);

  const wageMonthly=p(values,"WAGE-INF-001")*annualToMonthly(expected.value)-
    p(values,"WAGE-LABOR-001")*(e.rates.unemployment-naturalU)/12;
  const wage=build("nominalWage",e.indices.nominalWage,[
    {source:source("wage-inflation-expectations"),delta:e.indices.nominalWage*wageMonthly},
  ],1);
  const wageGrowth=wage.value/e.indices.nominalWage-1;

  const prevMonthly=annualToMonthly(e.rates.inflationAnnual);
  const expMonthly=annualToMonthly(expected.value);
  const monthlyTerms:Term[]=[
    {source:source("inflation-inertia"),delta:(p(values,"INF-PERS-001")-1)*prevMonthly},
    {source:source("inflation-expectations"),delta:(1-p(values,"INF-PERS-001"))*expMonthly},
    {source:source("inflation-output-gap"),delta:p(values,"INF-GAP-001")*outputGap/12},
    {source:source("inflation-import-price","external"),delta:p(values,"INF-IMPORT-001")*importGrowth},
    {source:source("inflation-wage"),delta:p(values,"INF-WAGE-001")*wageGrowth},
    {source:source("error.inflation","random","low"),delta:p(values,"INF-ERR-001")*(2*inflationDraw.value-1)},
  ];
  const rawMonthly=prevMonthly+monthlyTerms.reduce((s,t)=>s+t.delta,0);
  const rawAnnual=monthlyToAnnual(rawMonthly);
  const inflationTerms=distributeDelta(e.rates.inflationAnnual,rawAnnual,monthlyTerms);
  inflationTerms.push(...activeEffects(input.effects,input.monthIndex,"economy.rates.inflationAnnual",e.rates.inflationAnnual));
  const inflation=build("inflation",e.rates.inflationAnnual,inflationTerms,-0.1,0.5);
  const appliedMonthly=annualToMonthly(inflation.value);
  const cpi=build("cpi",e.indices.cpi,[
    {source:source("cpi-inflation"),delta:e.indices.cpi*appliedMonthly},
  ],1);

  const uDelta=p(values,"LAB-MR-MONTHLY-001")*(naturalU-e.rates.unemployment)-
    p(values,"LAB-OKUN-001")*outputGap/12;
  const unemploymentTerms:Term[]=[
    {source:source("unemployment-mean-reversion"),delta:p(values,"LAB-MR-MONTHLY-001")*(naturalU-e.rates.unemployment)},
    {source:source("okun-output-gap"),delta:-p(values,"LAB-OKUN-001")*outputGap/12},
    ...activeEffects(input.effects,input.monthIndex,"economy.rates.unemployment",e.rates.unemployment),
  ];
  if(!Number.isFinite(uDelta)) throw new Error("Invalid unemployment delta");
  const unemployment=build("unemployment",e.rates.unemployment,unemploymentTerms,0.02,0.3);

  return {rng,causal:[importPrice.causal,expected.causal,wage.causal,inflation.causal,cpi.causal,unemployment.causal],
    economy:{...e,indices:{...e.indices,importPrice:indexLevel(importPrice.value),nominalWage:indexLevel(wage.value),cpi:indexLevel(cpi.value)},
      rates:{...e.rates,expectedInflation:percentRate(expected.value),inflationAnnual:percentRate(inflation.value),unemployment:percentRate(unemployment.value)}}};
}

export function updateFx(input:MacroInput):MacroOutput{
  const values=params(input.configSnapshot); const e=input.economy;
  let rng=input.rng; const draw=input.rngProvider.drawFloat01(rng,"error.fx"); rng=draw.bundle;
  const caRatio=e.indices.realGdp===0?0:e.flows.currentAccount/e.indices.realGdp;
  const logs:Term[]=[
    {source:source("fx-rate-gap","external"),delta:p(values,"FX-RATE-DIFF-001")*(e.rates.foreignRate-e.rates.marketRate)/12},
    {source:source("fx-current-account"),delta:p(values,"FX-CA-001")*caRatio/12},
    {source:source("fx-trust-risk"),delta:p(values,"FX-TRUST-RISK-001")*((50-e.sentiment.policyTrust)/100)/12},
    {source:source("fx-speculation"),delta:p(values,"FX-SPEC-001")*(e.sentiment.speculationPressure/100)/12},
    {source:source("error.fx","random","low"),delta:p(values,"FX-ERR-001")*(2*draw.value-1)},
  ];
  const logChange=logs.reduce((s,t)=>s+t.delta,0);
  const marketAfter=e.indices.fx*Math.exp(logChange);
  const totalDelta=marketAfter-e.indices.fx;
  const levelTerms:Term[]=Math.abs(logChange)<1e-15?[]:logs.map(t=>({source:t.source,delta:totalDelta*(t.delta/logChange)}));
  levelTerms.push(...activeEffects(input.effects,input.monthIndex,"economy.indices.fx",e.indices.fx));
  const fx=build("fx",e.indices.fx,levelTerms,20,500);
  const capitalFlow=flowPerMonth((e.rates.marketRate-e.rates.foreignRate)*e.indices.realGdp);
  return {rng,causal:[fx.causal],economy:{...e,indices:{...e.indices,fx:indexLevel(fx.value)},
    flows:{...e.flows,capitalFlow},external:{...e.external,fxShockLogIndex:logIndex(logChange)}}};
}

export const updatePricesLaborStage:TickStageHandler=({state,context})=>{
  const r=updatePricesLabor({economy:state.economy,effects:state.effects,monthIndex:state.monthIndex,configSnapshot:context.configSnapshot,rng:state.rng,rngProvider:context.rngProvider});
  return {state:{...state,economy:r.economy,rng:r.rng},causal:r.causal};
};
export const updateFxStage:TickStageHandler=({state,context})=>{
  const r=updateFx({economy:state.economy,effects:state.effects,monthIndex:state.monthIndex,configSnapshot:context.configSnapshot,rng:state.rng,rngProvider:context.rngProvider});
  return {state:{...state,economy:r.economy,rng:r.rng},causal:r.causal};
};
