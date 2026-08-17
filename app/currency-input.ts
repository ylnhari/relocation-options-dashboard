type FxSnapshotLike = {
  rateToBase: number;
  asOf: string | null;
  source: string;
};

export function hasUsableFxRate(rateToBase: number) {
  return Number.isFinite(rateToBase) && rateToBase > 0;
}

export function localToBaseAmount(localAmount: number, rateToBase: number) {
  if (!Number.isFinite(localAmount) || !hasUsableFxRate(rateToBase)) return null;
  return localAmount * rateToBase;
}

export function baseToLocalAmount(baseAmount: number, rateToBase: number) {
  if (!Number.isFinite(baseAmount) || !hasUsableFxRate(rateToBase)) return null;
  return baseAmount / rateToBase;
}

export function parseMoneyInput(value: string) {
  if (!value.trim()) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function formatEditableAmount(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "";
  return String(Object.is(value, -0) ? 0 : value);
}

export function fxAfterCurrencyChange(
  currentCurrency: string,
  nextCurrency: string,
  baseCurrency: string,
  currentFx: FxSnapshotLike,
): FxSnapshotLike {
  if (nextCurrency === baseCurrency) {
    return { rateToBase: 1, asOf: null, source: "" };
  }
  if (nextCurrency === currentCurrency) return currentFx;
  return { rateToBase: 0, asOf: null, source: "" };
}
