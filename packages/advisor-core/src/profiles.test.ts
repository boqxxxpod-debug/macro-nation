import { describe, expect, it } from "vitest";
import {
  expertPortraitManifest,
  expertProfiles,
  expertProfilesForContentVersion,
} from "./profiles";

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

  it("provides a complete, unique portrait manifest for all eight roles", () => {
    expect(expertProfiles).toHaveLength(8);
    expect(new Set(expertProfiles.map((profile) => profile.id)).size).toBe(8);
    expect(expertPortraitManifest.map((portrait) => portrait.expertId)).toEqual(
      expertProfiles.map((profile) => profile.id),
    );
    expect(
      expertPortraitManifest.every((portrait) => portrait.altText.length > 0),
    ).toBe(true);
    expect(
      expertPortraitManifest.every((portrait) =>
        portrait.src.startsWith("data:image/svg+xml,"),
      ),
    ).toBe(true);
    expect(
      expertProfiles.every(
        (profile) =>
          profile.displayName && profile.colorToken && profile.toneKey,
      ),
    ).toBe(true);
  });

  it("updates polite tone independently while retaining every identity and priority", () => {
    const legacy = expertProfilesForContentVersion("1.1.0");
    expect(legacy[0]?.tone).toBe("落ち着いて結論から説明する");
    expect(expertProfilesForContentVersion("1.0.0")[0]?.tone).toBe(
      legacy[0]?.tone,
    );
    expect(expertProfilesForContentVersion("1.2.0")).toEqual(expertProfiles);
    expect(
      expertProfiles.every(({ tone }) => tone.includes("です・ます")),
    ).toBe(true);
    const identity = (profile: (typeof legacy)[number]) =>
      Object.fromEntries(
        Object.entries(profile).filter(([key]) => key !== "tone"),
      );
    expect(expertProfiles.map(identity)).toEqual(legacy.map(identity));
  });
});
