import { describe,expect,it } from "vitest";
import {
  flowPerMonth,indexLevel,percentRate,scorePoint,share01,stockLevel,
  type ConfigSnapshot,type EconomyState,type IndustryId,
} from "@macro-nation/domain";
import { XOSHIRO_TICK_RNG_PROVIDER,createRngBundle,updateFx,updatePricesLabor } from "./index";
function e():EconomyState{
 const industries=Object.fromEntries(["agricultureResources","manufacturing","construction","householdServices","financeRealEstate","energyLogistics"].map(id=>[id,{productionIndex:indexLevel(100),employmentShare:share01(1/6),capacityIndex:indexLevel(100),importDependency:share01(.2),priceIndex:indexLevel(100)}])) as Record<IndustryId,EconomyState["industries"][IndustryId]>;
 return {indices:{realGdp:indexLevel(100),cpi:indexLevel(100),fx:indexLevel(100),nominalWage:indexLevel(100),realHouseholdIncome:indexLevel(100),potentialGdp:indexLevel(100),importPrice:indexLevel(100)},
 rates:{inflationAnnual:percentRate(.02),unemployment:percentRate(.05),policyRate:percentRate(.02),marketRate:percentRate(.025),expectedInflation:percentRate(.02),foreignRate:percentRate(.025)},
 ratios:{governmentDebtRatio:percentRate(.9),fiscalBalanceRatio:percentRate(-.03)},
 flows:{consumption:flowPerMonth(60),investment:flowPerMonth(18),governmentConsumption:flowPerMonth(20),publicInvestment:flowPerMonth(4),exports:flowPerMonth(25),imports:flowPerMonth(23),taxRevenue:flowPerMonth(28),primarySpending:flowPerMonth(30),interestPayment:flowPerMonth(2),currentAccount:flowPerMonth(2),capitalFlow:flowPerMonth(0)},
 stocks:{governmentDebt:stockLevel(1080),domesticGovernmentDebt:stockLevel(800),externalGovernmentDebt:stockLevel(280),foreignReserves:stockLevel(300)},
 sentiment:{consumerConfidence:scorePoint(50),businessConfidence:scorePoint(50),policyTrust:scorePoint(60),support:scorePoint(55),inequality:scorePoint(40),speculationPressure:scorePoint(0)},
 institutions:{politicalCapital:scorePoint(60),implementationCapacity:scorePoint(65),centralBankIndependence:scorePoint(80),taxCapacity:scorePoint(70),procurementTransparency:scorePoint(70)},
 industries,infrastructure:{transport:indexLevel(100),energy:indexLevel(100),digital:indexLevel(100),water:indexLevel(100),publicFacilities:indexLevel(100)},
 external:{foreignGrowthAnnual:percentRate(.025),foreignRateAnnual:percentRate(.025),resourcePriceIndex:indexLevel(100),partnerRelations:scorePoint(60),disasterAlert:scorePoint(20),fxShockLogIndex:0 as EconomyState["external"]["fxShockLogIndex"]}};
}
function config():ConfigSnapshot{return {snapshotVersion:"t",configHash:"a".repeat(64),sourceManifest:[],normalizedConfig:{parameters:{
 "CORE-GROW-001":.018,"CORE-INF-001":.02,"CORE-U-001":.05,"LAB-OKUN-001":.45,"LAB-MR-MONTHLY-001":.04,
 "INF-PERS-001":.9,"INF-GAP-001":.12,"INF-ERR-001":0,"INF-IMPORT-001":.05,"INF-WAGE-001":.08,
 "IMP-FX-001":.65,"IMP-RESOURCE-001":.3,"IMP-STATE-001":.25,"EXP-PERS-001":.9,"EXP-ANCHOR-001":.35,
 "WAGE-INF-001":.4,"WAGE-LABOR-001":.2,"FX-RATE-DIFF-001":.8,"FX-CA-001":-.25,"FX-TRUST-RISK-001":.2,"FX-SPEC-001":.15,"FX-ERR-001":0,
 }}}}
const base=(economy:EconomyState)=>({economy,effects:[],monthIndex:0,configSnapshot:config(),rng:createRngBundle("macro"),rngProvider:XOSHIRO_TICK_RNG_PROVIDER});
describe("prices labor and FX",()=>{
 it("passes a 10% depreciation into import prices in the calibrated first-month band",()=>{
  const x=e(); const r=updatePricesLabor(base({...x,indices:{...x.indices,fx:indexLevel(110)}}));
  expect(r.economy.indices.importPrice).toBeGreaterThanOrEqual(105); expect(r.economy.indices.importPrice).toBeLessThanOrEqual(108);
 });
 it("raises inflation and lowers unemployment when output is above potential",()=>{
  const x=e(); const hot={...x,indices:{...x.indices,realGdp:indexLevel(104)}}; const r=updatePricesLabor(base(hot));
  expect(r.economy.rates.inflationAnnual).toBeGreaterThan(x.rates.inflationAnnual);
  expect(r.economy.rates.unemployment).toBeLessThan(x.rates.unemployment);
 });
 it("appreciates the currency when the domestic market rate rises",()=>{
  const x=e(); const high={...x,rates:{...x.rates,marketRate:percentRate(.05)}}; const r=updateFx(base(high));
  expect(r.economy.indices.fx).toBeLessThan(x.indices.fx);
 });
 it("depreciates after a policy-trust collapse and remains finite",()=>{
  const x=e(); const weak={...x,sentiment:{...x.sentiment,policyTrust:scorePoint(10)}}; const r=updateFx(base(weak));
  expect(r.economy.indices.fx).toBeGreaterThan(x.indices.fx); expect(Number.isFinite(r.economy.indices.fx)).toBe(true);
 });
});
