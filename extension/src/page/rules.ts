/**
 * The deterministic client checks. They run in the page with
 * no network calls, so chips and the toolbar badge work before Iris is opened.
 */
import type { PageSnapshot } from '../core/api';
import { findAmounts, type AmountPeriod } from './amounts';
import { normaliseWs, textOf } from './labels';
import type { PriceMeta, Snapshot } from './reader';

export type ClientFlag = PageSnapshot['client_flags'][number];

export interface RuleInput {
  snapshot: Snapshot;
  prices: Map<string, PriceMeta>;
  /** IDs of elements confirmed as running countdowns. */
  countdownIds: string[];
}

const MARKETING_RE = /offers?\b|partners?\b|marketing|whatsapp|\bsms\b|promotion/i;
const TOTAL_RE = /total|subtotal|\bdue\b|payable|amount to pay/i;
const THEN = String.raw`.{0,40}?\b(?:then|after that|after which|thereafter)\b[\s,:]*`;
const MONEY = String.raw`(?:₹|Rs\.?\s?|INR\s?)(\d[\d,]*(?:\.\d+)?)`;
const PERIOD = String.raw`\s*(?:\/|per|a|every)?\s*(month|mo|year|yr|annum)?`;
const TRIAL_RES = [
  new RegExp(
    String.raw`free\s+(?:for\s+)?(?:the\s+first\s+)?(\d{1,3})\s*(day|month)s?\b` +
      THEN +
      MONEY +
      PERIOD,
    'i',
  ),
  new RegExp(String.raw`(\d{1,3})[-\s]?(day|month)s?\s+free\s+trial` + THEN + MONEY + PERIOD, 'i'),
];
const PER_MONTH = String.raw`(?:p\.?\s?m\.?|per\s+month|a\s+month|monthly)`;
const PER_YEAR = String.raw`(?:p\.?\s?a\.?|per\s+annum|per\s+year|a\s+year|yearly)`;
const FLAT_RES: {
  re: RegExp;
  basis: (unit: string | undefined) => 'flat_monthly' | 'flat_annual';
}[] = [
  {
    re: new RegExp(String.raw`(\d+(?:\.\d+)?)\s*%\s*(${PER_MONTH})\s*,?\s*flat\b`, 'i'),
    basis: () => 'flat_monthly',
  },
  {
    re: new RegExp(
      String.raw`\bflat\s+(?:rate\s+of\s+|interest\s+(?:rate\s+)?(?:of\s+)?)?(\d+(?:\.\d+)?)\s*%\s*(${PER_MONTH}|${PER_YEAR})?`,
      'i',
    ),
    basis: (unit) =>
      unit && new RegExp(PER_MONTH, 'i').test(unit) ? 'flat_monthly' : 'flat_annual',
  },
  {
    re: new RegExp(String.raw`(\d+(?:\.\d+)?)\s*%\s*(${PER_YEAR})?\s*,?\s*flat\b`, 'i'),
    basis: () => 'flat_annual',
  },
];
// The number must stand alone: "₹59,999 Monthly instalment" isn't a 999-month tenure.
const TENURE_RE = /(?<![\d,.₹])\b(\d{1,3})\s*(?:monthly\s+)?(?:months?|instal+ments?|emis?)\b/gi;
const NOT_PRINCIPAL_RE = /fee|charge|gst|emi|instal|month|year/i;
const URGENCY_RE = /\b(ends?|left|hurry|expires?|remaining|only|last chance|closes?)\b/i;

function periodWord(word: string | undefined): 'month' | 'year' {
  return word && /^(year|yr|annum)$/i.test(word) ? 'year' : 'month';
}

function amountPeriod(text: string): AmountPeriod | 'once' {
  return findAmounts(text)[0]?.period ?? 'once';
}

function money(value: string): number {
  return Number(value.replace(/,/g, ''));
}

function quoted(label: string): string {
  const clean = normaliseWs(label);
  return `"${clean.length > 120 ? `${clean.slice(0, 119)}…` : clean}"`;
}

function trialParams(text: string): Record<string, number | string> | null {
  for (const re of TRIAL_RES) {
    const match = re.exec(text);
    if (!match) continue;
    const count = Number(match[1]);
    const days = match[2]?.toLowerCase() === 'month' ? count * 30 : count;
    return {
      trial_days: days,
      then_inr: money(match[3] ?? '0'),
      then_period: periodWord(match[4]),
    };
  }
  return null;
}

/** Tenure and principal written in the same section as a flat rate. */
function nearbyLoanFacts(
  sectionId: string,
  text: string,
  input: RuleInput,
): Record<string, number> {
  const facts: Record<string, number> = {};
  const tenures = new Set<number>();
  for (const match of text.matchAll(TENURE_RE)) {
    const before = text.slice(Math.max(0, match.index - 4), match.index);
    if (/(?:to|-|–)\s*$/.test(before)) continue;
    tenures.add(Number(match[1]));
  }
  if (tenures.size === 1) facts.tenure_months = [...tenures][0] ?? 0;
  let principal: number | null = null;
  for (const price of input.snapshot.prices) {
    const meta = input.prices.get(price.id);
    if (meta?.sectionId !== sectionId || meta.period !== null || price.amount_inr === null)
      continue;
    if (NOT_PRINCIPAL_RE.test(price.label ?? '') || /up to/i.test(meta.rowText)) continue;
    principal = Math.max(principal ?? 0, price.amount_inr);
  }
  if (principal !== null) facts.principal_inr = principal;
  return facts;
}

