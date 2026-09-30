/** Labels for contract values. */
import type { CardSource, PageType, RiskCategory } from '../core/api';

export const CATEGORY_LABELS: Record<RiskCategory, string> = {
  costs_money: 'Costs you money',
  auto_debit: 'Auto-debits you',
  shares_data: 'Shares your data',
  hard_to_cancel: 'Hard to cancel',
  auto_renews: 'Renews automatically',
  limits_rights: 'Limits your rights',
  worth_knowing: 'Worth knowing',
};

/** Page strip wording with a count: "● 2 cost you money", "● 1 auto-debit". */
const STRIP_LABELS: Record<RiskCategory, [one: string, many: string]> = {
  costs_money: ['costs you money', 'cost you money'],
  auto_debit: ['auto-debit', 'auto-debits'],
  shares_data: ['shares your data', 'share your data'],
  hard_to_cancel: ['hard to cancel', 'hard to cancel'],
  auto_renews: ['renews automatically', 'renew automatically'],
  limits_rights: ['limits your rights', 'limit your rights'],
  worth_knowing: ['worth knowing', 'worth knowing'],
};

export function stripLabel(category: RiskCategory, count: number): string {
  const [one, many] = STRIP_LABELS[category];
  return `${count} ${count === 1 ? one : many}`;
}

export function sourceBadgeText(
  source: CardSource,
  sourceCount: number,
  earlierPage: string | null = null,
): string {
  switch (source) {
    case 'page':
      return earlierPage ? `From an earlier page · ${earlierPage}` : 'From this page';
    case 'web':
      return sourceCount > 0
        ? `From the web · ${sourceCount} source${sourceCount === 1 ? '' : 's'}`
        : 'From the web';
    case 'calculated':
      return 'Calculated';
    case 'not_found':
      return 'Not on this page';
  }
}

export const VERDICT_LABELS = {
  looks_ok: 'Looks OK',
  be_careful: 'Be careful',
  likely_unsafe: 'Likely unsafe',
} as const;

export function suggestionsFor(pageType: PageType | null): string[] {
  switch (pageType) {
    case 'terms':
    case 'privacy':
      return [
        'What should I know here?',
        'Can I cancel anytime?',
        'Do they share my data?',
        'Walk me through this page',
      ];
    case 'checkout':
      return [
        'Anything I should know before I pay?',
        'What am I paying for?',
        'Is this site legit?',
      ];
    case 'form':
      return ['Explain this form', 'What does this field mean?', 'Which fields can I skip?'];
    case 'offer':
      return ["What's the real cost?", 'Summarise the fine print', 'Is this site legit?'];
    default:
      return [
        'Summarise this page',
        'What should I know here?',
        'Is this site legit?',
        'Walk me through this page',
      ];
  }
}
