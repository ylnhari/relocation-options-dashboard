import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

async function editorSection(dialog: Locator, title: string): Promise<Locator> {
  const fieldset = dialog.getByRole("group", { name: title });
  if (await fieldset.count()) return fieldset;

  const detailsSections = dialog.locator("details.editor-section");
  for (let index = 0; index < await detailsSections.count(); index += 1) {
    const candidate = detailsSections.nth(index);
    const heading = await candidate.locator(":scope > summary > strong").textContent();
    if (heading?.trim() !== title) continue;
    if (!await candidate.evaluate((element) => (element as HTMLDetailsElement).open)) {
      await candidate.locator(":scope > summary").click();
    }
    return candidate;
  }

  throw new Error(`Could not find editor section: ${title}`);
}

async function addDynamicField(
  dialog: Locator,
  sectionTitle: string,
  shortName: string,
  buttonName: string,
  label: string,
  reclassifyEmptyScope = false,
) {
  const labels = dialog.getByLabel(`${shortName} field label`, { exact: true });
  const expectedCount = await labels.count() + 1;
  const section = await editorSection(dialog, sectionTitle);
  await section.getByRole("button", { name: buttonName }).click();
  await expect(labels).toHaveCount(expectedCount);
  await editorSection(dialog, sectionTitle);
  if (reclassifyEmptyScope) {
    await dialog.getByLabel("New item scope", { exact: true }).selectOption("shared");
  }
  await labels.last().fill(label);
}

async function markBlankAmountsAsZero(dialog: Locator, sectionTitle: string) {
  const section = await editorSection(dialog, sectionTitle);
  const action = section.getByRole("button", { name: /Use 0 for \d+ blank items? in this section/ });
  if (await action.count()) await action.click();
}

async function markBlankSharedAmountsAsZero(dialog: Locator, sectionTitle: string) {
  const section = await editorSection(dialog, sectionTitle);
  const action = section.getByRole("button", { name: /Use 0 for \d+ blank shared items? in this section/ });
  if (await action.count()) await action.click();
}

