const FALLBACK_LOCALE = "en-US";
const FALLBACK_MINOR_UNIT_DIGITS = 2;

function finiteAmount(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function displayLocale(locale: string) {
  try {
    new Intl.NumberFormat(locale || FALLBACK_LOCALE);
    return locale || FALLBACK_LOCALE;
  } catch {
    return FALLBACK_LOCALE;
  }
}

export function displayCurrency(currency: string) {
  return /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : "XXX";
}

export function currencyMinorUnitDigits(currency: string) {
  try {
    const digits = new Intl.NumberFormat(FALLBACK_LOCALE, {
      style: "currency",
      currency: displayCurrency(currency),
    }).resolvedOptions().maximumFractionDigits;
    return typeof digits === "number" && Number.isInteger(digits) && digits >= 0 && digits <= 20
      ? digits
      : FALLBACK_MINOR_UNIT_DIGITS;
  } catch {
    return FALLBACK_MINOR_UNIT_DIGITS;
  }
}

export function roundMoneyToMinorUnit(value: number, currency: string) {
  const fractionDigits = currencyMinorUnitDigits(currency);
  const formatted = new Intl.NumberFormat(FALLBACK_LOCALE, {
    useGrouping: false,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(finiteAmount(value));
  const rounded = Number(formatted);
  return rounded === 0 ? 0 : rounded;
}

export type BalancedSavingsDisplay = {
  total: number;
  investments: number;
  cash: number;
};

export function balanceSavingsDisplay(
  total: number,
  investments: number,
  currency: string,
): BalancedSavingsDisplay {
  const roundedTotal = roundMoneyToMinorUnit(total, currency);
  const roundedInvestments = roundMoneyToMinorUnit(investments, currency);
  const cash = roundMoneyToMinorUnit(roundedTotal - roundedInvestments, currency);
  return {
    total: roundedTotal,
    investments: roundedInvestments,
    cash,
  };
}

export function formatMoney(
  value: number,
  currency: string,
  locale: string,
  compact = false,
) {
  const amount = roundMoneyToMinorUnit(value, currency);
  const fractionDigits = currencyMinorUnitDigits(currency);
  const formatter = new Intl.NumberFormat(displayLocale(locale), compact
    ? {
        maximumFractionDigits: 1,
        notation: "compact",
      }
    : {
        minimumFractionDigits: 0,
        maximumFractionDigits: fractionDigits,
      });
  const sign = amount < 0 ? "−" : "";
  return `${sign}${displayCurrency(currency)} ${formatter.format(Math.abs(amount))}`;
}
