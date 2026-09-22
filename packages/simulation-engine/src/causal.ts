import type {
  CausalContribution,
  CausalDiagnostic,
  CausalRef,
  CausalTerm,
  CausalMetricId,
} from "@macro-nation/domain";

const ABS_TOLERANCE = 1e-9;
const REL_TOLERANCE = 1e-8;

function withinTolerance(expected: number, actual: number): boolean {
  return (
    Math.abs(expected - actual) <=
    Math.max(ABS_TOLERANCE, Math.abs(expected) * REL_TOLERANCE)
  );
}

export class ContributionBuilder {
  readonly indicatorId: CausalMetricId;
  readonly beforeValue: number;
  #terms: CausalTerm[] = [];
  #diagnostics: CausalDiagnostic[] = [];

  constructor(indicatorId: CausalMetricId, beforeValue: number) {
    if (!Number.isFinite(beforeValue)) {
      throw new RangeError("beforeValue must be finite");
    }
    this.indicatorId = indicatorId;
    this.beforeValue = beforeValue;
  }

  add(source: CausalRef, delta: number): this {
    if (!Number.isFinite(delta)) {
      throw new RangeError("Contribution delta must be finite");
    }
    this.#terms.push({ ...source, delta });
    return this;
  }

  rawAfterValue(): number {
    return (
      this.beforeValue +
      this.#terms.reduce((sum, term) => sum + term.delta, 0)
    );
  }

  clamp(min?: number, max?: number): this {
    const rawValue = this.rawAfterValue();
    let adjustedValue = rawValue;
    if (min !== undefined) adjustedValue = Math.max(min, adjustedValue);
    if (max !== undefined) adjustedValue = Math.min(max, adjustedValue);
    if (adjustedValue !== rawValue) {
      const delta = adjustedValue - rawValue;
      this.#terms.push({
        sourceType: "inertia",
        sourceId: "stability-clamp",
        labelKey: "diagnostic.stabilityClamp",
        confidence: "high",
        delta,
      });
      this.#diagnostics.push({
        kind: "clamp",
        rawValue,
        adjustedValue,
        delta,
        ...(min === undefined ? {} : { min }),
        ...(max === undefined ? {} : { max }),
      });
    }
    return this;
  }

  recordDisplayRounding(displayValue: number): this {
    if (!Number.isFinite(displayValue)) {
      throw new RangeError("displayValue must be finite");
    }
    const internalValue = this.rawAfterValue();
    this.#diagnostics.push({
      kind: "rounding",
      internalValue,
      displayValue,
      displayDelta: displayValue - internalValue,
    });
    return this;
  }

  build(afterValue = this.rawAfterValue()): CausalContribution {
    if (!Number.isFinite(afterValue)) {
      throw new RangeError("afterValue must be finite");
    }
    const expectedDelta = afterValue - this.beforeValue;
    const contributionDelta = this.#terms.reduce(
      (sum, term) => sum + term.delta,
      0,
    );

    if (!withinTolerance(expectedDelta, contributionDelta)) {
      const residual = expectedDelta - contributionDelta;
      this.#terms.push({
        sourceType: "inertia",
        sourceId: "reconciliation-residual",
        labelKey: "diagnostic.reconciliationResidual",
        confidence: "high",
        delta: residual,
      });
      this.#diagnostics.push({
        kind: "residual",
        expectedDelta,
        contributionDelta,
        residual,
      });
    }

    const finalDelta = this.#terms.reduce((sum, term) => sum + term.delta, 0);
    if (!withinTolerance(expectedDelta, finalDelta)) {
      throw new Error("Causal contribution reconciliation failed");
    }

    return {
      indicatorId: this.indicatorId,
      beforeValue: this.beforeValue,
      afterValue,
      totalDelta: expectedDelta,
      contributions: [...this.#terms],
      diagnostics: [...this.#diagnostics],
    };
  }
}

export function createContributionBuilder(
  indicatorId: CausalMetricId,
  beforeValue: number,
): ContributionBuilder {
  return new ContributionBuilder(indicatorId, beforeValue);
}

export function selectTopContributions(
  causal: CausalContribution,
  limit = 3,
): readonly CausalTerm[] {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new RangeError("limit must be a non-negative integer");
  }
  return causal.contributions
    .map((term, index) => ({ term, index }))
    .sort((left, right) => {
      const magnitude = Math.abs(right.term.delta) - Math.abs(left.term.delta);
      if (magnitude !== 0) return magnitude;
      const typeOrder = left.term.sourceType.localeCompare(right.term.sourceType);
      if (typeOrder !== 0) return typeOrder;
      const idOrder = left.term.sourceId.localeCompare(right.term.sourceId);
      if (idOrder !== 0) return idOrder;
      const labelOrder = left.term.labelKey.localeCompare(right.term.labelKey);
      return labelOrder !== 0 ? labelOrder : left.index - right.index;
    })
    .slice(0, limit)
    .map(({ term }) => term);
}
