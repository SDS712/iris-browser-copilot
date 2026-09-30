/**
 * What "Show on page" highlights for a card: the result's highlights,
 * the field for a field card, or one risk of a risk list, with its title and tag.
 */
import type { HighlightRequest } from '../adapters/page-adapter';
import type { ToolResult } from './api';

export function cardHighlight(result: ToolResult, riskIndex?: number): HighlightRequest | null {
  const card = result.card;
  if (card?.kind === 'risk_list' && riskIndex !== undefined) {
    const risk = card.risks[riskIndex];
    if (!risk) return null;
    const ids =
      risk.element_ids.length > 0 ? risk.element_ids : risk.section_id ? [risk.section_id] : [];
    if (ids.length === 0) return null;
    return {
      ids,
      quote_text: risk.element_ids.length > 0 ? null : risk.quote,
      level: 'risk',
      title: risk.title,
      risk: { severity: risk.severity, category: risk.category },
    };
  }
  let ids = result.highlight_ids;
  if (card?.kind === 'field' && card.field_id && !ids.includes(card.field_id)) {
    ids = [card.field_id, ...ids];
  }
  // A quote from an earlier page (page_title set) isn't on this page.
  if (card?.kind === 'answer' && card.quote && !card.quote.page_title && ids.length === 0) {
    ids = [card.quote.section_id];
  }
  if (ids.length === 0) return null;
  const quote = result.quote_text ?? (card?.kind === 'answer' ? (card.quote?.text ?? null) : null);
  return { ids, quote_text: quote, level: card?.kind === 'risk_list' ? 'risk' : 'normal' };
}
