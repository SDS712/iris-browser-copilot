import type { ToolResult } from '../../core/api';
import type { components } from '../../core/api-types';
import { CardActions, CardHeader, Lead, Quote } from './CardParts';
import { RiskTagList } from './RiskTag';

type Answer = components['schemas']['AnswerCard'];

export function AnswerCard({
  id,
  card,
  result,
  latest,
}: {
  id: string;
  card: Answer;
  result: ToolResult;
  latest: boolean;
}) {
  return (
    <>
      <CardHeader
        topic={card.topic}
        source={card.source}
        sourceCount={result.sources.length}
        earlierPage={card.quote?.page_title ?? null}
      />
      <Lead text={card.lead} latest={latest} />
      {card.quote && <Quote text={card.quote.text} heading={card.quote.section_heading} />}
      <RiskTagList risks={card.risks} />
      <CardActions
        cardId={id}
        showLabel={result.highlight_ids.length > 0 ? 'Show on page' : null}
        sources={result.sources}
        copyText={card.lead}
      />
    </>
  );
}
