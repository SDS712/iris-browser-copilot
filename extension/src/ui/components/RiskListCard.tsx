import { Crosshair } from 'lucide-preact';
import type { ToolResult } from '../../core/api';
import type { components } from '../../core/api-types';
import { useApp } from '../context';
import { CardHeader, Lead, Quote } from './CardParts';
import { RiskTag } from './RiskTag';

type RiskList = components['schemas']['RiskListCard'];

/** Every flag, each with its own "Show on page". */
export function RiskListCard({
  id,
  card,
  result,
  latest,
}: {
  id: string;
  card: RiskList;
  result: ToolResult;
  latest: boolean;
}) {
  const app = useApp();
  return (
    <>
      <CardHeader topic={card.topic} source={card.source} sourceCount={result.sources.length} />
      <Lead text={card.lead} latest={latest} />
      <ol class="iris-risk-list">
        {card.risks.map((risk, index) => (
          <li key={risk.id} class="iris-risk-list__item">
            <RiskTag severity={risk.severity} category={risk.category} />
            <p class="iris-risk-list__title">{risk.title}</p>
            <p class="iris-risk-list__detail">{risk.detail}</p>
            {risk.quote && <Quote text={risk.quote} heading={null} />}
            {(risk.element_ids.length > 0 || risk.section_id) && (
              <button
                type="button"
                class="iris-small-button"
                onClick={() => {
                  app.showOnPage(id, index);
                }}
              >
                <Crosshair size={16} strokeWidth={1.75} aria-hidden />
                Show on page
              </button>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}