async function downloadDocument(page: Page, testInfo: TestInfo, name: string) {
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download editable comparison file" }).click();
  const download = await downloadPromise;
  const path = testInfo.outputPath(name);
  await download.saveAs(path);
  await expect(page.getByRole("dialog", { name: "Choose what to download" })).toBeHidden();
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function withoutTimestamp(document: Record<string, unknown>) {
  const copy = structuredClone(document);
  delete copy.updatedAt;
  return copy;
}

test("a clean browser preserves a complete fictional comparison through export, reset, and safe import", async ({ page }, testInfo) => {
  await page.goto("/");
  const welcomeHeading = page.getByRole("heading", { name: /Enter your numbers/i });
  await expect(welcomeHeading).toBeVisible();
  await welcomeHeading.locator("xpath=ancestor::section[1]").getByRole("button", { name: "Enter my details" }).click();
  const shared = page.getByRole("dialog", { name: "Shared settings" });
  await shared.getByLabel("Comparison title", { exact: true }).fill("Fictional Harbor Options");
  await shared.getByLabel(/^Comparison currency/).fill("USD");
  await shared.getByLabel(/^Number format/).fill("en-US");
  await shared.getByLabel(/^Annual income growth/).fill("3");
  await shared.getByLabel(/^Annual expense inflation/).fill("2");
  await shared.getByLabel(/^Projection years/).fill("5");
  await shared.getByRole("checkbox", { name: /I reviewed the comparison currency/i }).check();

  await addDynamicField(shared, "Gross-to-net deductions", "Deductions", "Add monthly item for each option", "Illustrative local deduction");
  await addDynamicField(shared, "Automatic payroll investments", "Automatic investments", "Add monthly item for each option", "Illustrative payroll investment");
  await addDynamicField(shared, "Monthly living costs", "Living costs", "Add monthly item for each option", "Illustrative local utility");
  await addDynamicField(shared, "Continuing commitments", "Commitments", "Add monthly item for each option", "Illustrative local commitment");
  await addDynamicField(shared, "Continuing commitments", "Commitments", "Add monthly item for each option", "Illustrative reclassified commitment", true);
  await addDynamicField(shared, "Continuing commitments", "Commitments", "Add one shared monthly item", "Illustrative shared commitment");
  await addDynamicField(shared, "Planned post-tax investments", "Planned investments", "Add monthly item for each option", "Illustrative local investment");
  await addDynamicField(shared, "Planned post-tax investments", "Planned investments", "Add one shared monthly item", "Illustrative shared investment");

  await expect(shared.getByLabel("Debt repayments monthly amount in USD", { exact: true })).toHaveValue("");
  await shared.getByRole("button", { name: "Save settings and enter current situation" }).click();
  await expect(shared).toBeVisible();
  await markBlankSharedAmountsAsZero(shared, "Continuing commitments");
  await markBlankSharedAmountsAsZero(shared, "Planned post-tax investments");

  await shared.getByLabel("Illustrative shared commitment monthly amount in USD", { exact: true }).fill("125");
  await shared.getByLabel("Illustrative shared investment monthly amount in USD", { exact: true }).fill("80");
  const sharedCommitment = shared.locator(
    '.model-field-row:has(input[aria-label="Illustrative shared commitment monthly amount in USD"])',
  );
  const sharedCommitmentSource = sharedCommitment.locator("details.source-editor");
  await sharedCommitmentSource.locator(":scope > summary").click();
  await sharedCommitmentSource.locator("select").selectOption("confirmed");
  await sharedCommitmentSource.locator('input[type="date"]').fill("2026-08-17");
  await sharedCommitmentSource.locator('input[placeholder^="Payslip"]').fill("Illustrative commitment record");

  let support = await editorSection(shared, "External Help / Family Support received");
  await support.getByRole("button", { name: "Add excluded support note" }).click();
  support = await editorSection(shared, "External Help / Family Support received");
  await support.getByLabel("Excluded support label", { exact: true }).fill("Illustrative external support");
  await support.getByLabel("Illustrative external support monthly amount in USD", { exact: true }).fill("40");
  await support.getByLabel("Illustrative external support note", { exact: true }).fill("Context only; excluded from totals.");

  const research = await editorSection(shared, "Research and sources");
  await research.getByRole("button", { name: "Add research record" }).click();
  await editorSection(shared, "Research and sources");
  const researchRecord = shared.locator("article.research-editor-row").last();
  await researchRecord.locator("select").nth(0).selectOption("housing");
  await researchRecord.locator("select").nth(1).selectOption("verified");
  await researchRecord.locator("input").nth(0).fill("Illustrative housing reference");
  await researchRecord.locator("textarea").fill("Synthetic source retained to prove research survives a full browser restore.");
  await researchRecord.locator("input").nth(1).fill("Example Publisher");
  await researchRecord.locator('input[type="date"]').fill("2026-08-17");
  await researchRecord.locator("input").nth(3).fill("Illustrative source page");
  await researchRecord.locator('input[type="url"]').fill("https://example.com/wayfinder-e2e");
  await researchRecord.locator("input").nth(5).fill("Generic fixture only.");

  await shared.getByRole("button", { name: "Save settings and enter current situation" }).click();
  const current = page.getByRole("dialog", { name: "Enter your current option" });
  await current.getByLabel("Option name", { exact: true }).fill("Fictional Base Option");
  await current.getByLabel("Location", { exact: true }).fill("Sample City, Exampleland");
  await current.getByLabel("Income summary", { exact: true }).fill("One fictional income included.");
  await current.getByLabel("Status", { exact: true }).fill("Current illustration");
  await current.getByLabel("Country code / badge", { exact: true }).fill("EX");
  await current.getByLabel("Household earners included", { exact: true }).fill("1");
  await current.getByLabel("Monthly gross compensation in USD", { exact: true }).fill("4000");
  const untouchedLiving = await editorSection(current, "Monthly living costs");
  await expect(untouchedLiving.locator(":scope > summary")).toContainText(/\d+ monthly items · 0 entered/);
  for (const sectionTitle of [
    "Gross-to-net deductions",
    "Automatic payroll investments",
    "Monthly living costs",
    "Continuing commitments",
    "Planned post-tax investments",
  ]) {
    await markBlankAmountsAsZero(current, sectionTitle);
  }
  const grossEvidence = current.locator("details.source-editor").filter({ hasText: "Gross compensation accuracy and source" });
  await grossEvidence.locator(":scope > summary").click();
  await grossEvidence.locator("select").selectOption("confirmed");
  await grossEvidence.locator('input[type="date"]').fill("2026-08-17");
  await grossEvidence.locator('input[placeholder^="Payslip"]').fill("Illustrative compensation record");
  await (await editorSection(current, "Gross-to-net deductions")).getByLabel("Illustrative local deduction in USD", { exact: true }).fill("20");
  await (await editorSection(current, "Automatic payroll investments")).getByLabel("Illustrative payroll investment in USD", { exact: true }).fill("30");
  await (await editorSection(current, "Monthly living costs")).getByLabel("Illustrative local utility in USD", { exact: true }).fill("50");
  await (await editorSection(current, "Continuing commitments")).getByLabel("Illustrative local commitment in USD", { exact: true }).fill("35");
  await (await editorSection(current, "Planned post-tax investments")).getByLabel("Illustrative local investment in USD", { exact: true }).fill("60");
  const localUtility = current.locator(
    '.amount-field-row:has(input[aria-label="Illustrative local utility in USD"])',
  );
  const localUtilitySource = localUtility.locator("details.source-editor");
  await localUtilitySource.locator(":scope > summary").click();
  await localUtilitySource.locator("select").selectOption("confirmed");
  await localUtilitySource.locator('input[type="date"]').fill("2026-08-17");
  await localUtilitySource.locator('input[placeholder^="Payslip"]').fill("Illustrative utility record");
  const assumptions = current.locator("details").filter({ hasText: "Qualitative assumptions" }).first();
  await assumptions.locator("summary").click();
  await assumptions.locator("input").nth(0).fill("No fictional spouse income is included.");
  await assumptions.locator("input").nth(1).fill("Fictional care is included in the local budget.");
  await assumptions.locator("input").nth(2).fill("Fictional transit pass is included.");
  await assumptions.locator("input").nth(3).fill("Fictional status remains subject to review.");
  await assumptions.locator("input").nth(4).fill("No fictional bonus is included in recurring totals.");
  await assumptions.locator("textarea").nth(0).fill("Illustrative benefit");
  await assumptions.locator("textarea").nth(1).fill("Illustrative uncertainty");
  await current.getByLabel("Illustrative local utility in USD", { exact: true }).fill("");
  await expect(current.locator(".editor-preview")).toHaveCount(0);
  await expect(current.getByText(/Totals stay hidden until every amount is confirmed/i)).toBeVisible();
  await current.getByRole("button", { name: "Save current situation" }).click();
  await expect(current).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fictional Base Option", exact: true })).toHaveCount(0);
  await current.getByLabel("Illustrative local utility in USD", { exact: true }).fill("50");
  await current.getByRole("button", { name: "Save current situation" }).click();
  await expect(page.getByRole("heading", { name: "Fictional Base Option", exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Add option" }).click();
  const nonBase = page.getByRole("dialog", { name: "Add a new option" });
  await nonBase.getByLabel("Option name", { exact: true }).fill("Fictional Non-base Option");
  await nonBase.getByLabel("Location", { exact: true }).fill("Sample Port, Exampleland");
  await nonBase.getByLabel("Income summary", { exact: true }).fill("One fictional alternative income included.");
  await nonBase.getByLabel("Status", { exact: true }).fill("Planning illustration");
  await nonBase.getByLabel("Country code / badge", { exact: true }).fill("SP");
  await nonBase.getByLabel("Household earners included", { exact: true }).fill("1");
  await markBlankAmountsAsZero(nonBase, "Gross-to-net deductions");
  await expect(nonBase.getByLabel(/^Option currency/)).toBeEnabled();
  await nonBase.getByLabel(/^Option currency/).fill("EUR");
  await nonBase.getByLabel("Monthly gross compensation in EUR", { exact: true }).fill("5000");
  for (const sectionTitle of [
    "Gross-to-net deductions",
    "Automatic payroll investments",
    "Monthly living costs",
    "Continuing commitments",
    "Planned post-tax investments",
  ]) {
    await markBlankAmountsAsZero(nonBase, sectionTitle);
  }
  await nonBase.getByRole("button", { name: "Add option" }).click();
  await expect(nonBase.getByText(/This option cannot be added until they are complete/i)).toBeVisible();
  await expect(page.getByText("Fictional Non-base Option", { exact: true })).toHaveCount(0);

  await nonBase.getByLabel("Conversion ratio", { exact: true }).fill("0.8");
  await nonBase.getByLabel(/Conversion date/).fill("2026-08-17");
  await nonBase.getByLabel(/Conversion source/).fill("Illustrative published conversion table");
  await nonBase.getByRole("button", { name: "Add option" }).click();
  await expect(page.getByRole("heading", { name: "Fictional Non-base Option", exact: true }).first()).toBeVisible();

  const exported = await downloadDocument(page, testInfo, "complete-comparison.json");
  execFileSync(
    process.execPath,
    ["scripts/validate-data.mjs", testInfo.outputPath("complete-comparison.json")],
    { cwd: repositoryRoot, encoding: "utf8" },
  );

  await page.getByRole("button", { name: "Clear this browser" }).click();
  await page.getByRole("dialog", { name: "Clear this browser?" }).getByRole("button", { name: "Clear all local data" }).click();
  await expect(page.getByRole("heading", { name: /Enter your numbers/i })).toBeVisible();

  const upload = page.getByLabel("Select complete comparison JSON file", { exact: true });
  await upload.setInputFiles(testInfo.outputPath("complete-comparison.json"));
  await page.getByRole("dialog", { name: "Replace this browser’s complete comparison?" }).getByRole("button", { name: "Replace complete comparison" }).click();
  await expect(page.getByRole("heading", { name: "Fictional Base Option", exact: true }).first()).toBeVisible();
  await expect(page.getByText("Fictional status remains subject to review.", { exact: true })).toBeVisible();
  await expect(page.getByText("Illustrative housing reference", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open source ↗" })).toHaveAttribute("href", "https://example.com/wayfinder-e2e");
  await expect(page.getByText("Illustrative external support", { exact: true })).toBeVisible();
  await expect(page.getByText("Context only; excluded from totals.", { exact: true })).toBeVisible();

  const reexported = await downloadDocument(page, testInfo, "restored-comparison.json");
  expect(withoutTimestamp(reexported)).toEqual(withoutTimestamp(exported));

  const semanticallyInvalid = structuredClone(exported) as {
    scenarios: Array<{ values: Record<string, number>; fx: { asOf: string | null } }>;
  };
  semanticallyInvalid.scenarios[0].values["fictional-unknown-value"] = 1;
  semanticallyInvalid.scenarios[1].fx.asOf = null;
  await upload.setInputFiles({
    name: "semantically-invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(semanticallyInvalid)),
  });
  await expect(page.getByRole("dialog", { name: "Fix these fields" })).toBeVisible();
  await expect(page.getByText(/Unknown option field ID/i)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Fix these fields" }).getByText(/File field:/i).first()).toBeVisible();
  await page.getByRole("dialog", { name: "Fix these fields" }).getByRole("button", { name: "Close", exact: true }).click();

  const afterRejectedImport = await downloadDocument(page, testInfo, "after-rejected-import.json");
  expect(withoutTimestamp(afterRejectedImport)).toEqual(withoutTimestamp(reexported));
});
