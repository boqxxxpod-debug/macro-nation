import type {
  ConfigSnapshot,
  GameState,
  NumericUnit,
  ScheduledEffect,
} from "@macro-nation/domain";

export interface PolicyInputDefinition {
  readonly inputId: string;
  readonly labelKey: string;
  readonly unit: NumericUnit;
  readonly min: number;
  readonly max: number;
  readonly defaultValue: number;
  readonly step?: number;
}

/** Structural contract: model-config owns the schema; the engine never imports it. */
export interface PolicyRuleContract {
  readonly policyId: string;
  readonly policyType: string;
  readonly inputMin?: number;
  readonly inputMax?: number;
  readonly inputs?: readonly PolicyInputDefinition[];
}

export interface PolicyHandler {
  readonly policyType: string;
  createEffects(input: {
    readonly rule: PolicyRuleContract;
    readonly values: Readonly<Record<string, number>>;
    readonly state: GameState;
    readonly configSnapshot: ConfigSnapshot;
  }): readonly ScheduledEffect[];
}

/** Validation is shared by preview and commit; neither may accept unknown fields. */
export function validatePolicyInputs(
  rule: PolicyRuleContract,
  values: Readonly<Record<string, number>>,
): void {
  const definitions =
    rule.inputs ??
    (rule.inputMin !== undefined && rule.inputMax !== undefined
      ? [{ inputId: "value", min: rule.inputMin, max: rule.inputMax }]
      : []);
  if (definitions.length === 0)
    throw new Error(`Policy ${rule.policyId} has no input definition`);
  const allowed = new Set(definitions.map((definition) => definition.inputId));
  if (allowed.size !== definitions.length)
    throw new Error(`Duplicate input ID in ${rule.policyId}`);
  for (const key of Object.keys(values)) {
    if (!allowed.has(key)) throw new Error(`Unknown policy input ${key}`);
  }
  for (const definition of definitions) {
    const value = values[definition.inputId];
    if (
      !Object.hasOwn(values, definition.inputId) ||
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < definition.min ||
      value > definition.max
    ) {
      throw new Error(
        `Invalid policy input ${definition.inputId} for ${rule.policyId}`,
      );
    }
    if ("step" in definition && definition.step !== undefined) {
      if (!(definition.step > 0) || !Number.isFinite(definition.step))
        throw new Error(`Invalid step for ${definition.inputId}`);
      const steps = (value - definition.min) / definition.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-8) {
        throw new Error(
          `Policy input ${definition.inputId} is not on its step`,
        );
      }
    }
  }
}

/** A configured policy without executable mechanics fails at startup, never silently no-ops. */
export function createPolicyHandlerRegistry(
  rules: readonly PolicyRuleContract[],
  handlers: readonly PolicyHandler[],
) {
  const byType = new Map<string, PolicyHandler>();
  for (const handler of handlers) {
    if (byType.has(handler.policyType))
      throw new Error(`Duplicate policy handler ${handler.policyType}`);
    byType.set(handler.policyType, handler);
  }
  const byId = new Map<string, PolicyRuleContract>();
  for (const rule of rules) {
    if (byId.has(rule.policyId))
      throw new Error(`Duplicate policy rule ${rule.policyId}`);
    if (!byType.has(rule.policyType))
      throw new Error(`Unsupported policy type ${rule.policyType}`);
    byId.set(rule.policyId, rule);
  }
  return Object.freeze({
    /** The same call is used by preview and committed policy activation. */
    createEffects(
      ruleId: string,
      values: Readonly<Record<string, number>>,
      state: GameState,
    ): readonly ScheduledEffect[] {
      const rule = byId.get(ruleId);
      if (!rule) throw new Error(`Unknown policy rule ${ruleId}`);
      validatePolicyInputs(rule, values);
      return byType.get(rule.policyType)!.createEffects({
        rule,
        values,
        state,
        configSnapshot: state.configSnapshot,
      });
    },
  });
}
