import { deriveScenario, type BreakdownItem, type DerivedScenario } from "./scenario-math.ts";
import type { InputEvidence, ResearchItem, WayfinderDocument } from "./scenarios.ts";

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

function displayCurrency(currency: string) {
  return /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : "XXX";
}

function money(value: number, currency: string, locale: string) {
  const amount = finite(value);
  const sign = amount < 0 ? "−" : "";
  const formatted = new Intl.NumberFormat(displayLocale(locale), {
    maximumFractionDigits: 0,
  }).format(Math.abs(amount));
  return `${sign}${escapeHtml(displayCurrency(currency))} ${escapeHtml(formatted)}`;
}

function moneyPair(value: number, scenario: DerivedScenario, document: WayfinderDocument) {
  const local = money(value, scenario.currency, document.locale);
  const base = money(value * finite(scenario.fx.rateToBase), document.baseCurrency, document.locale);
  return `${local}<small>${base} base equivalent</small>`;
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
      const shared = item.scope === "shared" ? '<span class="shared">Shared</span>' : "";
      return `<div class="line-item"><div><b>${escapeHtml(item.label)}</b>${shared}<p>${escapeHtml(item.description)}</p></div><div class="amount">${moneyPair(item.localAmount, scenario, document)}</div><div class="evidence">${evidenceLabel(evidenceFor(document, scenario, item))}</div></div>`;
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

function scenarioCard(document: WayfinderDocument, scenario: DerivedScenario) {
  const color = safeColor(scenario.color);
  const savingRate = finite(scenario.savingRate);
  const fxRate = finite(scenario.fx.rateToBase);
  return `<article class="scenario" style="--accent:${color}">
    <div class="scenario-top"><span class="status">${escapeHtml(scenario.status)}</span><span class="rate">${savingRate.toFixed(1)}% saving rate</span></div>
    <h2>${escapeHtml(scenario.label)}</h2>
    <p class="location">${escapeHtml(scenario.location)}</p>
    <p class="employment">${escapeHtml(scenario.employment)}</p>
    <section class="summary" aria-label="Monthly summary">
      <div><span>Gross monthly income</span><strong>${moneyPair(scenario.grossMonthly, scenario, document)}</strong><div class="evidence">${evidenceLabel(evidenceFor(document, scenario, "gross"))}</div></div>
      <div><span>Cash deductions</span><strong>${moneyPair(scenario.deductionMonthly, scenario, document)}</strong></div>
      <div><span>Net cash after deductions and automatic saving</span><strong>${moneyPair(scenario.netCashMonthly, scenario, document)}</strong></div>
      <div><span>Living costs</span><strong>${moneyPair(scenario.livingMonthly, scenario, document)}</strong></div>
      <div><span>Continuing commitments</span><strong>${moneyPair(scenario.optionCommitmentMonthly + (scenario.fx.rateToBase > 0 ? scenario.sharedCommitmentBase / scenario.fx.rateToBase : 0), scenario, document)}</strong></div>
      <div class="total-saving"><span>Total monthly saving</span><strong>${moneyPair(scenario.totalSavingMonthly, scenario, document)}</strong><p>Saving before planned investments; automatic retirement saving is included.</p><div class="children"><div><span>Total investments</span><strong>${baseMoney(scenario.totalInvestmentBase, document)}</strong><small>Automatic and planned investments</small></div><div><span>Cash remaining</span><strong>${baseMoney(scenario.cashRemainingBase, document)}</strong><small>After investments</small></div></div></div>
    </section>
    <section class="metadata"><h3>Currency and evidence</h3><div><b>Exchange rate</b><span>1 ${escapeHtml(displayCurrency(scenario.currency))} = ${escapeHtml(String(fxRate))} ${escapeHtml(displayCurrency(document.baseCurrency))}</span></div><div><b>Rate as of</b><span>${escapeHtml(scenario.fx.asOf || "Date not recorded")}</span></div><div><b>Rate source</b><span>${escapeHtml(scenario.fx.source || "No source recorded")}</span></div></section>
    <section class="details"><h3>Monthly line-item breakdown</h3><p>Amounts are shown in the option currency, with the base-currency equivalent underneath. <span class="shared">Shared</span> items use the same base-currency amount in every option.</p>
      ${breakdownRows(document, scenario, "Deductions", scenario.breakdown.deduction)}
      ${breakdownRows(document, scenario, "Automatic retirement saving", scenario.breakdown.automaticInvestment)}
      ${breakdownRows(document, scenario, "Living costs", scenario.breakdown.livingCost)}
      ${breakdownRows(document, scenario, "Continuing commitments", scenario.breakdown.commitment)}
      ${breakdownRows(document, scenario, "Planned investments", scenario.breakdown.plannedInvestment)}
    </section>
    <section class="assumptions"><h3>Scenario assumptions</h3>${assumptionRows(scenario)}</section>
  </article>`;
}

function excludedSupport(document: WayfinderDocument) {
  const items = document.excludedSupport;
  return `<section class="excluded"><h2>External help / family support — excluded</h2><p>These amounts are not counted in gross income, deductions, net cash, living costs, commitments, investments, or total saving.</p>${items.length ? `<div class="excluded-list">${items.map((item) => `<div><b>${escapeHtml(item.label)}</b><strong>${baseMoney(item.monthlyBase, document)} / month</strong><span>${escapeHtml(item.note || "No note recorded")}</span></div>`).join("")}</div>` : "<p>No excluded support recorded.</p>"}</section>`;
}

function projectionAssumptions(document: WayfinderDocument) {
  const assumptions = document.projectionAssumptions;
  return `<section class="projection"><h2>Projection assumptions</h2><p>These settings are used for future projections; they do not change the monthly figures above.</p><dl><div><dt>Income growth</dt><dd>${escapeHtml(String(finite(assumptions.incomeGrowthPct)))}% each year</dd></div><div><dt>Expense inflation</dt><dd>${escapeHtml(String(finite(assumptions.expenseInflationPct)))}% each year</dd></div><div><dt>Projection period</dt><dd>${escapeHtml(String(finite(assumptions.years)))} years</dd></div></dl></section>`;
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
  if (!item.appliesToScenarioIds.length) return "All saved options";
  const labels = item.appliesToScenarioIds
    .map((id) => document.scenarios.find((scenario) => scenario.id === id)?.label)
    .filter((label): label is string => Boolean(label));
  return labels.length ? labels.join("; ") : "Specific saved option";
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
</head>
<body>
  <main>
    <header><div><span class="eyebrow">Wayfinder · read-only family view</span><h1>${escapeHtml(document.title || "Relocation options")}</h1><p>A consistent comparison using the document’s base currency: ${escapeHtml(displayCurrency(document.baseCurrency))}.</p></div><div class="stamp">Created ${escapeHtml(dateLabel)}<br>${derived.length} saved ${derived.length === 1 ? "option" : "options"}</div></header>
    <p class="privacy"><strong>Read-only financial summary:</strong> this file has no controls or active content. Keep it only with people you trust.</p>
    <section class="grid">${derived.map((scenario) => scenarioCard(document, scenario)).join("")}</section>
    ${excludedSupport(document)}
    ${researchSection(document)}
    ${projectionAssumptions(document)}
    <footer>All monthly calculations are derived from the saved scenario inputs. Investments are savings, not expenses. Currency conversions use the rate recorded for each option.</footer>
  </main>
</body>
</html>`;
}
