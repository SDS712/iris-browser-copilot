import { useSignal } from '@preact/signals';
import { ChevronRight } from 'lucide-preact';
import type { ToolResult } from '../../core/api';
import type { components } from '../../core/api-types';
import { formatInr, formatPercent } from '../format';
import { CardActions, CardHeader } from './CardParts';

type TrueCost = components['schemas']['TrueCostCard'];

/** The true yearly cost of an offer. Every figure is the backend's. */
export function TrueCostCard({
  id,
  card,
  result,
}: {
  id: string;
  card: TrueCost;
  result: ToolResult;
}) {
  const open = useSignal(false);
  const total = `You pay ${formatInr(card.total_paid_inr)} in total`;
  return (
    <>
      <CardHeader topic={card.topic} source={card.source} sourceCount={result.sources.length} />
      <p class="iris-figure iris-num">{card.figure_text}</p>
      <p class="iris-true-cost__line">Advertised as {card.advertised}</p>
      <p class="iris-true-cost__line iris-num">
        {card.fees_upfront_inr > 0
          ? `${total}, plus a ${formatInr(card.fees_upfront_inr)} fee upfront`
          : total}
      </p>
      <p class="iris-true-cost__line iris-num">
        That's {formatInr(card.extra_over_price_inr)} more than the price
      </p>
      <button
        type="button"
        class="iris-disclosure"
        aria-expanded={open.value}
        onClick={() => (open.value = !open.value)}
      >
        <ChevronRight size={16} strokeWidth={1.75} class="iris-disclosure__chevron" aria-hidden />
        How this was worked out
      </button>
      {open.value && (
        <div class="iris-true-cost__details">
          {card.explanation.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <p class="iris-num">
            {formatInr(card.emi_inr)} a month for {card.tenure_months} months. Yearly rate{' '}
            {formatPercent(card.apr_percent)}; with monthly compounding,{' '}
            {formatPercent(card.effective_annual_percent)}.
          </p>
        </div>
      )}
      <CardActions cardId={id} sources={result.sources} copyText={card.lead} />
    </>
  );
}
