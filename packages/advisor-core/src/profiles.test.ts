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
    expect(expertPortraitManifest).toHaveLength(8);
    expect(expertPortraitManifest.map((portrait) => portrait.expertId)).toEqual(
      expertProfiles.map((profile) => profile.id),
    );
    for (const profile of expertProfiles) {
      const portrait = expertPortraitManifest.find(
        ({ expertId }) => expertId === profile.id,
      );
      expect(portrait, profile.id).toEqual({
        expertId: profile.id,
        portraitAssetKey: profile.portraitAssetKey,
        src: `experts/${profile.portraitAssetKey}.webp`,
        src2x: `experts/${profile.portraitAssetKey}@2x.webp`,
        altText: profile.portraitAltText,
      });
      expect(portrait?.altText, profile.id).toContain(profile.role);
      expect(portrait?.altText, profile.id).toContain(
        profile.displayName?.replaceAll(" ", ""),
      );
    }
    for (const key of [
      "portraitAssetKey",
      "src",
      "src2x",
      "altText",
    ] as const) {
      expect(
        new Set(expertPortraitManifest.map((portrait) => portrait[key])).size,
      ).toBe(8);
    }
    expect(
      new Set(
        expertPortraitManifest.flatMap((portrait) => [
          portrait.src,
          portrait.src2x,
        ]),
      ).size,
    ).toBe(16);
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
