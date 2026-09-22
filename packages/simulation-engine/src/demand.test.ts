import { describe, expect, it } from "vitest";
import {
  flowPerMonth,indexLevel,percentRate,scorePoint,share01,stockLevel,
  type ConfigSnapshot,type EconomyState,type IndustryId,
} from "@macro-nation/domain";
import { XOSHIRO_TICK_RNG_PROVIDER,createRngBundle,updateDemandAndGdp } from "./index";

function economy():EconomyState {
  const industries=Object.fromEntries(["agricultureResources","manufacturing","construction","householdServices","financeRealEstate","energyLogistics"].map(id=>[id,{
    productionIndex:indexLevel(100),employmentShare:share01(1/6),capacityIndex:indexLevel(100),importDependency:share01(0.2),priceIndex:indexLevel(100),
  }])) as Record<IndustryId,EconomyState["industries"][IndustryId]>;
  return {
    indices:{realGdp:indexLevel(100),cpi:indexLevel(100),fx:indexLevel(100),nominalWage:indexLevel(100),realHouseholdIncome:indexLevel(100),potentialGdp:indexLevel(100),importPrice:indexLevel(100)},
    rates:{inflationAnnual:percentRate(0.02),unemployment:percentRate(0.05),policyRate:percentRate(0.02),marketRate:percentRate(0.03),expectedInflation:percentRate(0.02),foreignRate:percentRate(0.025)},
    ratios:{governmentDebtRatio:percentRate(0.9),fiscalBalanceRatio:percentRate(-0.03)},
    flows:{consumption:flowPerMonth(60),investment:flowPerMonth(18),governmentConsumption:flowPerMonth(20),publicInvestment:flowPerMonth(4),exports:flowPerMonth(25),imports:flowPerMonth(23),taxRevenue:flowPerMonth(28),primarySpending:flowPerMonth(30),interestPayment:flowPerMonth(2),currentAccount:flowPerMonth(2),capitalFlow:flowPerMonth(0)},
    stocks:{governmentDebt:stockLevel(1080),domesticGovernmentDebt:stockLevel(800),externalGovernmentDebt:stockLevel(280),foreignReserves:stockLevel(300)},
    sentiment:{consumerConfidence:scorePoint(50),businessConfidence:scorePoint(50),policyTrust:scorePoint(50),support:scorePoint(55),inequality:scorePoint(40),speculationPressure:scorePoint(0)},
    institutions:{politicalCapital:scorePoint(60),implementationCapacity:scorePoint(65),centralBankIndependence:scorePoint(80),taxCapacity:scorePoint(70),procurementTransparency:scorePoint(70)},
    industries,infrastructure:{transport:indexLevel(100),energy:indexLevel(100),digital:indexLevel(100),water:indexLevel(100),publicFacilities:indexLevel(100)},
    external:{foreignGrowthAnnual:percentRate(0.025),foreignRateAnnual:percentRate(0.025),resourcePriceIndex:indexLevel(100),partnerRelations:scorePoint(60),disasterAlert:scorePoint(20),fxShockLogIndex:0 as EconomyState["external"]["fxShockLogIndex"]},
  };
}
function snapshot(overrides:Readonly<Record<string,number>>={}):ConfigSnapshot {
  return {snapshotVersion:"test",configHash:"a".repeat(64),sourceManifest:[],normalizedConfig:{parameters:{
    "CORE-GROW-001":0,"CORE-INF-001":0.02,"CORE-U-001":0.05,"CORE-R-001":0.01,
    "CONS-BASE-001":0,"CONS-Y-001":0,"CONS-R-001":0,"CONS-U-001":0,"CONS-INF-001":0,"CONS-TRUST-001":0,"CONS-ERR-001":0,
    "INV-BASE-001":0,"INV-GAP-001":0,"INV-PROD-001":0,"INV-R-001":0,"INV-UNC-001":0,"INV-TRUST-001":0,"INV-ERR-001":0,
    "EXT-GROW-001":0.025,"X-FOREIGN-001":0,"X-FX-001":0,"M-DEMAND-001":0,"M-FX-001":0,
    "GDP-SHARE-C-001":0.6,"GDP-SHARE-I-001":0.18,"GDP-SHARE-G-001":0.2,"GDP-SHARE-X-001":0.25,"GDP-SHARE-M-001":0.23,...overrides,
  }}};
}
function run(e:EconomyState,config=snapshot()){
  return updateDemandAndGdp({economy:e,effects:[],monthIndex:0,configSnapshot:config,rng:createRngBundle("demand-test"),rngProvider:XOSHIRO_TICK_RNG_PROVIDER});
}
describe("demand and GDP block",()=>{
  it("keeps zero-coefficient baseline stable and preserves accounting identity",()=>{
    const r=run(economy());
    expect(r.economy.indices.realGdp).toBe(100);
    expect(r.economy.flows.consumption+r.economy.flows.investment+r.economy.flows.governmentConsumption+r.economy.flows.exports-r.economy.flows.imports).toBeCloseTo(r.economy.indices.realGdp,12);
  });
  it("reduces consumption and investment when the real rate rises",()=>{
    const config=snapshot({"CONS-R-001":0.45,"INV-R-001":1.5});
    const low=run(economy(),config);
    const e=economy(); const high=run({...e,rates:{...e.rates,marketRate:percentRate(0.08)}},config);
    expect(high.economy.flows.consumption).toBeLessThan(low.economy.flows.consumption);
    expect(high.economy.flows.investment).toBeLessThan(low.economy.flows.investment);
  });
  it("raises exports and reduces imports after depreciation",()=>{
    const e=economy(); const r=run({...e,indices:{...e.indices,fx:indexLevel(120)}},snapshot({"X-FX-001":0.35,"M-FX-001":-0.25}));
    expect(r.economy.flows.exports).toBeGreaterThan(25); expect(r.economy.flows.imports).toBeLessThan(23);
  });
  it("emits reconciled causal records for every component and GDP",()=>{
    const r=run(economy(),snapshot({"CONS-BASE-001":0.012}));
    expect(r.causal.map(x=>x.indicatorId)).toEqual(["consumption","investment","governmentConsumption","exports","imports","realGdp"]);
    for(const c of r.causal) expect(c.contributions.reduce((s,t)=>s+t.delta,0)).toBeCloseTo(c.totalDelta,10);
  });
});
