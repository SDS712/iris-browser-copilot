import type { CardSource } from '../../core/api';
import { sourceBadgeText } from '../labels';

/** Where an answer came from. */
export function SourceBadge({
  source,
  sourceCount,
  earlierPage = null,
}: {
  source: CardSource;
  sourceCount: number;
  /** The title of the earlier page in this tab that a quote came from. */
  earlierPage?: string | null;
}) {
  return (
    <span class={`iris-badge iris-badge--${source}`}>
      {sourceBadgeText(source, sourceCount, earlierPage)}
    </span>
  );
}
