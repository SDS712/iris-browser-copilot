import type { ToolResult } from '../../core/api';
import type { components } from '../../core/api-types';
import { CardActions, CardHeader } from './CardParts';
import { VerdictChip } from './VerdictChip';

type Trust = components['schemas']['TrustCard'];

const LEVEL_WORDS = { good: 'Good sign:', warn: 'Warning:', bad: 'Warning:' } as const;

/** Site check: verdict, reasons and the checks line. */
export function TrustCard({ id, card, result }: { id: string; card: Trust; result: ToolResult }) {
  return (
    <>
      <CardHeader topic={card.topic} source={card.source} sourceCount={result.sources.length} />
      <p class="iris-trust__verdict">
        <VerdictChip verdict={card.verdict} />
        <span class="iris-trust__domain">{card.domain}</span>
      </p>
      <ul class="iris-trust__reasons">
        {card.reasons.map((reason) => (
          <li key={reason.text}>
            <span class={`iris-dot iris-dot--reason-${reason.level}`} aria-hidden="true" />
            <span class="iris-visually-hidden">{LEVEL_WORDS[reason.level]} </span>
            {reason.text}
          </li>
        ))}
      </ul>
      <p class="iris-trust__checks">{card.checks_line}</p>
      <CardActions cardId={id} sources={result.sources} copyText={card.lead} />
    </>
  );
}