export function clientFlags(input: RuleInput): ClientFlag[] {
  const { snapshot } = input;
  const flags: ClientFlag[] = [];
  const flagged = new Set<string>();
  const add = (flag: ClientFlag) => {
    flags.push(flag);
    for (const id of flag.element_ids) flagged.add(id);
  };

  for (const choice of snapshot.checkboxes) {
    const params = trialParams(choice.label);
    if (!params) continue;
    add({
      rule: 'trial_to_paid',
      category: 'auto_renews',
      severity: choice.prechecked ? 'high' : 'medium',
      element_ids: [choice.id],
      detail: `${quoted(choice.label)} turns into a paid plan after the free trial.`,
      amount_inr: Number(params.then_inr),
      params,
    });
  }
  for (const price of snapshot.prices) {
    const row = input.prices.get(price.id)?.rowText ?? '';
    const params = trialParams(row);
    if (!params || flagged.has(price.id)) continue;
    add({
      rule: 'trial_to_paid',
      category: 'auto_renews',
      severity: 'medium',
      element_ids: [price.id],
      detail: `${quoted(row)} turns into a paid plan after the free trial.`,
      amount_inr: Number(params.then_inr),
      params,
    });
  }

  for (const choice of snapshot.checkboxes) {
    if (!choice.prechecked || flagged.has(choice.id)) continue;
    if (choice.amount_inr !== null) {
      add({
        rule: 'prechecked_paid_addon',
        category: 'costs_money',
        severity: 'high',
        element_ids: [choice.id],
        detail: `${quoted(choice.label)} was already ticked and costs money.`,
        amount_inr: choice.amount_inr,
        params: { period: amountPeriod(choice.label) },
      });
    } else if (MARKETING_RE.test(choice.label)) {
      add({
        rule: 'prechecked_marketing_consent',
        category: 'shares_data',
        severity: 'medium',
        element_ids: [choice.id],
        detail: `${quoted(choice.label)} was already ticked.`,
        amount_inr: null,
        params: {},
      });
    }
  }

  for (const price of snapshot.prices) {
    const meta = input.prices.get(price.id);
    if (!meta || price.first_seen_revision <= 1 || flagged.has(price.id)) continue;
    if (TOTAL_RE.test(price.label ?? '')) continue;
    const newLabel = meta.labelFirstRevision === price.first_seen_revision;
    const newAmount = meta.amountFirstRevision === price.first_seen_revision;
    if (!newLabel || !newAmount) continue;
    add({
      rule: 'late_price',
      category: 'costs_money',
      severity: 'high',
      element_ids: [price.id],
      detail: `${quoted(`${price.label ?? 'A charge'} ${price.amount_text}`)} appeared after the page first loaded.`,
      amount_inr: price.amount_inr,
      params: { revision: price.first_seen_revision },
    });
  }

  for (const section of snapshot.sections) {
    const found = FLAT_RES.map(({ re, basis }) => {
      const match = re.exec(section.text);
      return match ? { match, basis: basis(match[2]) } : null;
    }).find((hit) => hit !== null);
    if (!found) continue;
    const rate = Number(found.match[1]);
    add({
      rule: 'flat_rate_offer',
      category: 'costs_money',
      severity: 'medium',
      element_ids: [section.id],
      detail: `A flat rate of ${found.match[0].trim()} costs more than it sounds.`,
      amount_inr: null,
      params: {
        rate_percent: rate,
        rate_basis: found.basis,
        ...nearbyLoanFacts(section.id, section.text, input),
      },
    });
    break;
  }

  for (const id of input.countdownIds) {
    if (flagged.has(id)) continue;
    add({
      rule: 'countdown_timer',
      category: 'worth_knowing',
      severity: 'info',
      element_ids: [id],
      detail: 'A countdown timer is running on this page.',
      amount_inr: null,
      params: {},
    });
  }

  const banner = snapshot.cookie_banner;
  if (banner?.accept_button_id && !banner.reject_visible) {
    add({
      rule: 'hidden_cookie_reject',
      category: 'worth_knowing',
      severity: 'info',
      element_ids: [banner.id],
      detail: 'The cookie banner has an accept button but no visible reject option.',
      amount_inr: null,
      params: {},
    });
  }
  return flags;
}

/**
 * Countdown timers: a clock ("09:59") near words like "ends" or "left", whose text changes.
 * Each candidate is sampled twice, one second apart, and the answer is remembered.
 */
export class CountdownDetector {
  private ticking = new WeakSet<Element>();
  private still = new WeakSet<Element>();

  constructor(
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async running(candidates: Element[]): Promise<Element[]> {
    const near = candidates.filter((el) => {
      let node: Element | null = el;
      for (let depth = 0; node && depth < 3; depth += 1, node = node.parentElement) {
        const text = textOf(node);
        if (text.length > 300) return false;
        if (URGENCY_RE.test(text)) return true;
      }
      return false;
    });
    const unknown = near.filter((el) => !this.ticking.has(el) && !this.still.has(el));
    if (unknown.length > 0) {
      const before = unknown.map((el) => textOf(el));
      await this.sleep(1_000);
      unknown.forEach((el, index) => {
        (textOf(el) !== before[index] ? this.ticking : this.still).add(el);
      });
    }
    return near.filter((el) => el.isConnected && this.ticking.has(el));
  }

  reset(): void {
    this.ticking = new WeakSet();
    this.still = new WeakSet();
  }
}
