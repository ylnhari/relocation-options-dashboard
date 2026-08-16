import type {
  FieldDefinition,
  FieldGroup,
  Scenario,
  WayfinderDocument,
} from "./scenarios";

export type BreakdownItem = {
  id: string;
  label: string;
  description: string;
  scope: "perOption" | "shared";
  localAmount: number;
  baseAmount: number;
};

export type DerivedScenario = Scenario & {
  grossBase: number;
  deductionMonthly: number;
  deductionBase: number;
  automaticInvestmentMonthly: number;
  automaticInvestmentBase: number;
  netCashMonthly: number;
  netCashBase: number;
  livingMonthly: number;
  livingBase: number;
  optionCommitmentMonthly: number;
  optionCommitmentBase: number;
  sharedCommitmentBase: number;
  commitmentBase: number;
  plannedInvestmentMonthly: number;
  optionPlannedInvestmentBase: number;
  sharedPlannedInvestmentBase: number;
  plannedInvestmentBase: number;
  totalInvestmentBase: number;
  totalSavingBase: number;
  totalSavingMonthly: number;
  cashRemainingBase: number;
  cashRemainingMonthly: number;
  savingRate: number;
  breakdown: Record<FieldGroup, BreakdownItem[]>;
};

function fieldsInGroup(
  document: Pick<WayfinderDocument, "fieldDefinitions">,
  group: FieldGroup,
) {
  return document.fieldDefinitions.filter((field) => field.group === group);
}

function localValue(scenario: Scenario, field: FieldDefinition) {
  return field.scope === "perOption" ? scenario.values[field.id] ?? 0 : 0;
}

function sharedValue(
  document: Pick<WayfinderDocument, "sharedValues">,
  field: FieldDefinition,
) {
  return field.scope === "shared" ? document.sharedValues[field.id] ?? 0 : 0;
}

function breakdownFor(
  document: Pick<WayfinderDocument, "fieldDefinitions" | "sharedValues">,
  scenario: Scenario,
  group: FieldGroup,
): BreakdownItem[] {
  return fieldsInGroup(document, group).map((field) => {
    const localAmount = localValue(scenario, field);
    const baseAmount =
      field.scope === "shared"
        ? sharedValue(document, field)
        : localAmount * scenario.fx.rateToBase;
    return {
      id: field.id,
      label: field.label,
      description: field.description,
      scope: field.scope,
      localAmount:
        field.scope === "shared" && scenario.fx.rateToBase > 0
          ? baseAmount / scenario.fx.rateToBase
          : localAmount,
      baseAmount,
    };
  });
}

function totalBase(items: BreakdownItem[]) {
  return items.reduce((total, item) => total + item.baseAmount, 0);
}

function totalLocal(items: BreakdownItem[], scope: "perOption" | "shared") {
  return items
    .filter((item) => item.scope === scope)
    .reduce((total, item) => total + item.localAmount, 0);
}

