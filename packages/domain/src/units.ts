declare const unitBrand: unique symbol;

export type NumericUnit<Name extends string> = number & { readonly [unitBrand]: Name };

export type PercentPoint = NumericUnit<"PercentPoint">;
export type PercentRate = NumericUnit<"PercentRate">;
export type IndexLevel = NumericUnit<"IndexLevel">;
export type LogIndex = NumericUnit<"LogIndex">;
export type FlowPerMonth = NumericUnit<"FlowPerMonth">;
export type StockLevel = NumericUnit<"StockLevel">;
export type Share01 = NumericUnit<"Share01">;

export type UnitName =
  | "PercentPoint"
  | "PercentRate"
  | "IndexLevel"
  | "LogIndex"
  | "FlowPerMonth"
  | "StockLevel"
  | "Share01";

function finite<Name extends UnitName>(value: number, name: Name): NumericUnit<Name> {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be finite`);
  }
  return value as NumericUnit<Name>;
}

export const percentPoint = (value: number): PercentPoint => finite(value, "PercentPoint");
export const percentRate = (value: number): PercentRate => finite(value, "PercentRate");
export const indexLevel = (value: number): IndexLevel => finite(value, "IndexLevel");
export const logIndex = (value: number): LogIndex => finite(value, "LogIndex");
export const flowPerMonth = (value: number): FlowPerMonth => finite(value, "FlowPerMonth");
export const stockLevel = (value: number): StockLevel => finite(value, "StockLevel");

export function share01(value: number): Share01 {
  if (value < 0 || value > 1) {
    throw new RangeError("Share01 must be between 0 and 1");
  }
  return finite(value, "Share01") as Share01;
}

/**
 * Display rounding intentionally erases the unit brand. A rounded value therefore
 * cannot be assigned back into simulation state without an explicit conversion.
 */
export function roundForDisplay(value: number, fractionDigits: number): number {
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 12) {
    throw new RangeError("fractionDigits must be an integer between 0 and 12");
  }
  const factor = 10 ** fractionDigits;
  return Math.round(value * factor) / factor;
}
