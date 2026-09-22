import { z } from "zod";
import type { ParameterDefinition } from "@macro-nation/domain";

const evidenceClassSchema = z.enum(["E", "C", "G", "D", "E/C", "G/C"]);
const numericUnitSchema = z.enum([
  "PercentPoint",
  "PercentRate",
  "IndexLevel",
  "LogIndex",
  "FlowPerMonth",
  "StockLevel",
  "Share01",
  "ScorePoint",
  "MonthCount",
  "Scalar",
]);

export const parameterDefinitionSchema = z
  .object({
    parameterId: z.string().min(1),
    description: z.string().min(1),
    unit: numericUnitSchema,
    default: z.number().finite(),
    min: z.number().finite(),
    max: z.number().finite(),
    evidenceClass: evidenceClassSchema,
    sourceIds: z.array(z.string().min(1)).min(1),
  })
  .superRefine((value, ctx) => {
    if (value.min > value.max) ctx.addIssue({ code: "custom", message: "min must be <= max" });
    if (value.default < value.min || value.default > value.max) {
      ctx.addIssue({ code: "custom", message: "default must be inside [min,max]" });
    }
  });

export const lagKernelSchema = z
  .object({
    kernelId: z.string().min(1),
    start: z.number().int().nonnegative(),
    peak: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    shape: z.enum(["instant", "ramp", "hump", "decay"]),
    weights: z.array(z.number().finite().nonnegative()).min(1),
  })
  .superRefine((value, ctx) => {
    if (!(value.start <= value.peak && value.peak <= value.end)) {
      ctx.addIssue({ code: "custom", message: "start <= peak <= end required" });
    }
    if (value.weights.length !== value.end - value.start + 1) {
      ctx.addIssue({ code: "custom", message: "weight count must match kernel span" });
    }
    const sum = value.weights.reduce((total: number, weight: number) => total + weight, 0);
    if (Math.abs(sum - 1) > 1e-10) {
      ctx.addIssue({ code: "custom", message: "lag weights must sum to 1" });
    }
  });

const shockFactorSchema = z.object({
  factorId: z.string().min(1),
  persistence: z.number().finite().min(-0.999).max(0.999),
  shockScale: z.number().finite().nonnegative(),
  streamId: z.string().min(1),
});
const matrixSchema = z.array(z.array(z.number().finite()).min(1)).min(1);
export const shockModelSchema = z.object({
  factors: z.array(shockFactorSchema).min(1),
  correlation: matrixSchema,
  cholesky: matrixSchema,
  regimes: z
    .array(z.object({ regimeId: z.string().min(1), volatilityMultiplier: z.number().positive() }))
    .min(1),
});

export const policyRuleSchema = z
  .object({
    policyId: z.string().min(1),
    policyType: z.string().regex(/^[a-z][a-zA-Z0-9._-]*$/),
    // Legacy single-value rules stay valid; a new policy may declare named inputs.
    inputMin: z.number().finite().optional(),
    inputMax: z.number().finite().optional(),
    inputs: z
      .array(
        z.object({
          inputId: z.string().regex(/^[a-z][a-zA-Z0-9._-]*$/),
          labelKey: z.string().min(1),
          unit: numericUnitSchema,
          min: z.number().finite(),
          max: z.number().finite(),
          defaultValue: z.number().finite(),
          step: z.number().finite().positive().optional(),
        }),
      )
      .min(1)
      .optional(),
    costs: z.object({
      politicalCapital: z.number().nonnegative(),
      implementationCapacity: z.number().nonnegative(),
      foreignReserves: z.number().nonnegative(),
      immediateBudget: z.number().nonnegative(),
    }),
    regimeModifiers: z.record(z.string(), z.number().positive()),
    caps: z.object({ maxMonthlyDelta: z.number().nonnegative() }),
  })
  .superRefine((value, ctx) => {
    if (value.inputs) {
      if (value.inputMin !== undefined || value.inputMax !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: "named inputs cannot use legacy inputMin/inputMax",
        });
      }
      const ids = value.inputs.map((input) => input.inputId);
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({ code: "custom", message: "duplicate policy input ID" });
      }
      for (const input of value.inputs) {
        if (
          input.min > input.max ||
          input.defaultValue < input.min ||
          input.defaultValue > input.max
        ) {
          ctx.addIssue({
            code: "custom",
            message: `invalid range for policy input ${input.inputId}`,
          });
        }
        if (input.step !== undefined &&
          Math.abs((input.defaultValue - input.min) / input.step -
            Math.round((input.defaultValue - input.min) / input.step)) > 1e-8) {
          ctx.addIssue({ code: "custom", message: `default is not on step for policy input ${input.inputId}` });
        }
      }
    } else if (
      value.inputMin === undefined ||
      value.inputMax === undefined ||
      value.inputMin > value.inputMax
    ) {
      ctx.addIssue({
        code: "custom",
        message: "legacy inputMin/inputMax must be present and ordered",
      });
    }
  });

export const indicatorDefinitionSchema = z.object({
  indicatorId: z.string().regex(/^[a-z][a-zA-Z0-9._-]*$/),
  labelKey: z.string().min(1),
  unit: numericUnitSchema,
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("statePath"), path: z.string().min(1) }),
    z.object({ kind: z.literal("selector"), selectorId: z.string().min(1) }),
  ]),
});

const calibrationTargetSchema = z
  .object({
    targetId: z.string().min(1),
    indicatorId: z.string().min(1),
    target: z.number().finite(),
    min: z.number().finite(),
    max: z.number().finite(),
  })
  .passthrough();