export function deriveScenario(
  document: Pick<
    WayfinderDocument,
    "fieldDefinitions" | "sharedValues" | "baseCurrency"
  >,
  scenario: Scenario,
): DerivedScenario {
  const breakdown = {
    deduction: breakdownFor(document, scenario, "deduction"),
    automaticInvestment: breakdownFor(
      document,
      scenario,
      "automaticInvestment",
    ),
    livingCost: breakdownFor(document, scenario, "livingCost"),
    commitment: breakdownFor(document, scenario, "commitment"),
    plannedInvestment: breakdownFor(document, scenario, "plannedInvestment"),
  };

  const grossBase = scenario.grossMonthly * scenario.fx.rateToBase;
  const deductionBase = totalBase(breakdown.deduction);
  const deductionMonthly = totalLocal(breakdown.deduction, "perOption");
  const automaticInvestmentBase = totalBase(breakdown.automaticInvestment);
  const automaticInvestmentMonthly = totalLocal(
    breakdown.automaticInvestment,
    "perOption",
  );
  const netCashBase = grossBase - deductionBase - automaticInvestmentBase;
  const netCashMonthly =
    scenario.grossMonthly - deductionMonthly - automaticInvestmentMonthly;
  const livingBase = totalBase(breakdown.livingCost);
  const livingMonthly = totalLocal(breakdown.livingCost, "perOption");
  const optionCommitmentBase = totalBase(
    breakdown.commitment.filter((item) => item.scope === "perOption"),
  );
  const optionCommitmentMonthly = totalLocal(
    breakdown.commitment,
    "perOption",
  );
  const sharedCommitmentBase = totalBase(
    breakdown.commitment.filter((item) => item.scope === "shared"),
  );
  const commitmentBase = optionCommitmentBase + sharedCommitmentBase;
  const optionPlannedInvestmentBase = totalBase(
    breakdown.plannedInvestment.filter((item) => item.scope === "perOption"),
  );
  const plannedInvestmentMonthly = totalLocal(
    breakdown.plannedInvestment,
    "perOption",
  );
  const sharedPlannedInvestmentBase = totalBase(
    breakdown.plannedInvestment.filter((item) => item.scope === "shared"),
  );
  const plannedInvestmentBase =
    optionPlannedInvestmentBase + sharedPlannedInvestmentBase;
  const totalInvestmentBase = automaticInvestmentBase + plannedInvestmentBase;

  // Automatic investments are deducted before net cash but remain savings.
  const totalSavingBase =
    automaticInvestmentBase + netCashBase - livingBase - commitmentBase;
  const cashRemainingBase = totalSavingBase - totalInvestmentBase;
  const totalSavingMonthly =
    scenario.fx.rateToBase > 0 ? totalSavingBase / scenario.fx.rateToBase : 0;
  const cashRemainingMonthly =
    scenario.fx.rateToBase > 0 ? cashRemainingBase / scenario.fx.rateToBase : 0;

  return {
    ...scenario,
    grossBase,
    deductionMonthly,
    deductionBase,
    automaticInvestmentMonthly,
    automaticInvestmentBase,
    netCashMonthly,
    netCashBase,
    livingMonthly,
    livingBase,
    optionCommitmentMonthly,
    optionCommitmentBase,
    sharedCommitmentBase,
    commitmentBase,
    plannedInvestmentMonthly,
    optionPlannedInvestmentBase,
    sharedPlannedInvestmentBase,
    plannedInvestmentBase,
    totalInvestmentBase,
    totalSavingBase,
    totalSavingMonthly,
    cashRemainingBase,
    cashRemainingMonthly,
    savingRate: grossBase > 0 ? (totalSavingBase / grossBase) * 100 : 0,
    breakdown,
  };
}

export function projectScenario(
  document: Pick<
    WayfinderDocument,
    "fieldDefinitions" | "sharedValues" | "baseCurrency" | "projectionAssumptions"
  >,
  scenario: Scenario,
) {
  const baseline = deriveScenario(document, scenario);
  const incomeGrowth = document.projectionAssumptions.incomeGrowthPct / 100;
  const expenseInflation =
    document.projectionAssumptions.expenseInflationPct / 100;

  return Array.from(
    { length: document.projectionAssumptions.years },
    (_, index) => {
      const grossBase = baseline.grossBase * (1 + incomeGrowth) ** index;
      const deductionBase = baseline.deductionBase * (1 + incomeGrowth) ** index;
      const automaticInvestmentBase =
        baseline.automaticInvestmentBase * (1 + incomeGrowth) ** index;
      const netCashBase = grossBase - deductionBase - automaticInvestmentBase;
      const livingBase = baseline.livingBase * (1 + expenseInflation) ** index;
      const commitmentBase =
        baseline.commitmentBase * (1 + expenseInflation) ** index;
      const totalSavingBase =
        automaticInvestmentBase + netCashBase - livingBase - commitmentBase;
      const plannedInvestmentBase = baseline.plannedInvestmentBase;
      const totalInvestmentBase =
        automaticInvestmentBase + plannedInvestmentBase;
      const cashRemainingBase = totalSavingBase - totalInvestmentBase;

      return {
        year: index + 1,
        grossBase,
        netCashBase,
        totalInvestmentBase,
        totalSavingBase,
        cashRemainingBase,
        annualGrossBase: grossBase * 12,
        annualNetCashBase: netCashBase * 12,
        annualInvestmentBase: totalInvestmentBase * 12,
        annualSavingBase: totalSavingBase * 12,
        annualCashRemainingBase: cashRemainingBase * 12,
      };
    },
  );
}
