import {
 flowPerMonth,indexLevel,percentRate,scorePoint,stockLevel,
 type CausalContribution,type CausalMetricId,type CausalRef,type ConfigSnapshot,
 type EconomyState,type GameState,type IndustryId,type ScheduledEffect,
} from "@macro-nation/domain";
import { createContributionBuilder } from "./causal";
import type { TickStageHandler } from "./tick";

type FiscalParameterId =
 | "CORE-GROW-001"|"CORE-INF-001"|"CORE-U-001"|"DEBT-REPRICE-001"
 | "FISC-TAX-ELAS-001"|"RISK-DEBT-001"|"RISK-TRUST-001"
 | "TRUST-MR-001"|"TRUST-ANCHOR-001"|"TRUST-INF-001"|"TRUST-U-001"|"TRUST-DEBT-001"
 | "POLCAP-TRUST-001"|"IND-GDP-001"|"IND-CAP-001"|"LT-POP-001"|"LT-INFRA-001";
interface Term {readonly source:CausalRef;readonly delta:number;}
export interface FiscalIndustryInput {
 readonly economy:EconomyState;readonly effects:readonly ScheduledEffect[];readonly monthIndex:number;readonly configSnapshot:ConfigSnapshot;
}
export interface LongTermHooks {
 readonly populationGrowthAnnual:number;readonly productivityGrowthAnnual:number;readonly infrastructureContributionAnnual:number;
}
export interface FiscalIndustryOutput {readonly economy:EconomyState;readonly causal:readonly CausalContribution[];readonly longTermHooks:LongTermHooks;}
function parameters(snapshot:ConfigSnapshot):Readonly<Record<string,number>>{
 const value=snapshot.normalizedConfig.parameters;
 if(!value||typeof value!=="object"||Array.isArray(value)) throw new Error("ConfigSnapshot.normalizedConfig.parameters is required");
 return value as Readonly<Record<string,number>>;
}
function p(values:Readonly<Record<string,number>>,id:FiscalParameterId):number{
 const value=values[id]; if(typeof value!=="number"||!Number.isFinite(value)) throw new Error(`Missing or invalid fiscal parameter ${id}`); return value;
}
function source(id:string,confidence:CausalRef["confidence"]="medium"):CausalRef{return {sourceType:"inertia",sourceId:id,labelKey:`model.${id}`,confidence};}
function effects(all:readonly ScheduledEffect[],month:number,target:string,before:number):Term[]{
 const out:Term[]=[]; for(const effect of all){
  if(effect.targetPath!==target||month<effect.startMonth||month>effect.endMonth) continue;
  const weight=effect.weights[month-effect.startMonth]??0;if(!Number.isFinite(weight)||weight===0) continue;
  const strength=effect.baseStrength*weight;
  out.push({source:{sourceType:effect.sourceType,sourceId:effect.sourceId,labelKey:effect.labelKey,confidence:"high"},delta:effect.operation==="addDelta"?strength:before*strength});
 } return out;
}
function build(id:CausalMetricId,before:number,terms:readonly Term[],min?:number,max?:number){
 const b=createContributionBuilder(id,before); for(const t of terms)b.add(t.source,t.delta);b.clamp(min,max);const causal=b.build();return {value:causal.afterValue,causal};
}
export function deriveRiskPremium(e:EconomyState,config:ConfigSnapshot):number{
 const v=parameters(config);const debtGap=Math.max(0,e.ratios.governmentDebtRatio-0.9);const trustGap=Math.max(0,(50-e.sentiment.policyTrust)/100);
 return p(v,"RISK-DEBT-001")*debtGap+p(v,"RISK-TRUST-001")*trustGap;
}
export function getLongTermHooks(e:EconomyState,config:ConfigSnapshot):LongTermHooks{
 const v=parameters(config);
 const avg=(e.infrastructure.transport+e.infrastructure.energy+e.infrastructure.digital+e.infrastructure.water+e.infrastructure.publicFacilities)/5;
 return {populationGrowthAnnual:p(v,"LT-POP-001"),productivityGrowthAnnual:p(v,"CORE-GROW-001"),infrastructureContributionAnnual:p(v,"LT-INFRA-001")*(avg/100-1)};
}
export function updateFiscalIndustries(input:FiscalIndustryInput):FiscalIndustryOutput{
 const v=parameters(input.configSnapshot),e=input.economy;const outputGap=e.indices.realGdp/e.indices.potentialGdp-1;
 const tax=build("taxRevenue",e.flows.taxRevenue,[
  {source:source("FISC-TAX-ELAS-001"),delta:e.flows.taxRevenue*p(v,"FISC-TAX-ELAS-001")*outputGap/12},
  ...effects(input.effects,input.monthIndex,"economy.flows.taxRevenue",e.flows.taxRevenue),
 ],0);
 const spending=build("primarySpending",e.flows.primarySpending,effects(input.effects,input.monthIndex,"economy.flows.primarySpending",e.flows.primarySpending),0);
 const oldEffectiveRate=e.stocks.governmentDebt>0?e.flows.interestPayment*12/e.stocks.governmentDebt:e.rates.marketRate;
 const effectiveRate=oldEffectiveRate+p(v,"DEBT-REPRICE-001")*(e.rates.marketRate-oldEffectiveRate);
 const interest=build("interestPayment",e.flows.interestPayment,[
  {source:source("debt-repricing","high"),delta:e.stocks.governmentDebt*effectiveRate/12-e.flows.interestPayment},
 ],0);
 const debtDelta=spending.value-tax.value+interest.value;
 const debt=build("governmentDebt",e.stocks.governmentDebt,[{source:source("fiscal-stock-flow","high"),delta:debtDelta}],0);
 const domesticShare=e.stocks.governmentDebt>0?e.stocks.domesticGovernmentDebt/e.stocks.governmentDebt:1;
 const domestic=debt.value*domesticShare,external=debt.value-domestic;
 const annualNominalGdp=Math.max(1e-9,e.indices.realGdp*(e.indices.cpi/100)*12);
 const debtRatio=debt.value/annualNominalGdp;
 const fiscalBalance=(tax.value-spending.value-interest.value)*12/annualNominalGdp;

 const trustTerms:Term[]=[
  {source:source("TRUST-MR-001"),delta:p(v,"TRUST-MR-001")*(p(v,"TRUST-ANCHOR-001")-e.sentiment.policyTrust)},
  {source:source("TRUST-INF-001"),delta:-p(v,"TRUST-INF-001")*Math.abs(e.rates.inflationAnnual-p(v,"CORE-INF-001"))/12},
  {source:source("TRUST-U-001"),delta:-p(v,"TRUST-U-001")*Math.max(0,e.rates.unemployment-p(v,"CORE-U-001"))/12},
  {source:source("TRUST-DEBT-001"),delta:-p(v,"TRUST-DEBT-001")*Math.max(0,debtRatio-0.9)/12},
  ...effects(input.effects,input.monthIndex,"economy.sentiment.policyTrust",e.sentiment.policyTrust),
 ];
 const trust=build("policyTrust",e.sentiment.policyTrust,trustTerms,0,100);
 const political=build("politicalCapital",e.institutions.politicalCapital,[
  {source:source("POLCAP-TRUST-001"),delta:p(v,"POLCAP-TRUST-001")*(trust.value-50)/12},
 ],0,100);

 const industryCausal:CausalContribution[]=[];const raw:Record<string,number>={};
 for(const [id,state] of Object.entries(e.industries) as [IndustryId,EconomyState["industries"][IndustryId]][]){
  const metric=`industry.${id}.production` as const;
  const result=build(metric,state.productionIndex,[
   {source:source("IND-GDP-001"),delta:state.productionIndex*p(v,"IND-GDP-001")*outputGap/12},
   ...effects(input.effects,input.monthIndex,`economy.industries.${id}.productionIndex`,state.productionIndex),
  ],1);
  raw[id]=result.value;industryCausal.push(result.causal);
 }
 let aggregate=0;for(const [id,state] of Object.entries(e.industries) as [IndustryId,EconomyState["industries"][IndustryId]][]) aggregate+=(raw[id]??state.productionIndex)*state.employmentShare;
 const scale=aggregate===0?1:e.indices.realGdp/aggregate;
 const industries={...e.industries};
 for(const [id,state] of Object.entries(e.industries) as [IndustryId,EconomyState["industries"][IndustryId]][]){
  const production=(raw[id]??state.productionIndex)*scale;
  const capacity=Math.max(1,state.capacityIndex*(1+p(v,"IND-CAP-001")*p(v,"CORE-GROW-001")/12));
  industries[id]={...state,productionIndex:indexLevel(production),capacityIndex:indexLevel(capacity),priceIndex:indexLevel(Math.max(1,state.priceIndex*(e.indices.cpi/100)))};
  if(Math.abs(scale-1)>1e-12){
   const index=industryCausal.findIndex(c=>c.indicatorId===`industry.${id}.production`);
   if(index>=0){
    const b=createContributionBuilder(`industry.${id}.production`,state.productionIndex);
    for(const term of industryCausal[index]!.contributions)b.add(term,term.delta);
    b.add(source("industry-aggregate-reconciliation","high"),production-(raw[id]??state.productionIndex));
    industryCausal[index]=b.build(production);
   }
  }
 }
 const economy:EconomyState={...e,
  flows:{...e.flows,taxRevenue:flowPerMonth(tax.value),primarySpending:flowPerMonth(spending.value),interestPayment:flowPerMonth(interest.value)},
  stocks:{...e.stocks,governmentDebt:stockLevel(debt.value),domesticGovernmentDebt:stockLevel(domestic),externalGovernmentDebt:stockLevel(external)},
  ratios:{governmentDebtRatio:percentRate(debtRatio),fiscalBalanceRatio:percentRate(fiscalBalance)},
  sentiment:{...e.sentiment,policyTrust:scorePoint(trust.value)},
  institutions:{...e.institutions,politicalCapital:scorePoint(political.value)},industries};
 return {economy,causal:[tax.causal,spending.causal,interest.causal,debt.causal,trust.causal,political.causal,...industryCausal],longTermHooks:getLongTermHooks(economy,input.configSnapshot)};
}
export const updateFiscalIndustriesStage:TickStageHandler=({state,context})=>{
 const r=updateFiscalIndustries({economy:state.economy,effects:state.effects,monthIndex:state.monthIndex,configSnapshot:context.configSnapshot});
 const next:GameState={...state,economy:r.economy,resources:{...state.resources,politicalCapital:r.economy.institutions.politicalCapital}};
 return {state:next,causal:r.causal,notes:[`longTerm.productivity=${r.longTermHooks.productivityGrowthAnnual}`]};
};
