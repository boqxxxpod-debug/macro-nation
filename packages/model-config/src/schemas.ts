import { z } from "zod";

export const unitNameSchema = z.enum([
  "PercentPoint",
  "PercentRate",
  "Ratio",
  "IndexLevel",
  "LogIndex",
  "FlowPerMonth",
  "StockLevel",
  "Share01",
]);

export const evidenceClassSchema = z.enum(["E", "C", "G", "D"]);

export const parameterDefinitionSchema = z
  .object({
    parameterId: z.string().min(1),
    description: z.string().min(1),
    unit: unitNameSchema,
    default: z.number().finite(),
    min: z.number().finite(),
    max: z.number().finite(),
    evidenceClass: evidenceClassSchema,
    sourceIds: z.array(z.string().min(1)).min(1),
    rangeKind: z.enum(["hard", "scenario", "tuning"]),
  })
  .superRefine((value, context) => {
    if (value.min > value.max) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "min must not exceed max",
        path: ["min"],
      });
    }
    if (value.default < value.min || value.default > value.max) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "default must be inside min/max",
        path: ["default"],
      });
    }
  });

export const coefficientsSchema = z.object({
  modelVersion: z.string().min(1),
  parameters: z.array(parameterDefinitionSchema).min(1),
});

export const lagKernelSchema = z.object({
  id: z.string().min(1),
  start: z.number().int().nonnegative(),
  peak: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  shape: z.enum(["instant", "ramp", "hump", "decay"]),
  weights: z.array(z.number().finite().nonnegative()).min(1),
});

export const lagKernelsSchema = z.object({
  kernels: z.array(lagKernelSchema).min(1),
});

export const shockFactorSchema = z.object({
  id: z.string().min(1),
  persistence: z.number().min(0).max(0.999999),
  shockStd: z.number().nonnegative().finite(),
});

export const shockModelSchema = z.object({
  factors: z.array(shockFactorSchema).min(1),
  correlationMatrix: z.array(z.array(z.number().finite())).min(1),
  regimes: z
    .array(
      z.object({
        id: z.string().min(1),
        multiplier: z.number().positive().finite(),
      }),
    )
    .min(1),
});

export const policyRulesSchema = z.object({
  rules: z
    .array(
      z.object({
        id: z.string().min(1),
        parameterIds: z.array(z.string().min(1)),
        lagKernelIds: z.array(z.string().min(1)),
        inputScale: z.number().finite(),
        maxAbsoluteInput: z.number().positive().finite(),
      }),
    )
    .min(1),
});

export const calibrationTargetsSchema = z.object({
  targets: z.array(
    z
      .object({
        id: z.string().min(1),
        metric: z.string().min(1),
        horizonMonths: z.number().int().positive(),
        min: z.number().finite(),
        max: z.number().finite(),
        sourceIds: z.array(z.string().min(1)).min(1),
      })
      .refine((target) => target.min <= target.max, "target min must not exceed max"),
  ),
});

export const sourcesSchema = z.object({
  sources: z
    .array(
      z.object({
        id: z.string().min(1),
        citation: z.string().min(1),
        accessedAt: z.string().min(1),
        confidence: z.enum(["high", "medium", "low"]),
        notes: z.string(),
      }),
    )
    .min(1),
});

const industrySharesSchema = z.object({
  agricultureResources: z.number().min(0).max(1),
  manufacturing: z.number().min(0).max(1),
  construction: z.number().min(0).max(1),
  householdServices: z.number().min(0).max(1),
  financeRealEstate: z.number().min(0).max(1),
  energyLogistics: z.number().min(0).max(1),
});

export const nationProfileSchema = z.object({
  nationId: z.string().min(1),
  displayNameKey: z.string().min(1),
  population: z.number().positive(),
  industryShares: industrySharesSchema,
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
  visualThemeKey: z.string().min(1),
});

export const clockConfigSchema = z.object({
  simulationStep: z.literal("month"),
  policyCycleSteps: z.number().int().positive(),
  realSecondsPerStep: z.number().positive(),
  offlineMaxSteps: z.number().int().nonnegative(),
});

export const scenarioSchema = z.object({
  id: z.string().min(1),
  nationId: z.string().min(1),
  durationMonths: z.number().int().positive(),
  clock: clockConfigSchema,
  initialOverrides: z.record(z.number().finite()),
  enabledPolicyRuleIds: z.array(z.string().min(1)),
  indicatorIds: z.array(z.string().min(1)),
});

export const contentSchema = z.object({
  contentVersion: z.string().min(1),
  indicators: z.array(
    z.object({
      id: z.string().min(1),
      labelKey: z.string().min(1),
    }),
  ),
  policyIds: z.array(z.string().min(1)),
  eventIds: z.array(z.string().min(1)),
});

const numericRangeSchema = z.tuple([z.number().finite(), z.number().finite()]);

export const limitsSchema = z.object({
  hard: z.record(numericRangeSchema),
  scenarioUi: z.record(numericRangeSchema),
});

export const effectCurvesSchema = z.object({
  curveIds: z.array(z.string().min(1)).min(1),
});

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const manifestSchema = z.object({
  configPackId: z.string().min(1),
  configSchemaVersion: z.string().min(1),
  engineCompatibility: z.object({
    min: z.string().min(1),
    maxExclusive: z.string().min(1),
  }),
  modelVersion: z.string().min(1),
  calibrationVersion: z.string().min(1),
  contentVersion: z.string().min(1),
  files: z.record(sha256Schema),
  overrideAllowlist: z.array(z.string().min(1)),
  sourceManifest: z.array(z.string().min(1)).min(1),
});

export const configPackSchema = z.object({
  manifest: manifestSchema,
  coefficients: coefficientsSchema,
  lagKernels: lagKernelsSchema,
  shockModel: shockModelSchema,
  policyRules: policyRulesSchema,
  calibrationTargets: calibrationTargetsSchema,
  sources: sourcesSchema,
  nations: z.array(nationProfileSchema).min(1),
  scenarios: z.array(scenarioSchema).min(1),
  content: contentSchema,
  limits: limitsSchema,
  effectCurves: effectCurvesSchema,
});

export type ParameterDefinition = z.infer<typeof parameterDefinitionSchema>;
export type ConfigPack = z.infer<typeof configPackSchema>;
export type ConfigManifest = z.infer<typeof manifestSchema>;
