export type Brand<T, TBrand extends string> = T & { readonly __brand: TBrand };

export type PercentPoint = Brand<number, "PercentPoint">;
export type PercentRate = Brand<number, "PercentRate">;
export type IndexLevel = Brand<number, "IndexLevel">;
export type LogIndex = Brand<number, "LogIndex">;
export type FlowPerMonth = Brand<number, "FlowPerMonth">;
export type StockLevel = Brand<number, "StockLevel">;
export type Share01 = Brand<number, "Share01">;
export type ScorePoint = Brand<number, "ScorePoint">;
export type MonthCount = Brand<number, "MonthCount">;

export type NumericUnit =
  | "PercentPoint"
  | "PercentRate"
  | "IndexLevel"
  | "LogIndex"
  | "FlowPerMonth"
  | "StockLevel"
  | "Share01"
  | "ScorePoint"
  | "MonthCount"
  | "Scalar";

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  return value;
}

export const percentPoint = (value: number): PercentPoint => finite(value, "PercentPoint") as PercentPoint;
export const percentRate = (value: number): PercentRate => finite(value, "PercentRate") as PercentRate;
export const indexLevel = (value: number): IndexLevel => finite(value, "IndexLevel") as IndexLevel;
export const logIndex = (value: number): LogIndex => finite(value, "LogIndex") as LogIndex;
export const flowPerMonth = (value: number): FlowPerMonth => finite(value, "FlowPerMonth") as FlowPerMonth;
export const stockLevel = (value: number): StockLevel => finite(value, "StockLevel") as StockLevel;
export const scorePoint = (value: number): ScorePoint => finite(value, "ScorePoint") as ScorePoint;
export const monthCount = (value: number): MonthCount => {
  if (!Number.isInteger(value) || value < 0) throw new RangeError("MonthCount must be a non-negative integer");
  return value as MonthCount;
};
export const share01 = (value: number): Share01 => {
  finite(value, "Share01");
  if (value < 0 || value > 1) throw new RangeError("Share01 must be between 0 and 1");
  return value as Share01;
};

/**
 * Sign conventions:
 * yGap > 0 = output above potential; rGap > 0 = restrictive real rate;
 * uGap > 0 = unemployment above NAIRU; fx > 0 movement = domestic currency depreciation.
 */
export interface EconomicGaps {
  readonly yGap: PercentRate;
  readonly rGap: PercentPoint;
  readonly uGap: PercentPoint;
}
