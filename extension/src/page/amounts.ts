/**
 * Rupee amounts in page text: ₹, Rs, Rs. and INR, with Indian grouping
 * ("₹1,00,000") or western grouping, and an optional "/month" or "/year" style suffix.
 */
const NUMBER = String.raw`(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?`;
const CURRENCY = String.raw`(?:₹|\bRs\.?|\bINR)\s?`;
const PER = String.raw`(?:\s?(?:\/\s?|per\s|a\s)(month|mo|year|yr|annum)\b|\s?(p\.\s?[ma])\.?)?`;

export type AmountPeriod = 'month' | 'year';

export interface AmountMatch {
  /** As shown, including a period suffix: "₹5,900/month". */
  text: string;
  inr: number;
  index: number;
  period: AmountPeriod | null;
}

function periodOf(word: string | undefined, short: string | undefined): AmountPeriod | null {
  const value = (word ?? short ?? '').toLowerCase().replace(/[\s.]/g, '');
  if (!value) return null;
  return value === 'month' || value === 'mo' || value === 'pm' ? 'month' : 'year';
}

export function findAmounts(text: string): AmountMatch[] {
  const re = new RegExp(CURRENCY + NUMBER + PER, 'gi');
  const found: AmountMatch[] = [];
  for (const match of text.matchAll(re)) {
    const whole = match[1]?.replace(/,/g, '') ?? '';
    const fraction = match[2] ? Number(`0.${match[2]}`) : 0;
    found.push({
      text: match[0].trim(),
      inr: Number(whole) + fraction,
      index: match.index,
      period: periodOf(match[3], match[4]),
    });
  }
  return found;
}

/** The first amount in a label ("QuickCred Shield ₹1,299/year" → 1299), or null. */
export function parseInr(text: string): number | null {
  return findAmounts(text)[0]?.inr ?? null;
}
