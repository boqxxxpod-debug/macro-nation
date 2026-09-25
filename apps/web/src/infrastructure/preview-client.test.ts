import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  createConfigSnapshot,
  loadSCN01ConfigPack,
} from "@macro-nation/model-config";
import {
  ENGINE_VERSION,
  createSCN01InitialState,
  policyDraftHash,
  policyStateHash,
  previewPolicy,
  type PreviewInput,
} from "@macro-nation/simulation-engine";
import type { GameState, VersionTuple } from "@macro-nation/domain";
import { PreviewClient } from "./preview-client";

let input: PreviewInput;
beforeAll(async () => {
  const pack = await loadSCN01ConfigPack();
  const configSnapshot = await createConfigSnapshot(
    pack,
    pack.scenario.parameterOverrides,
  );
  const versions: VersionTuple = {
    saveSchemaVersion: "1",
    engineVersion: ENGINE_VERSION,
    configSchemaVersion: pack.manifest.configSchemaVersion,
    modelVersion: pack.manifest.modelVersion,
    calibrationVersion: pack.manifest.calibrationVersion,
    contentVersion: pack.manifest.contentVersion,
    rngVersion: pack.manifest.rngVersion,
    configVersion: pack.manifest.configVersion,
  };
  const state: GameState = createSCN01InitialState({
    configSnapshot,
    versions,
    seed: "web-preview-client",
  });
  input = {
    state,
    draft: {
      status: "draft",
      policyId: "proposal",
      ruleId: "interest-rate",
      value: 0.05,
      quartersAhead: 0,
    },
    horizonMonths: 12,
  };
});

describe("PreviewClient", () => {
  it("cancels a queued request and caches only a valid result", async () => {
    const compute = vi.fn(previewPolicy);
    const client = new PreviewClient(null, compute);
    const cancelled = client.request(input);
    const successful = client.request(input);
    await expect(cancelled).rejects.toThrow(/cancelled/);
    const first = await successful;
    expect(first.draftHash).toBe(policyDraftHash(input.draft));
    expect(await client.request(input)).toBe(first);
    expect(compute).toHaveBeenCalledTimes(1);
    await client.request({ ...input, shockPairingId: "another-pair" });
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("terminates the worker and rejects a response for an old state", async () => {
    const output = previewPolicy(input);
    const terminate = vi.fn();
    const worker = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null,
      postMessage: vi.fn(),
      terminate,
    };
    const client = new PreviewClient(() => {
      return worker as unknown as Worker;
    });
    const pending = client.request(input);
    worker.onmessage?.({
      data: {
        type: "RESULT",
        requestId: "0",
        draftHash: policyDraftHash(input.draft),
        stateHash: policyStateHash(input.state),
        payload: output,
      },
    } as MessageEvent);
    await expect(pending).rejects.toThrow(/Stale/);
    expect(terminate).toHaveBeenCalledOnce();
  });
});
