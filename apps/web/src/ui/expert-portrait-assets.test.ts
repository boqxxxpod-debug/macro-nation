// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  expertPortraitManifest,
  expertProfiles,
} from "@macro-nation/advisor-core";
import assetManifest from "../../../../docs/assets/expert-portraits-v1/manifest.json";

const repositoryRoot = new URL("../../../../", import.meta.url);

describe("approved expert portrait assets", () => {
  it("connects the same eight identities and appearance descriptions to the approved files", () => {
    expect(assetManifest.experts.map(({ expertId }) => expertId)).toEqual(
      expertProfiles.map(({ id }) => id),
    );
    for (const expert of assetManifest.experts) {
      const profile = expertProfiles.find(({ id }) => id === expert.expertId);
      const portrait = expertPortraitManifest.find(
        ({ expertId }) => expertId === expert.expertId,
      );
      expect(profile, expert.expertId).toMatchObject({
        displayName: expert.displayName,
        role: expert.role,
        portraitAssetKey: expert.portraitAssetKey,
        colorToken: expert.colorToken,
        portraitAltText: expert.altText,
      });
      expect(portrait, expert.expertId).toMatchObject({
        portraitAssetKey: expert.portraitAssetKey,
        altText: expert.altText,
      });
      expect(expert.variants.map(({ density }) => density)).toEqual([
        "1x",
        "2x",
      ]);
      for (const variant of expert.variants) {
        const source =
          variant.density === "1x" ? portrait?.src : portrait?.src2x;
        expect(`apps/web/public/${source}`, expert.expertId).toBe(variant.file);
      }
    }
  });

  it("ships 16 distinct approved square WebP files with alpha at 256px and 512px", () => {
    const variants = assetManifest.experts.flatMap(({ variants }) => variants);
    expect(
      readdirSync(new URL("apps/web/public/experts/", repositoryRoot)).sort(),
    ).toEqual(variants.map(({ file }) => file.split("/").at(-1)).sort());
    const hashes = new Set<string>();
    let totalBytes = 0;
    for (const variant of variants) {
      const bytes = readFileSync(new URL(variant.file, repositoryRoot));
      const hash = createHash("sha256").update(bytes).digest("hex");
      expect(hash, variant.file).toBe(variant.sha256);
      expect(bytes.length, variant.file).toBe(variant.bytes);
      expect(bytes.toString("ascii", 0, 4), variant.file).toBe("RIFF");
      expect(bytes.readUInt32LE(4) + 8, variant.file).toBe(bytes.length);
      expect(bytes.toString("ascii", 8, 16), variant.file).toBe("WEBPVP8X");
      expect((bytes[20] ?? 0) & 0x10, variant.file).toBe(0x10);
      const side = variant.density === "1x" ? 256 : 512;
      expect(
        [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1],
        variant.file,
      ).toEqual([side, side]);
      expect([variant.width, variant.height], variant.file).toEqual([
        side,
        side,
      ]);
      hashes.add(hash);
      totalBytes += bytes.length;
    }
    expect(hashes.size).toBe(16);
    expect(totalBytes).toBe(553_260);
  });
});
