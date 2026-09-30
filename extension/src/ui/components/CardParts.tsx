import { useSignal } from '@preact/signals';
import { Copy, Crosshair, Link } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import type { CardSource, Source } from '../../core/api';
import { useApp } from '../context';
import { SourceBadge } from './SourceBadge';

export function CardHeader({
  topic,
  source,
  sourceCount,
  earlierPage = null,
}: {
  topic: string;
  source: CardSource;
  sourceCount: number;
  earlierPage?: string | null;
}) {
  return (
    <header class="iris-card__header">
      <h3 class="iris-card__topic">{topic}</h3>
      <SourceBadge source={source} sourceCount={sourceCount} earlierPage={earlierPage} />
    </header>
  );
}

export function Lead({ text, latest }: { text: string; latest: boolean }) {
  return (
    <p class={latest ? 'iris-card__lead iris-card__lead--latest' : 'iris-card__lead'}>{text}</p>
  );
}

export function Quote({ text, heading }: { text: string; heading: string | null }) {
  return (
    <figure class="iris-quote">
      <blockquote class="iris-quote__text">“{text}”</blockquote>
      {heading && <figcaption class="iris-quote__heading">{heading}</figcaption>}
    </figure>
  );
}

function SmallButton({
  icon,
  label,
  onClick,
  expanded,
}: {
  icon: ComponentChildren;
  label: string;
  onClick: () => void;
  expanded?: boolean;
}) {
  return (
    <button type="button" class="iris-small-button" aria-expanded={expanded} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

interface CardActionsProps {
  cardId: string;
  /** "Show on page" (or "Show field") appears only when there's something to show. */
  showLabel?: string | null;
  sources: Source[];
  copyText?: string;
}

/** Show on page, Sources and Copy. */
export function CardActions({ cardId, showLabel, sources, copyText }: CardActionsProps) {
  const app = useApp();
  const sourcesOpen = useSignal(false);
  const copied = useSignal(false);
  return (
    <>
      <div class="iris-card__actions">
        {showLabel && (
          <SmallButton
            icon={<Crosshair size={16} strokeWidth={1.75} aria-hidden />}
            label={showLabel}
            onClick={() => {
              app.showOnPage(cardId);
            }}
          />
        )}
        {sources.length > 0 && (
          <SmallButton
            icon={<Link size={16} strokeWidth={1.75} aria-hidden />}
            label="Sources"
            expanded={sourcesOpen.value}
            onClick={() => (sourcesOpen.value = !sourcesOpen.value)}
          />
        )}
        {copyText && (
          <SmallButton
            icon={<Copy size={16} strokeWidth={1.75} aria-hidden />}
            label={copied.value ? 'Copied' : 'Copy'}
            onClick={() => {
              app.copyText(copyText);
              copied.value = true;
              setTimeout(() => (copied.value = false), 2000);
            }}
          />
        )}
      </div>
      {sourcesOpen.value && (
        <ul class="iris-sources">
          {sources.map((source) => (
            <li key={source.url}>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {source.title}
              </a>
              <span class="iris-sources__domain">{source.domain}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
