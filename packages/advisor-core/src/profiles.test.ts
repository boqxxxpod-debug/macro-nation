import { describe, expect, it } from "vitest";
import { expertProfilesForContentVersion } from "./profiles";

describe("versioned expert profiles", () => {
  it("keeps legacy saves on their original profile content", () => {
    expect(
      expertProfilesForContentVersion("1.0.0").every(
        (profile) => profile.priorityIndicators === undefined,
      ),
    ).toBe(true);
    expect(
      expertProfilesForContentVersion("1.1.0").every(
        (profile) => profile.priorityIndicators?.length === 3,
      ),
    ).toBe(true);
  });
});
