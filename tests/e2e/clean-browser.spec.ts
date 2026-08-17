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
  const action = section.getByRole("button", { name: /Use 0 for \d+ blank monthly amounts? that apply to every place, job, or plan in this section/ });
  if (await action.count()) await action.click();
}

async function downloadDocument(page: Page, testInfo: TestInfo, name: string) {
  await page.locator(".topbar-actions").getByRole("button", { name: "Download or import", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download saved comparison file" }).click();
  const download = await downloadPromise;
  const path = testInfo.outputPath(name);
  await download.saveAs(path);
  await expect(page.getByRole("dialog", { name: "Download or import a comparison file" })).toBeHidden();
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

async function downloadFamilyView(page: Page, testInfo: TestInfo, name: string) {
  await page.locator(".topbar-actions").getByRole("button", { name: "Download or import", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download family-readable summary" }).click();
  const download = await downloadPromise;
  const path = testInfo.outputPath(name);
  await download.saveAs(path);
  await expect(page.getByRole("dialog", { name: "Download or import a comparison file" })).toBeHidden();
  return readFileSync(path, "utf8");
}

function withoutTimestamp(document: Record<string, unknown>) {
  const copy = structuredClone(document);
  delete copy.updatedAt;
  return copy;
}

async function loadFictionalExample(page: Page, document?: Record<string, unknown>) {
  const fixture = document ?? JSON.parse(
    readFileSync(new URL("../../examples/wayfinder.example.json", import.meta.url), "utf8"),
  ) as Record<string, unknown>;
  await page.addInitScript(({ savedDocument }) => {
    window.localStorage.setItem("wayfinder.document.v4", JSON.stringify(savedDocument));
  }, { savedDocument: fixture });
}

test("a clean browser preserves a complete fictional comparison through export, reset, and safe import", async ({ page }, testInfo) => {
  await page.goto("/");
  const welcomeHeading = page.getByRole("heading", { name: /Enter your numbers/i });
  await expect(welcomeHeading).toBeVisible();
  const templateDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download an empty comparison file" }).click();
  const templateDownload = await templateDownloadPromise;
  const templatePath = testInfo.outputPath("empty-comparison.v5.json");
  await templateDownload.saveAs(templatePath);
  const emptyTemplate = JSON.parse(readFileSync(templatePath, "utf8")) as { schemaVersion: number; currentScenarioId: string | null };
  expect(emptyTemplate.schemaVersion).toBe(5);
  expect(emptyTemplate.currentScenarioId).toBeNull();
  await welcomeHeading.locator("xpath=ancestor::section[1]").getByRole("button", { name: "Enter my details" }).click();
  const shared = page.getByRole("dialog", { name: "Home currency, future estimates, and amounts used in every plan" });
  await shared.getByLabel("Comparison title", { exact: true }).fill("Fictional Harbor Options");
  await shared.getByLabel(/^Home currency for all charts and totals/).fill("USD");
  await shared.getByLabel(/^Number format/).fill("en-US");
  await shared.getByLabel(/^Annual income growth/).fill("3");
  await shared.getByLabel(/^Annual cost inflation for the future estimate/).fill("2");
  await shared.getByLabel(/^Years to show in the future estimate/).fill("5");
  await shared.getByRole("checkbox", { name: /I reviewed the home currency for all charts and totals/i }).check();

  await addDynamicField(shared, "Tax and other deductions", "Tax and other deductions", "Add a monthly amount for each place, job, or plan", "Illustrative local deduction");
  await addDynamicField(shared, "Monthly automatic payroll savings (PF, pension, or similar)", "Automatic payroll savings", "Add a monthly amount for each place, job, or plan", "Illustrative payroll investment");
  await addDynamicField(shared, "Monthly living costs", "Living costs", "Add a monthly amount for each place, job, or plan", "Illustrative local utility");
  await addDynamicField(shared, "Monthly obligations that continue", "Monthly obligations that continue", "Add a monthly amount for each place, job, or plan", "Illustrative local commitment");
  await addDynamicField(shared, "Monthly obligations that continue", "Monthly obligations that continue", "Add a monthly amount for each place, job, or plan", "Illustrative reclassified commitment", true);
  await addDynamicField(shared, "Monthly obligations that continue", "Monthly obligations that continue", "Add one monthly amount for every place, job, or plan", "Illustrative shared commitment");
  await addDynamicField(shared, "Monthly investments from after-tax cash", "Monthly investments", "Add a monthly amount for each place, job, or plan", "Illustrative local investment");
  await addDynamicField(shared, "Monthly investments from after-tax cash", "Monthly investments", "Add one monthly amount for every place, job, or plan", "Illustrative shared investment");

  await expect(shared.getByLabel("Loan payments that stay the same after a move monthly amount in USD", { exact: true })).toHaveValue("");
  await shared.getByRole("button", { name: "Save settings and enter your current place, job, or plan" }).click();
  await expect(shared).toBeVisible();
  await markBlankSharedAmountsAsZero(shared, "Monthly obligations that continue");
  await markBlankSharedAmountsAsZero(shared, "Monthly investments from after-tax cash");

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

  await shared.getByRole("button", { name: "Save settings and enter your current place, job, or plan" }).click();
  const current = page.getByRole("dialog", { name: "Enter your current job and home-country household position" });
  await current.getByLabel(/^Place, job, or plan name/).fill("Fictional Base Option");
  await current.getByLabel(/^Place or location/).fill("Sample City, Exampleland");
  await current.getByLabel(/^Who earns income in this plan/).fill("One fictional income included.");
  await current.getByLabel(/^Plan stage/).fill("Current illustration");
  await current.getByLabel(/^Flag country code/).fill("EX");
  await current.getByLabel(/^Number of earners counted in this plan/).fill("1");
  await current.getByLabel("Monthly gross income before tax and deductions in USD", { exact: true }).fill("4000");
  const untouchedLiving = await editorSection(current, "Monthly living costs");
  await expect(untouchedLiving.locator(":scope > summary")).toContainText(/\d+ monthly items · 0 entered/);
  for (const sectionTitle of [
    "Tax and other deductions",
    "Monthly automatic payroll savings (PF, pension, or similar)",
    "Monthly living costs",
    "Monthly obligations that continue",
    "Monthly investments from after-tax cash",
  ]) {
    await markBlankAmountsAsZero(current, sectionTitle);
  }
  const grossEvidence = current.locator("details.source-editor").filter({ hasText: "How reliable is this gross-income number?" });
  await grossEvidence.locator(":scope > summary").click();
  await grossEvidence.locator("select").selectOption("confirmed");
  await grossEvidence.locator('input[type="date"]').fill("2026-08-17");
  await grossEvidence.locator('input[placeholder^="Payslip"]').fill("Illustrative compensation record");
  await (await editorSection(current, "Tax and other deductions")).getByLabel("Illustrative local deduction in USD", { exact: true }).fill("20");
  await (await editorSection(current, "Monthly automatic payroll savings (PF, pension, or similar)")).getByLabel("Illustrative payroll investment in USD", { exact: true }).fill("30");
  await (await editorSection(current, "Monthly living costs")).getByLabel("Illustrative local utility in USD", { exact: true }).fill("50");
  await (await editorSection(current, "Monthly obligations that continue")).getByLabel("Illustrative local commitment in USD", { exact: true }).fill("35");
  await (await editorSection(current, "Monthly investments from after-tax cash")).getByLabel("Illustrative local investment in USD", { exact: true }).fill("60");
  const localUtility = current.locator(
    '.amount-field-row:has(input[aria-label="Illustrative local utility in USD"])',
  );
  const localUtilitySource = localUtility.locator("details.source-editor");
  await localUtilitySource.locator(":scope > summary").click();
  await localUtilitySource.locator("select").selectOption("confirmed");
  await localUtilitySource.locator('input[type="date"]').fill("2026-08-17");
  await localUtilitySource.locator('input[placeholder^="Payslip"]').fill("Illustrative utility record");
  const assumptions = current.locator("details").filter({ hasText: "Important non-financial details" }).first();
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
  await current.getByRole("button", { name: "Save your current job and home-country household position" }).click();
  await expect(current).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fictional Base Option", exact: true })).toHaveCount(0);
  await current.getByLabel("Illustrative local utility in USD", { exact: true }).fill("50");
  await current.getByRole("button", { name: "Save your current job and home-country household position" }).click();
  await expect(page.getByRole("heading", { name: "Fictional Base Option", exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Add another place, job, or plan" }).click();
  const nonBase = page.getByRole("dialog", { name: "Add another possible job, move, or household plan" });
  await nonBase.getByLabel(/^Place, job, or plan name/).fill("Fictional Non-base Option");
  await nonBase.getByLabel(/^Place or location/).fill("Sample Port, Exampleland");
  await nonBase.getByLabel(/^Who earns income in this plan/).fill("One fictional alternative income included.");
  await nonBase.getByLabel(/^Plan stage/).fill("Planning illustration");
  await nonBase.getByLabel(/^Flag country code/).fill("SP");
  await nonBase.getByLabel(/^Number of earners counted in this plan/).fill("1");
  await markBlankAmountsAsZero(nonBase, "Tax and other deductions");
  await expect(nonBase.getByLabel(/^Currency used in this place, job, or plan/)).toBeEnabled();
  await nonBase.getByLabel(/^Currency used in this place, job, or plan/).fill("EUR");
  await nonBase.getByLabel("Monthly gross income before tax and deductions in EUR", { exact: true }).fill("5000");
  for (const sectionTitle of [
    "Tax and other deductions",
    "Monthly automatic payroll savings (PF, pension, or similar)",
    "Monthly living costs",
    "Monthly obligations that continue",
    "Monthly investments from after-tax cash",
  ]) {
    await markBlankAmountsAsZero(nonBase, sectionTitle);
  }
  await nonBase.getByRole("button", { name: "Add this possible job, move, or household plan" }).click();
  await expect(nonBase.getByText(/This place, job, or plan cannot be added until they are complete/i)).toBeVisible();
  await expect(page.getByText("Fictional Non-base Option", { exact: true })).toHaveCount(0);

  await nonBase.getByLabel("Currency conversion ratio", { exact: true }).fill("0.8");
  await nonBase.getByLabel(/Conversion date checked/).fill("2026-08-17");
  await nonBase.getByLabel(/Where this conversion figure came from/).fill("Illustrative published conversion table");
  await nonBase.getByRole("button", { name: "Add this possible job, move, or household plan" }).click();
  await expect(page.getByRole("heading", { name: "Fictional Non-base Option", exact: true }).first()).toBeVisible();
  const baseCard = page.locator(".scenario-card").filter({
    has: page.getByRole("heading", { name: "Fictional Base Option", exact: true }),
  });
  const nonBaseCard = page.locator(".scenario-card").filter({
    has: page.getByRole("heading", { name: "Fictional Non-base Option", exact: true }),
  });
  await expect(baseCard.getByText("Current job and home-country household position", { exact: true })).toBeVisible();
  await expect(nonBaseCard.getByText("Possible job, move, or household plan", { exact: true })).toBeVisible();

  await nonBaseCard.locator("details.tile-breakdown > summary").click();
  const sharedCommitmentBreakdown = nonBaseCard.locator(".breakdown-line").filter({
    hasText: "Illustrative shared commitment",
  });
  await expect(sharedCommitmentBreakdown.getByText("Entered once for every plan", { exact: true })).toBeVisible();
  await expect(sharedCommitmentBreakdown.locator(".money-value strong")).toHaveText("USD 125");
  await expect(sharedCommitmentBreakdown.locator(".money-value small")).toHaveText("EUR 156.25");
  await page.getByRole("button", { name: "Each plan’s own currency" }).click();
  await expect(sharedCommitmentBreakdown.locator(".money-value strong")).toHaveText("EUR 156.25");
  await expect(sharedCommitmentBreakdown.locator(".money-value small")).toHaveText("USD 125");
  await page.getByRole("button", { name: "All amounts in USD" }).click();

  // A per-plan monthly amount added after plans already exist remains blank
  // until each plan supplies a typed amount or explicitly accepts zero.
  await page.getByRole("button", { name: "Home currency, future estimates, and amounts used in every plan", exact: true }).first().click();
  const afterPlans = page.getByRole("dialog", { name: "Home currency, future estimates, and amounts used in every plan" });
  await addDynamicField(
    afterPlans,
    "Monthly living costs",
    "Living costs",
    "Add a monthly amount for each place, job, or plan",
    "Illustrative post-setup local cost",
  );
  const currentPosition = afterPlans.getByLabel(/^Current job and home-country position/);
  await expect(currentPosition.locator("option:checked")).toHaveText("Fictional Base Option");
  await currentPosition.selectOption({ label: "Fictional Non-base Option" });
  await afterPlans.getByRole("button", { name: "Apply home currency, future estimates, and amounts used in every plan" }).click();
  await expect(afterPlans).toBeVisible();
  const basePendingAmount = afterPlans.getByLabel("Illustrative post-setup local cost for Fictional Base Option in USD", { exact: true });
  const nonBasePendingLocal = afterPlans.getByLabel("Illustrative post-setup local cost for Fictional Non-base Option in EUR", { exact: true });
  const nonBasePendingBase = afterPlans.getByLabel("Illustrative post-setup local cost for Fictional Non-base Option in USD", { exact: true });
  await expect(basePendingAmount).toHaveValue("");
  await expect(nonBasePendingLocal).toBeVisible();
  await expect(nonBasePendingBase).toBeVisible();

  await basePendingAmount.fill("17");
  await afterPlans.getByRole("button", { name: "Apply home currency, future estimates, and amounts used in every plan" }).click();
  await expect(afterPlans).toBeVisible();
  await afterPlans.getByRole("button", { name: "Use 0 for 1 blank monthly amount for Fictional Non-base Option in this section" }).click();
  await afterPlans.getByRole("button", { name: "Apply home currency, future estimates, and amounts used in every plan" }).click();
  await expect(afterPlans).toBeHidden();
  await expect(baseCard.getByText("Possible job, move, or household plan", { exact: true })).toBeVisible();
  await expect(nonBaseCard.getByText("Current job and home-country household position", { exact: true })).toBeVisible();

  const exported = await downloadDocument(page, testInfo, "complete-comparison.json");
  const exportedScenarios = exported.scenarios as Array<{ id: string; label: string }>;
  expect(exported.currentScenarioId).toBe(exportedScenarios.find((scenario) => scenario.label === "Fictional Non-base Option")?.id);
  execFileSync(
    process.execPath,
    ["scripts/validate-data.mjs", testInfo.outputPath("complete-comparison.json")],
    { cwd: repositoryRoot, encoding: "utf8" },
  );

  const familyView = await downloadFamilyView(page, testInfo, "family-view.html");
  expect(familyView).toContain('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\';');
  expect(familyView).toContain("Fictional Harbor Options");
  expect(familyView).toContain("Fictional Base Option");
  expect(familyView).toContain("Fictional Non-base Option");
  expect(familyView).toContain("Read-only financial summary:");
  expect(familyView).not.toMatch(/<script\b/i);

  await page.getByRole("button", { name: "Clear this browser" }).click();
  await page.getByRole("dialog", { name: "Clear this browser?" }).getByRole("button", { name: "Clear all local data" }).click();
  await expect(page.getByRole("heading", { name: /Enter your numbers/i })).toBeVisible();

  const upload = page.getByLabel("Select a saved comparison JSON file", { exact: true });
  await upload.setInputFiles(testInfo.outputPath("complete-comparison.json"));
  const importPreview = page.getByRole("dialog", { name: "Replace this browser’s complete comparison?" });
  await expect(importPreview.getByText("Fictional Non-base Option", { exact: true })).toBeVisible();
  await importPreview.getByRole("button", { name: "Replace complete comparison" }).click();
  await expect(page.getByRole("heading", { name: "Fictional Base Option", exact: true }).first()).toBeVisible();
  await expect(page.getByText("Fictional status remains subject to review.", { exact: true })).toBeVisible();
  await expect(page.getByText("Illustrative housing reference", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open source ↗" })).toHaveAttribute("href", "https://example.com/wayfinder-e2e");
  await expect(page.getByText("Illustrative external support", { exact: true })).toBeVisible();
  await expect(page.getByText("Context only; excluded from totals.", { exact: true })).toBeVisible();
  await expect(page.locator(".scenario-card").filter({ has: page.getByRole("heading", { name: "Fictional Non-base Option", exact: true }) }).getByText("Current job and home-country household position", { exact: true })).toBeVisible();

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

test("narrow viewports keep headings, linked amounts, and explicit-zero actions usable", async ({ page }) => {
  await loadFictionalExample(page);

  const expectNoRootOverflow = async (width: number) => {
    await expect.poll(
      () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy();
    await expect(page.getByRole("heading", { name: "Choose the monthly amount shown in each future chart" })).toBeVisible();
    const futureHeadingWraps = await page.getByRole("heading", { name: "Choose the monthly amount shown in each future chart" }).evaluate((element) => {
      const styles = window.getComputedStyle(element);
      return element.getBoundingClientRect().height > Number.parseFloat(styles.fontSize) * 1.3;
    });
    expect(futureHeadingWraps, `future heading should wrap at ${width}px`).toBeTruthy();
    if (width <= 360) {
      const headerActionsFit = await page.locator(".topbar-actions").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= window.innerWidth;
      });
      expect(headerActionsFit, `header actions should fit at ${width}px`).toBeTruthy();
    }
  };

  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Compare monthly income, costs, and money left for each move." })).toBeVisible();
  await expectNoRootOverflow(320);

  await page.getByRole("button", { name: "Edit future-estimate assumptions" }).click();
  const settings = page.getByRole("dialog", { name: "Home currency, future estimates, and amounts used in every plan" });
  await addDynamicField(
    settings,
    "Monthly living costs",
    "Living costs",
    "Add a monthly amount for each place, job, or plan",
    "Compact viewport monthly cost",
  );
  const pendingControls = settings.getByRole("button", { name: /Use 0 for 1 blank monthly amount .* in this section/ });
  await expect(pendingControls).toHaveCount(2);
  await expect(pendingControls.first()).toBeEnabled();
  await pendingControls.first().click();
  await pendingControls.last().click();
  await settings.getByRole("button", { name: "Apply home currency, future estimates, and amounts used in every plan" }).click();
  await expect(settings).toBeHidden();
  await expectNoRootOverflow(320);

  await page.setViewportSize({ width: 650, height: 900 });
  await expectNoRootOverflow(650);
  const cadCard = page.locator(".scenario-card").filter({
    has: page.getByRole("heading", { name: "Fictional CAD option", exact: true }),
  });
  await cadCard.getByRole("button", { name: "Edit this place, job, or plan" }).click();
  const editor = page.getByRole("dialog", { name: "Edit this place, job, or plan" });
  await expect(editor.getByLabel("Monthly gross income before tax and deductions in CAD", { exact: true })).toBeVisible();
  await expect(editor.getByLabel("Monthly gross income before tax and deductions in USD", { exact: true })).toBeVisible();
  await expect(editor.getByRole("button", { name: "Save changes to this place, job, or plan" })).toBeEnabled();
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expectNoRootOverflow(650);
});

test("fractional savings stay visibly balanced in local and comparison currencies", async ({ page }) => {
  const fixture = JSON.parse(
    readFileSync(new URL("../../examples/wayfinder.example.json", import.meta.url), "utf8"),
  ) as {
    sharedValues: Record<string, number>;
    scenarios: Array<{
      label: string;
      grossMonthly: number;
      values: Record<string, number>;
    }>;
  };
  for (const fieldId of Object.keys(fixture.sharedValues)) fixture.sharedValues[fieldId] = 0;
  const fractional = fixture.scenarios[1];
  fractional.grossMonthly = 1;
  for (const fieldId of Object.keys(fractional.values)) fractional.values[fieldId] = 0;
  fractional.values["automatic-retirement"] = 0.5;
  await loadFictionalExample(page, fixture as unknown as Record<string, unknown>);
  await page.goto("/");

  const card = page.locator(".scenario-card").filter({
    has: page.getByRole("heading", { name: fractional.label, exact: true }),
  });
  const total = card.locator(".saving-parent-head .money-value");
  const investments = card.locator(".saving-children > div").nth(0).locator(".money-value");
  const cash = card.locator(".saving-children > div").nth(1).locator(".money-value");

  await expect(total.locator("strong")).toHaveText("USD 0.73");
  await expect(investments.locator("strong")).toHaveText("USD 0.37");
  await expect(cash.locator("strong")).toHaveText("USD 0.36");
  await expect(total.locator("small")).toHaveText("CAD 1");
  await expect(investments.locator("small")).toHaveText("CAD 0.5");
  await expect(cash.locator("small")).toHaveText("CAD 0.5");

  await page.getByRole("button", { name: "Each plan’s own currency" }).click();
  await expect(total.locator("strong")).toHaveText("CAD 1");
  await expect(investments.locator("strong")).toHaveText("CAD 0.5");
  await expect(cash.locator("strong")).toHaveText("CAD 0.5");
  await expect(total.locator("small")).toHaveText("USD 0.73");
  await expect(investments.locator("small")).toHaveText("USD 0.37");
  await expect(cash.locator("small")).toHaveText("USD 0.36");

  const split = page.locator(".saving-split-row").filter({ hasText: fractional.label });
  await expect(split).toContainText("USD 0.73 saved or left each month");
  await expect(split).toContainText("Monthly investments USD 0.37");
  await expect(split).toContainText("Cash left USD 0.36");

  const ledger = page.locator(".ledger-table");
  for (const [label, local, base] of [
    ["Total saved or left each month", "CAD 1", "USD 0.73"],
    ["↳ Monthly investments", "CAD 0.5", "USD 0.37"],
    ["↳ Cash left each month", "CAD 0.5", "USD 0.36"],
  ] as const) {
    const row = ledger.getByRole("row").filter({ has: page.getByRole("rowheader", { name: label, exact: true }) });
    const value = row.getByRole("cell").last().locator(".money-value");
    await expect(value.locator("strong")).toHaveText(local);
    await expect(value.locator("small")).toHaveText(base);
  }

  await card.getByRole("button", { name: "Edit this place, job, or plan" }).click();
  const editor = page.getByRole("dialog", { name: "Edit this place, job, or plan" });
  const preview = editor.locator(".editor-preview .preview-parent");
  await expect(preview.locator("strong")).toHaveText("CAD 1");
  await expect(preview.locator("small").nth(0)).toHaveText("USD 0.73");
  await expect(preview.locator("small").nth(1)).toContainText("Monthly investments CAD 0.5 / USD 0.37 + cash left CAD 0.5 / USD 0.36");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("runtime keyboard dialog behavior restores focus and native editor disclosures reveal invalid fields", async ({ page }) => {
  await loadFictionalExample(page);
  await page.goto("/");

  const opener = page.locator(".topbar-actions").getByRole("button", { name: "Download or import", exact: true });
  await opener.focus();
  await expect(opener).toBeFocused();
  expect(await opener.evaluate((element) => {
    const styles = window.getComputedStyle(element);
    return { outlineStyle: styles.outlineStyle, outlineWidth: styles.outlineWidth };
  })).toEqual({ outlineStyle: "solid", outlineWidth: "2px" });
  await page.keyboard.press("Enter");

  const downloadDialog = page.getByRole("dialog", { name: "Download or import a comparison file" });
  const firstDialogControl = downloadDialog.getByRole("button", { name: "Close download and import options" });
  const lastDialogControl = downloadDialog.getByRole("button", { name: "Download empty comparison file" });
  await expect(downloadDialog).toBeVisible();
  await expect(firstDialogControl).toBeFocused();
  await lastDialogControl.focus();
  await page.keyboard.press("Tab");
  await expect(firstDialogControl).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(lastDialogControl).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(downloadDialog).toBeHidden();
  await expect(opener).toBeFocused();

  const baseCard = page.locator(".scenario-card").filter({
    has: page.getByRole("heading", { name: "Fictional base city", exact: true }),
  });
  await baseCard.getByRole("button", { name: "Edit this place, job, or plan" }).click();
  const editor = page.getByRole("dialog", { name: "Edit your current job and home-country household position" });
  const livingCosts = editor.locator("details.editor-section").first();
  const livingSummary = livingCosts.locator(":scope > summary");
  await expect(livingCosts).not.toHaveAttribute("open");
  await livingSummary.focus();
  await page.keyboard.press("Space");
  await expect(livingCosts).toHaveAttribute("open", "");
  await page.keyboard.press("Space");
  await expect(livingCosts).not.toHaveAttribute("open");

  await page.keyboard.press("Space");
  const housing = editor.getByLabel("Housing in USD", { exact: true });
  await housing.fill("");
  await livingSummary.focus();
  await page.keyboard.press("Space");
  await expect(livingCosts).not.toHaveAttribute("open");
  await editor.getByRole("button", { name: "Save changes to your current job and home-country household position" }).click();
  await expect(livingCosts).toHaveAttribute("open", "");
  await expect(editor.getByRole("alert")).toContainText("needs attention. The relevant section has been opened.");
  await expect(housing).toBeFocused();
});

test("fictional research stays contained at 320px, desktop comparison stays two-column, and reduced motion is computed", async ({ page }) => {
  const fixture = JSON.parse(readFileSync(new URL("../../examples/wayfinder.example.json", import.meta.url), "utf8")) as {
    researchItems: Array<{ finding: string }>;
  };
  const unbrokenResearch = `FictionalResearch${"x".repeat(600)}`;
  fixture.researchItems[0].finding = unbrokenResearch;
  await loadFictionalExample(page, fixture as unknown as Record<string, unknown>);

  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/");
  const researchFinding = page.getByText(unbrokenResearch, { exact: true });
  await expect(researchFinding).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect(await researchFinding.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBeTruthy();

  await page.setViewportSize({ width: 1440, height: 900 });
  const comparison = page.locator(".comparison-layout");
  await expect(comparison).toBeVisible();
  expect(await comparison.evaluate((element) => window.getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(2);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

  await page.emulateMedia({ reducedMotion: "reduce" });
  const motion = await page.locator(".topbar-actions button").first().evaluate((element) => {
    const styles = window.getComputedStyle(element);
    return { animationDuration: styles.animationDuration, transitionDuration: styles.transitionDuration };
  });
  expect(Number.parseFloat(motion.animationDuration)).toBeLessThanOrEqual(0.01);
  expect(Number.parseFloat(motion.transitionDuration)).toBeLessThanOrEqual(0.01);
});
