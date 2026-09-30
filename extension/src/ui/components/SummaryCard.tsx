import type { ToolResult } from '../../core/api';
import type { components } from '../../core/api-types';
import { CardActions, CardHeader, Lead } from './CardParts';

type Summary = components['schemas']['SummaryCard'];
type WebAnswer = components['schemas']['WebAnswerCard'];

/** Summary (≤ 5 bullets) and web answer (≤ 4 bullets) cards share this layout. */
export function BulletCard({
  id,
  card,
  result,
  latest,
}: {
  id: string;
  card: Summary | WebAnswer;
  result: ToolResult;
  latest: boolean;
}) {
  return (
    <>
      <CardHeader topic={card.topic} source={card.source} sourceCount={result.sources.length} />
      {card.bullets.length > 0 ? (
        <ul class="iris-bullets">
          {card.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      ) : (
        <Lead text={card.lead} latest={latest} />
      )}
      <CardActions
        cardId={id}
        showLabel={result.highlight_ids.length > 0 ? 'Show on page' : null}
        sources={result.sources}
        copyText={card.bullets.length > 0 ? card.bullets.join('\n') : card.lead}
      />
    </>
  );
}
