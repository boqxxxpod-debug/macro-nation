import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
  createConfigSnapshot,
  loadSCN01ConfigPack,
  stableStringify,
} from "@macro-nation/model-config";
import {
  ENGINE_VERSION,
  createSCN01InitialState,
  runNoPolicyHeadless,
} from "@macro-nation/simulation-engine";

const fixturePath =
  "packages/simulation-engine/src/fixtures/scn01-no-policy-golden-v4.json";
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const pack = await loadSCN01ConfigPack();
const configSnapshot = await createConfigSnapshot(
  pack,
  pack.scenario.parameterOverrides,
);
const versions = {
  saveSchemaVersion: "1",
  engineVersion: ENGINE_VERSION,
  configSchemaVersion: pack.manifest.configSchemaVersion,
  modelVersion: pack.manifest.modelVersion,
  calibrationVersion: pack.manifest.calibrationVersion,
  contentVersion: pack.manifest.contentVersion,
  rngVersion: pack.manifest.rngVersion,
  configVersion: pack.manifest.configVersion,
};
const initialState = createSCN01InitialState({
  configSnapshot,
  seed: fixture.seed,
  versions,
});
function round(value: unknown): unknown {
  if (typeof value === "number")
    return Number.isFinite(value)
      ? Number(value.toFixed(fixture.traceNumberDecimals))
      : value;
  if (Array.isArray(value)) return value.map(round);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, round(entry)]),
    );
  return value;
}
const traceSha256: Record<string, string> = {};
for (const tickCount of [48, 96]) {
  const result = runNoPolicyHeadless({ initialState, tickCount });
  if (result.failure) throw Error(JSON.stringify(result.failure));
  const trace = round({
    strategyId: result.strategyId,
    requestedTicks: result.requestedTicks,
    ticksCompleted: result.ticksCompleted,
    finalState: result.finalState,
    records: result.records,
    invariantFailures: result.invariantFailures,
    failure: result.failure,
  });
  traceSha256[String(tickCount)] = createHash("sha256")
    .update(stableStringify(trace))
    .digest("hex");
}
writeFileSync(
  fixturePath,
  JSON.stringify(
    {
      ...fixture,
      engineVersion: ENGINE_VERSION,
      modelVersion: versions.modelVersion,
      configHash: configSnapshot.configHash,
      traceSha256,
    },
    null,
    2,
  ) + "\n",
);