export const calibrationTargetsSchema = z.object({
  irf: z.array(calibrationTargetSchema),
  moments: z.array(
    z.object({
      targetId: z.string(),
      metric: z.string(),
      target: z.number(),
      min: z.number(),
      max: z.number(),
    }),
  ),
  correlations: z.array(
    z.object({
      targetId: z.string(),
      left: z.string(),
      right: z.string(),
      target: z.number(),
      min: z.number(),
      max: z.number(),
    }),
  ),
  tailBands: z.array(
    z.object({
      targetId: z.string(),
      indicatorId: z.string(),
      quantile: z.number().min(0).max(1),
      min: z.number(),
      max: z.number(),
    }),
  ),
});

export const sourceSchema = z.object({
  sourceId: z.string().min(1),
  title: z.string().min(1),
  retrievedAt: z.string().min(1),
  confidence: z.enum(["high", "medium", "low"]),
  transformation: z.string().min(1),
  note: z.string().optional(),
});

export const contentSchema = z.object({
  indicators: z.array(z.string().min(1)).min(1),
  /** Optional extension definitions; the nine built-in indicators retain their legacy mapping. */
  indicatorDefinitions: z.array(indicatorDefinitionSchema).optional(),
  policies: z.array(z.string().min(1)).min(1),
  events: z.array(z.object({ eventId: z.string().min(1), dependsOn: z.array(z.string()) })),
  textKeys: z.array(z.string().min(1)),
});

export const nationSchema = z.object({
  nationId: z.string().min(1),
  displayNameKey: z.string().min(1),
  population: z.number().positive(),
  initial: z.object({
    realGdp: z.number().positive(),
    cpi: z.number().positive(),
    fx: z.number().min(20).max(500),
    unemployment: z.number().min(0.02).max(0.3),
    policyRate: z.number().min(-0.02).max(0.3),
    governmentDebt: z.number().nonnegative(),
    foreignReserves: z.number().nonnegative(),
    policyTrust: z.number().min(0).max(100),
    support: z.number().min(0).max(100),
  }),
  industryStructure: z.record(z.string(), z.number().min(0).max(1)),
  tradeStructure: z.record(z.string(), z.number()),
  energyStructure: z.record(z.string(), z.number().min(0).max(1)),
  institutions: z.record(z.string(), z.number()),
  infrastructure: z.record(z.string(), z.number().positive()),
  resources: z.record(z.string(), z.number()),
  policyConstraints: z.record(z.string(), z.unknown()),
  visualThemeKey: z.string().min(1),
});

export const scenarioSchema = z.object({
  id: z.string().min(1),
  titleKey: z.string().min(1),
  durationMonths: z.number().int().positive(),
  startYear: z.number().int(),
  startMonth: z.number().int().min(1).max(12),
  nationId: z.string().min(1),
  clock: z.object({
    simulationStep: z.literal("month"),
    policyCycleSteps: z.number().int().positive(),
    realSecondsPerStep: z.number().positive(),
    offlineMaxSteps: z.number().int().nonnegative(),
  }),
  enabledPolicies: z.array(z.string()),
  enabledEvents: z.array(z.string()),
  externalBaseline: z.record(z.string(), z.number()),
  parameterOverrides: z.array(z.object({ parameterId: z.string(), value: z.number().finite() })),
});

export const modelSchema = z.object({
  modelId: z.string().min(1),
  modelVersion: z.string().min(1),
  configPackId: z.string().min(1),
  description: z.string().min(1),
});
export const limitsSchema = z.object({
  hard: z.record(z.string(), z.tuple([z.number().finite(), z.number().finite()])),
  scenarioUi: z.record(z.string(), z.tuple([z.number().finite(), z.number().finite()])),
});
export const effectCurvesSchema = z.record(
  z.string(),
  z.array(z.number().finite().nonnegative()).min(1),
);
export const manifestSchema = z.object({
  id: z.string().min(1),
  configVersion: z.string().min(1),
  configSchemaVersion: z.string().min(1),
  modelVersion: z.string().min(1),
  calibrationVersion: z.string().min(1),
  contentVersion: z.string().min(1),
  rngVersion: z.string().min(1),
  compatibleEngine: z.object({ min: z.string().min(1), max: z.string().min(1) }),
  fileHashes: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
  overrideAllowlist: z.array(z.string().min(1)),
});

export interface ConfigPackInput {
  readonly manifest: unknown;
  readonly coefficients: unknown;
  readonly lagKernels: unknown;
  readonly shockModel: unknown;
  readonly policyRules: unknown;
  readonly calibrationTargets: unknown;
  readonly sources: unknown;
  readonly content: unknown;
  readonly model: unknown;
  readonly limits: unknown;
  readonly effectCurves: unknown;
  readonly nation: unknown;
  readonly scenario: unknown;
}

export interface ParsedConfigPack {
  readonly manifest: z.infer<typeof manifestSchema>;
  readonly coefficients: readonly ParameterDefinition[];
  readonly lagKernels: readonly z.infer<typeof lagKernelSchema>[];
  readonly shockModel: z.infer<typeof shockModelSchema>;
  readonly policyRules: readonly z.infer<typeof policyRuleSchema>[];
  readonly calibrationTargets: z.infer<typeof calibrationTargetsSchema>;
  readonly sources: readonly z.infer<typeof sourceSchema>[];
  readonly content: z.infer<typeof contentSchema>;
  readonly model: z.infer<typeof modelSchema>;
  readonly limits: z.infer<typeof limitsSchema>;
  readonly effectCurves: z.infer<typeof effectCurvesSchema>;
  readonly nation: z.infer<typeof nationSchema>;
  readonly scenario: z.infer<typeof scenarioSchema>;
}
