import type { ToolResult } from '../../core/api';
import type { components } from '../../core/api-types';
import { CardActions, CardHeader } from './CardParts';

type Field = components['schemas']['FieldCard'];

export function FieldCard({ id, card, result }: { id: string; card: Field; result: ToolResult }) {
  return (
    <>
      <CardHeader topic={card.topic} source={card.source} sourceCount={result.sources.length} />
      <dl class="iris-field-rows">
        {card.rows.map((row) => (
          <div key={row.label} class="iris-field-rows__row">
            <dt>{row.label}</dt>
            <dd class={row.label === 'Format' ? 'iris-field-rows__format' : undefined}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      <CardActions
        cardId={id}
        showLabel={card.field_id || result.highlight_ids.length > 0 ? 'Show field' : null}
        sources={result.sources}
        copyText={card.lead}
      />
    </>
  );
}
