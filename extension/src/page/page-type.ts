/**
 * The client's page type hint (including rule 3b). The same rules as the
 * backend's `rule_page_type`, which makes the final call.
 */
import type { PageType } from '../core/api';
import type { Snapshot } from './reader';

const CHECKOUT_RE = /\b(checkout|cart|payment|review & pay|order summary)\b/;
const TERMS_RE = /\b(terms|conditions|agreement|terms of service)\b/;
const PRIVACY_RE = /\b(privacy|data policy)\b/;
const OFFER_RE = /\b(emi|per month|p\.m\.|loan|offer)/i;
const NUMBERED_HEADING_RE = /^\s*\d+(\.\d+)*[.)]?\s+\S/;

function urlText(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host} ${parsed.pathname}`.toLowerCase().replace(/[-_]/g, ' ');
  } catch {
    return '';
  }
}

export function pageTypeHint(snapshot: Snapshot): PageType {
  const url = urlText(snapshot.url);
  const title = snapshot.title.toLowerCase();
  const headings = snapshot.sections.map((s) => (s.heading ?? '').toLowerCase()).join(' ');
  if ((CHECKOUT_RE.test(url) || CHECKOUT_RE.test(headings)) && snapshot.prices.length >= 2) {
    return 'checkout';
  }
  if (TERMS_RE.test(url) || TERMS_RE.test(title)) return 'terms';
  if (PRIVACY_RE.test(url) || PRIVACY_RE.test(title)) return 'privacy';
  const numbered = snapshot.sections.filter(
    (s) => s.heading !== null && NUMBERED_HEADING_RE.test(s.heading),
  ).length;
  if (numbered >= 5) return 'terms';
  if (snapshot.fields.length >= 4) return 'form';
  if (snapshot.prices.length > 0) {
    const text = [
      snapshot.title,
      ...snapshot.sections.map((s) => s.text),
      ...snapshot.checkboxes.map((c) => c.label),
      ...snapshot.prices.map((p) => p.label ?? ''),
    ].join(' ');
    if (OFFER_RE.test(text)) return 'offer';
  }
  if (snapshot.sections.filter((s) => s.text.length > 400).length >= 3) return 'article';
  return 'other';
}
