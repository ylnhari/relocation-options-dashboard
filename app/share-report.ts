import { deriveScenario, type BreakdownItem, type DerivedScenario } from "./scenario-math.ts";
import type { InputEvidence, ResearchItem, WayfinderDocument } from "./scenarios.ts";
import {
  balanceSavingsDisplay,
  displayCurrency,
  formatMoney,
} from "./money-display.ts";

type EvidenceEntry = Pick<InputEvidence, "status" | "asOf" | "source" | "note">;

const FALLBACK_COLOR = "#7cb8ff";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : FALLBACK_COLOR;
}

function finite(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function displayLocale(locale: string) {
  try {
    new Intl.NumberFormat(locale);
    return locale;
  } catch {
    return "en-US";
  }
}

function money(value: number, currency: string, locale: string) {
  return escapeHtml(formatMoney(finite(value), currency, locale));
}

function moneyPair(
  localAmount: number,
  baseAmount: number,
  scenario: DerivedScenario,
  document: WayfinderDocument,
) {
  const local = money(localAmount, scenario.currency, document.locale);
  const base = money(baseAmount, document.baseCurrency, document.locale);
  return `${local}<small>${base} in the comparison currency</small>`;
}

function baseMoney(value: number, document: WayfinderDocument) {
  return money(value, document.baseCurrency, document.locale);
}

function evidenceLabel(entry: EvidenceEntry | undefined) {
  const status = entry?.status ?? "unknown";
  const source = entry?.source?.trim() || "No source recorded";
  const asOf = entry?.asOf?.trim() || "Date not recorded";
  const note = entry?.note?.trim();
  return `<span class="evidence-status evidence-${escapeHtml(status)}">${escapeHtml(status)}</span><span>${escapeHtml(source)}</span><span>${escapeHtml(asOf)}</span>${note ? `<span>${escapeHtml(note)}</span>` : ""}`;
}

function evidenceFor(
  document: WayfinderDocument,
  scenario: DerivedScenario,
  item: BreakdownItem | "gross",
) {
  if (item === "gross") return scenario.evidence.grossMonthly;
  return item.scope === "shared"
    ? document.sharedEvidence[item.id]
    : scenario.evidence[item.id];
}

function breakdownRows(
  document: WayfinderDocument,
  scenario: DerivedScenario,
  title: string,
  items: BreakdownItem[],
) {
  if (!items.length) return "";
  return `<section class="breakdown"><h4>${escapeHtml(title)}</h4><div class="line-items">${items
    .map((item) => {
      const shared = item.scope === "shared" ? '<span class="shared">Same amount in every plan</span>' : "";
      return `<div class="line-item"><div><b>${escapeHtml(item.label)}</b>${shared}<p>${escapeHtml(item.description)}</p></div><div class="amount">${moneyPair(item.localAmount, item.baseAmount, scenario, document)}</div><div class="evidence">${evidenceLabel(evidenceFor(document, scenario, item))}</div></div>`;
    })
    .join("")}</div></section>`;
}

function assumptionRows(scenario: DerivedScenario) {
  const rows: Array<[string, string]> = [
    ["Employment income", scenario.employment],
    ["Household earners", `${scenario.earners} ${scenario.earners === 1 ? "earner" : "earners"}`],
    ["Spouse income", scenario.spouseJob],
    ["Childcare", scenario.childcare],
    ["Transport", scenario.transport],
    ["Residence / visa", scenario.residency],
    ["Bonus treatment", scenario.bonus],
    ["Benefits and terms", scenario.benefits.join("; ") || "None listed"],
    ["Important uncertainties", scenario.risks.join("; ") || "None listed"],
  ];
  return rows
    .map(([label, value]) => `<div><b>${escapeHtml(label)}</b><span>${escapeHtml(value)}</span></div>`)
    .join("");
}

function scenarioCard(
  document: WayfinderDocument,
  scenario: DerivedScenario,
  isCurrentPosition: boolean,
) {
  const color = safeColor(scenario.color);
  const savingRate = finite(scenario.savingRate);
  const fxRate = finite(scenario.fx.rateToBase);
  const localInvestments = fxRate > 0 ? scenario.totalInvestmentBase / fxRate : 0;
  const displayedSavings = {
    local: balanceSavingsDisplay(
      scenario.totalSavingMonthly,
      localInvestments,
      scenario.currency,
    ),
    base: balanceSavingsDisplay(
      scenario.totalSavingBase,
      scenario.totalInvestmentBase,
      document.baseCurrency,
    ),
  };
  const positionLabel = isCurrentPosition
    ? "Current job and home-country position"
    : "Possible job, move, or household plan";
  return `<article class="scenario" style="--accent:${color}">
    <div class="scenario-top"><span class="status">${escapeHtml(positionLabel)}</span><span class="rate">${escapeHtml(scenario.status)}</span><span class="rate">${savingRate.toFixed(1)}% of income saved</span></div>
    <h2>${escapeHtml(scenario.label)}</h2>
    <p class="location">${escapeHtml(scenario.location)}</p>
    <p class="employment">${escapeHtml(scenario.employment)}</p>
    <section class="summary" aria-label="Monthly summary">
      <div><span>Monthly income before tax and deductions</span><strong>${moneyPair(scenario.grossMonthly, scenario.grossBase, scenario, document)}</strong><div class="evidence">${evidenceLabel(evidenceFor(document, scenario, "gross"))}</div></div>
      <div><span>Tax and other deductions</span><strong>${moneyPair(scenario.deductionMonthly, scenario.deductionBase, scenario, document)}</strong></div>
      <div><span>Take-home cash after deductions and automatic savings</span><strong>${moneyPair(scenario.netCashMonthly, scenario.netCashBase, scenario, document)}</strong></div>
      <div><span>Monthly household costs</span><strong>${moneyPair(scenario.livingMonthly, scenario.livingBase, scenario, document)}</strong></div>
      <div><span>Loan payments, money sent home, and other obligations outside this household plan</span><strong>${moneyPair(scenario.optionCommitmentMonthly + (fxRate > 0 ? scenario.sharedCommitmentBase / fxRate : 0), scenario.commitmentBase, scenario, document)}</strong></div>
      <div class="total-saving"><span>Total saved or left each month</span><strong>${moneyPair(displayedSavings.local.total, displayedSavings.base.total, scenario, document)}</strong><p>This is made up of monthly investments and cash left after costs and planned investments. Cash shown is the balancing remainder after currency rounding; calculations retain full precision.</p><div class="children"><div><span>Monthly investments</span><strong>${moneyPair(displayedSavings.local.investments, displayedSavings.base.investments, scenario, document)}</strong><small>Automatic payroll savings plus planned investments</small></div><div><span>Cash left after costs and planned investments</span><strong>${moneyPair(displayedSavings.local.cash, displayedSavings.base.cash, scenario, document)}</strong><small>May be negative if costs and investments exceed take-home cash</small></div></div></div>
    </section>
    <section class="metadata"><h3>Currency conversion and sources</h3><div><b>Conversion ratio</b><span>1 ${escapeHtml(displayCurrency(scenario.currency))} = ${escapeHtml(String(fxRate))} ${escapeHtml(displayCurrency(document.baseCurrency))}</span></div>${scenario.currency === document.baseCurrency ? `<div><b>Home/comparison currency</b><span>No conversion needed; this plan already uses the currency chosen to compare every plan.${scenario.fx.source ? ` ${escapeHtml(scenario.fx.source)}.` : ""}${scenario.fx.asOf ? ` Reference date: ${escapeHtml(scenario.fx.asOf)}.` : ""}</span></div>` : `<div><b>Conversion date</b><span>${escapeHtml(scenario.fx.asOf || "Date not recorded")}</span></div><div><b>Conversion source</b><span>${escapeHtml(scenario.fx.source || "No source recorded")}</span></div>`}</section>
    <details class="scenario-details">
      <summary>Monthly amounts, sources, and what each amount means</summary>
      <div class="scenario-details-body"><p>The first amount is in this plan’s local currency. The smaller amount below is in ${escapeHtml(displayCurrency(document.baseCurrency))}, the home/comparison currency chosen to compare every plan. <span class="shared">Same amount in every plan</span> means the recorded ${escapeHtml(displayCurrency(document.baseCurrency))} amount is used for every plan.</p>
        ${breakdownRows(document, scenario, "Tax and other deductions", scenario.breakdown.deduction)}
        ${breakdownRows(document, scenario, "Automatic savings taken from pay", scenario.breakdown.automaticInvestment)}
        ${breakdownRows(document, scenario, "Monthly household costs", scenario.breakdown.livingCost)}
        ${breakdownRows(document, scenario, "Loan payments, money sent home, and other obligations outside this household plan", scenario.breakdown.commitment)}
        ${breakdownRows(document, scenario, "Monthly investments you plan to keep making", scenario.breakdown.plannedInvestment)}
      </div>
    </details>
    <details class="scenario-details scenario-assumptions">
      <summary>Important non-financial details</summary>
      <div class="scenario-details-body">${assumptionRows(scenario)}</div>
    </details>
  </article>`;
}

function excludedSupport(document: WayfinderDocument) {
  const items = document.excludedSupport;
  return `<section class="excluded"><h2>Possible family help (shown separately; not included in calculations)</h2><p>This support is shown for context only. It is not added to income or subtracted from costs, and does not change saving, charts, future estimates, or rankings.</p>${items.length ? `<div class="excluded-list">${items.map((item) => `<div><b>${escapeHtml(item.label)}</b><strong>${baseMoney(item.monthlyBase, document)} / month</strong><span>${escapeHtml(item.note || "No note recorded")}</span></div>`).join("")}</div>` : "<p>No possible family help recorded.</p>"}</section>`;
}

function projectionAssumptions(document: WayfinderDocument) {
  const assumptions = document.projectionAssumptions;
  return `<section class="projection"><h2>Future-estimate assumptions</h2><p>These estimates are used only for the future chart. They do not change the monthly figures above.</p><dl><div><dt>Expected yearly income growth</dt><dd>${escapeHtml(String(finite(assumptions.incomeGrowthPct)))}% each year</dd></div><div><dt>Expected yearly cost increase</dt><dd>${escapeHtml(String(finite(assumptions.expenseInflationPct)))}% each year</dd></div><div><dt>Years shown in the estimate</dt><dd>${escapeHtml(String(finite(assumptions.years)))} years</dd></div></dl></section>`;
}

function safeHttpsUrl(value: string) {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" && parsed.hostname ? parsed.href : null;
  } catch {
    return null;
  }
}

