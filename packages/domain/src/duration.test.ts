import { describe, expect, it } from "vitest";
import { calendarSteps, milestoneKey, type ClockConfig } from "./index";

describe("calendar duration", () => {
  it("keeps end and milestone boundaries stable when the policy cycle changes", () => {
    const monthly: ClockConfig = {
      simulationStep: "month",
      policyCycleSteps: 3,
      realSecondsPerStep: 300,
      offlineMaxSteps: 96,
    };
    expect([48, 60, 96, 120, 240, 360].map((months) => calendarSteps(months, monthly)))
      .toEqual([48, 60, 96, 120, 240, 360]);
    expect(calendarSteps(120, { ...monthly, policyCycleSteps: 6 })).toBe(120);
    expect(milestoneKey("game", "review", 120)).not.toBe(milestoneKey("game", "structure", 120));
  });
});
