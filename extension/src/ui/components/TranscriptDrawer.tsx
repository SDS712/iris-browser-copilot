import { useSignal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { ChevronRight } from 'lucide-preact';
import { useApp } from '../context';

/** Collapsed transcript with "You" and "Iris" lines. */
export function TranscriptDrawer() {
  const { store } = useApp();
  const open = useSignal(false);
  const list = useRef<HTMLOListElement>(null);
  const followBottom = useRef(true);
  const lines = store.session.transcript.value;
  const live = store.session.userLive.value;

  useEffect(() => {
    const node = list.current;
    if (node && followBottom.current) node.scrollTop = node.scrollHeight;
  }, [lines.length, live, open.value]);

  return (
    <section class="iris-transcript" aria-label="Transcript">
      <button
        type="button"
        class="iris-transcript__toggle"
        aria-expanded={open.value}
        onClick={() => (open.value = !open.value)}
      >
        <ChevronRight size={16} strokeWidth={1.75} class="iris-transcript__chevron" aria-hidden />
        Transcript ({lines.length})
      </button>
      {open.value && (
        <ol
          ref={list}
          class="iris-transcript__lines"
          onScroll={(event) => {
            const node = event.currentTarget;
            followBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
          }}
        >
          {lines.map((line) => (
            <li key={line.id} class="iris-transcript__line">
              <span class="iris-transcript__who">{line.who === 'you' ? 'You' : 'Iris'}</span>
              <span>{line.text}</span>
            </li>
          ))}
          {live && (
            <li class="iris-transcript__line iris-transcript__line--live">
              <span class="iris-transcript__who">You</span>
              <span>{live}</span>
            </li>
          )}
        </ol>
      )}
    </section>
  );
}