function scenarioApplicability(document: WayfinderDocument, item: ResearchItem) {
  if (!item.appliesToScenarioIds.length) return "All saved plans";
  const labels = item.appliesToScenarioIds
    .map((id) => document.scenarios.find((scenario) => scenario.id === id)?.label)
    .filter((label): label is string => Boolean(label));
  return labels.length ? labels.join("; ") : "Selected saved plans";
}

function researchSource(item: ResearchItem) {
  const title = item.sourceTitle.trim() || "Source title not recorded";
  const url = safeHttpsUrl(item.sourceUrl);
  if (url) {
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>`;
  }
  const unlinkedUrl = item.sourceUrl.trim();
  return `${escapeHtml(title)}${unlinkedUrl ? `<span class="source-url">${escapeHtml(unlinkedUrl)}</span>` : ""}`;
}

function researchSection(document: WayfinderDocument) {
  const items = document.researchItems ?? [];
  return `<section class="research"><h2>Research and sources</h2><p>Research is included for context. Links, when present, open only if selected; this file does not retrieve updates automatically.</p>${items.length ? `<div class="research-list">${items.map((item) => `<article class="research-item"><div class="research-heading"><span class="topic">${escapeHtml(item.topic)}</span><span class="research-status">${escapeHtml(item.status)}</span></div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.finding)}</p><dl><div><dt>Applies to</dt><dd>${escapeHtml(scenarioApplicability(document, item))}</dd></div><div><dt>Publisher</dt><dd>${escapeHtml(item.publisher || "Not recorded")}</dd></div><div><dt>Source</dt><dd>${researchSource(item)}</dd></div><div><dt>As of</dt><dd>${escapeHtml(item.asOf || "Date not recorded")}</dd></div>${item.note ? `<div><dt>Note</dt><dd>${escapeHtml(item.note)}</dd></div>` : ""}</dl></article>`).join("")}</div>` : "<p>No research items recorded.</p>"}</section>`;
}

export function createFamilyShareHtml(
  document: WayfinderDocument,
  generatedAt: Date = new Date(),
) {
  const derived = document.scenarios.map((scenario) => deriveScenario(document, scenario));
  const locale = displayLocale(document.locale);
  const dateLabel = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(generatedAt);

  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; media-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'">
  <title>${escapeHtml(document.title || "Wayfinder family view")}</title>
  <style>
    :root{color-scheme:dark;--bg:#07131f;--panel:#102438;--text:#eef6ff;--muted:#9bb0c4;--line:#294157;--good:#68dccf}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 15% 0,#143249 0,transparent 32%),var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.5}main{width:min(1180px,calc(100% - 32px));margin:auto;padding:54px 0 80px}header{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:end;border-bottom:1px solid var(--line);padding-bottom:28px;margin-bottom:26px}.eyebrow,.status,.rate{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--good)}.eyebrow{display:block;margin-bottom:10px}h1{font-size:clamp(38px,7vw,72px);letter-spacing:-.055em;line-height:.95;margin:0}header p{max-width:580px;color:var(--muted);margin:12px 0 0}.stamp{text-align:right;color:var(--muted);font-size:12px}.privacy,.excluded,.projection,.research{border:1px solid #3c5a72;background:#10263a;padding:18px;border-radius:16px;color:#c4d4e2;margin:0 0 28px;font-size:13px}.privacy{margin-bottom:28px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.scenario{--accent:#7cb8ff;position:relative;overflow:hidden;border:1px solid var(--line);border-top-color:var(--accent);border-radius:24px;background:linear-gradient(150deg,#142d43,#0a1c2b);padding:25px}.scenario:before{content:"";position:absolute;inset:0 0 auto;height:3px;background:linear-gradient(90deg,transparent,var(--accent),transparent)}.scenario-top{display:flex;justify-content:space-between;gap:12px}.status,.rate{border:1px solid var(--accent);border-radius:99px;padding:5px 8px}.rate{color:var(--muted);border-color:var(--line)}h2{font-size:30px;letter-spacing:-.04em;margin:20px 0 3px}h3{font-size:16px;margin:28px 0 10px}.location,.employment{color:var(--muted);margin:0}.employment{margin-top:10px}.summary{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:22px}.summary>div{border:1px solid var(--line);border-radius:12px;padding:13px}.summary span,.line-item p,.details>p,.total-saving p,.excluded p,.projection p,.research>p,.research-item>p{color:var(--muted);font-size:11px}.summary>div>span{display:block}.summary strong{display:block;font-size:17px;margin-top:4px}.summary small{display:block;color:var(--muted);font-size:10px;font-weight:400;margin-top:3px}.summary .total-saving{grid-column:1/-1;border-color:var(--accent);background:#0d2639}.total-saving p{margin:5px 0 0}.children{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.children div{border-top:1px solid var(--line);padding-top:10px}.metadata,.assumptions{display:grid;gap:8px}.metadata h3,.assumptions h3{grid-column:1/-1}.metadata div,.assumptions div{display:grid;grid-template-columns:145px 1fr;gap:12px;font-size:11px}.metadata b,.assumptions b{color:#c9d8e6}.metadata span,.assumptions span{color:var(--muted)}.details{margin-top:26px}.details>p{margin-top:0}.breakdown{border-top:1px solid var(--line);padding-top:14px;margin-top:14px}.breakdown h4{margin:0 0 8px;font-size:13px}.line-items{display:grid;gap:8px}.line-item{display:grid;grid-template-columns:minmax(150px,1fr) minmax(125px,.55fr) minmax(150px,.8fr);gap:12px;border:1px solid var(--line);border-radius:10px;padding:10px;font-size:11px}.line-item p{margin:3px 0 0}.amount{text-align:right;font-weight:700}.amount small{display:block;font-size:10px;color:var(--muted);font-weight:400;margin-top:3px}.shared{display:inline-block;background:#1f5665;color:#d9fcf7;border-radius:99px;padding:1px 6px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-left:6px}.evidence{display:flex;flex-wrap:wrap;gap:4px 7px;align-content:start;color:var(--muted);font-size:10px}.evidence-status{border-radius:99px;padding:1px 5px;background:#273f55;color:#dce9f3;text-transform:capitalize}.evidence-confirmed{background:#205d55;color:#d8fff6}.evidence-estimate{background:#66511d;color:#fff0bd}.evidence-unknown{background:#4a3b55;color:#f1dcff}.excluded h2,.projection h2,.research h2{margin:0 0 8px;font-size:20px}.excluded-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}.excluded-list div{display:grid;gap:3px;border-top:1px solid #3c5a72;padding-top:10px}.excluded-list strong{font-size:13px}.excluded-list span{font-size:11px;color:var(--muted)}.projection dl{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:14px 0 0}.projection dl div{border-top:1px solid #3c5a72;padding-top:9px}.projection dt,.research-item dt{font-size:11px;color:var(--muted)}.projection dd,.research-item dd{margin:3px 0 0;font-weight:700;font-size:13px}.research-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-top:14px}.research-item{border:1px solid #3c5a72;border-radius:12px;padding:14px}.research-heading{display:flex;justify-content:space-between;gap:8px}.topic,.research-status{font-size:10px;text-transform:uppercase;letter-spacing:.06em;border:1px solid #3c5a72;border-radius:99px;padding:3px 6px;color:#c9d8e6}.research-status{color:#d8fff6}.research-item h3{margin:12px 0 4px}.research-item>p{margin:0}.research-item dl{display:grid;gap:8px;margin:14px 0 0}.research-item dl div{border-top:1px solid #294157;padding-top:7px}.research-item a{color:#8ee6dc;overflow-wrap:anywhere}.source-url{display:block;color:var(--muted);font-size:11px;overflow-wrap:anywhere}footer{color:var(--muted);font-size:11px;border-top:1px solid var(--line);margin-top:34px;padding-top:20px}@media(max-width:820px){.grid{grid-template-columns:1fr}.line-item{grid-template-columns:1fr 1fr}.line-item .evidence{grid-column:1/-1}.projection dl{grid-template-columns:1fr 1fr}}@media(max-width:560px){main{width:min(100% - 20px,620px);padding-top:32px}header{grid-template-columns:1fr}.stamp{text-align:left}.scenario{padding:18px}.summary,.children{grid-template-columns:1fr}.metadata div,.assumptions div,.line-item{grid-template-columns:1fr}.amount{text-align:left}.projection dl{grid-template-columns:1fr}}
  </style>
  <style>
    .scenario-details{margin-top:18px;border:1px solid var(--line);border-radius:12px;background:#0d2639}.scenario-details>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;padding:13px;color:#c9d8e6;font-size:13px;font-weight:700}.scenario-details>summary::after{content:"+";color:var(--good);font-size:18px}.scenario-details[open]>summary::after{content:"−"}.scenario-details-body{border-top:1px solid var(--line);padding:0 13px 13px}.scenario-details-body>p{color:var(--muted);font-size:11px}.scenario-details .breakdown{margin-top:14px}.scenario-details.scenario-assumptions .scenario-details-body{display:grid;gap:8px;padding-top:13px}.scenario-details.scenario-assumptions .scenario-details-body>div{display:grid;grid-template-columns:145px minmax(0,1fr);gap:12px;font-size:11px}.scenario-details.scenario-assumptions b{color:#c9d8e6}.scenario-details.scenario-assumptions span{color:var(--muted)}@media(max-width:560px){.scenario-details.scenario-assumptions .scenario-details-body>div{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <main>
    <header><div><span class="eyebrow">Wayfinder · family report (read-only)</span><h1>${escapeHtml(document.title || "Relocation plans")}</h1><p>Each plan shows its local currency first and ${escapeHtml(displayCurrency(document.baseCurrency))} underneath. ${escapeHtml(displayCurrency(document.baseCurrency))} is the home/comparison currency chosen to compare every plan on the same basis.</p></div><div class="stamp">Created ${escapeHtml(dateLabel)}<br>${derived.length} ${derived.length === 1 ? "plan" : "plans"} compared</div></header>
    <p class="privacy"><strong>Read-only financial summary:</strong> this file has no controls or active content. Keep it only with people you trust.</p>
    <section class="grid">${derived.map((scenario) => scenarioCard(document, scenario, scenario.id === document.currentScenarioId)).join("")}</section>
    ${excludedSupport(document)}
    ${researchSection(document)}
    ${projectionAssumptions(document)}
    <footer>All monthly calculations come from the saved plan details. Investments count as savings, not household spending. Currency conversions use the recorded rate for each plan.</footer>
  </main>
</body>
</html>`;
}
