import { ChevronRight } from 'lucide-preact';
import type { Card, ToolResult } from '../../core/api';
import type { CardEntry } from '../../core/store';
import { useApp } from '../context';
import { sourceBadgeText } from '../labels';
import { AnswerCard } from './AnswerCard';
import { FieldCard } from './FieldCard';
import { LoadingCard } from './LoadingCard';
import { RiskListCard } from './RiskListCard';
import { BulletCard } from './SummaryCard';
import { TrueCostCard } from './TrueCostCard';
import { TrustCard } from './TrustCard';

function CardBody({
  id,
  card,
  result,
  latest,
}: {
  id: string;
  card: Card;
  result: ToolResult;
  latest: boolean;
}) {
  switch (card.kind) {
    case 'answer':
      return <AnswerCard id={id} card={card} result={result} latest={latest} />;
    case 'field':
      return <FieldCard id={id} card={card} result={result} />;
    case 'risk_list':
      return <RiskListCard id={id} card={card} result={result} latest={latest} />;
    case 'summary':
    case 'web_answer':
      return <BulletCard id={id} card={card} result={result} latest={latest} />;
    case 'true_cost':
      return <TrueCostCard id={id} card={card} result={result} />;
    case 'trust':
      return <TrustCard id={id} card={card} result={result} />;
  }
}

export function CardView({
  entry,
  expanded,
  latest,
}: {
  entry: CardEntry;
  expanded: boolean;
  latest: boolean;
}) {
  const app = useApp();
  const result = entry.result;
  const card = result?.card;
  if (!result || !card) return <LoadingCard caption={entry.caption} />;
  if (!expanded) {
    return (
      <button
        type="button"
        class="iris-card iris-card--collapsed"
        aria-expanded="false"
        onClick={() => {
          app.expandCard(entry.id);
        }}
      >
        <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
        <span class="iris-card__collapsed-text">
          {card.topic} ·{' '}
          {sourceBadgeText(
            card.source,
            result.sources.length,
            card.kind === 'answer' ? (card.quote?.page_title ?? null) : null,
          )}
        </span>
      </button>
    );
  }
  return (
    <article class={`iris-card iris-card--${card.kind}`} aria-label={card.topic}>
      <CardBody id={entry.id} card={card} result={result} latest={latest} />
    </article>
  );
}

/** Newest card on top and expanded; one expanded at a time. */
export function CardStack() {
  const { store } = useApp();
  const cards = store.cards.value;
  const expanded = store.expandedCard.value;
  return (
    <section class="iris-cards" aria-live="polite" aria-label="Answers">
      {cards.map((entry, index) => (
        <CardView
          key={entry.id}
          entry={entry}
          expanded={entry.id === expanded}
          latest={index === 0}
        />
      ))}
    </section>
  );
}
