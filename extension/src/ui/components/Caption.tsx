import type { ReadonlySignal } from '@preact/signals';
import { COPY } from '../../core/copy';
import type { IrisStore, SessionState } from '../../core/store';
import { useApp } from '../context';

/** The orb's caption for each state. */
export function captionFor(session: IrisStore['session'], state: SessionState): string {
  switch (state) {
    case 'idle':
      return COPY.orb.idle;
    case 'connecting':
      return COPY.orb.connecting;
    case 'listening':
      return COPY.orb.listening;
    case 'hearing':
      return session.userLive.value || COPY.orb.listening;
    case 'thinking':
      return (
        session.toolCaption.value ??
        session.transcript.value.findLast((line) => line.who === 'you')?.text ??
        COPY.orb.listening
      );
    case 'speaking':
      return session.agentLive.value || session.toolCaption.value || '…';
    case 'muted':
      return COPY.orb.muted;
    case 'error':
      return COPY.orb.error;
  }
}

interface CaptionProps {
  state?: ReadonlySignal<SessionState> | SessionState;
}

/** Live caption next to the orb; a status region so screen readers hear state changes. */
export function Caption({ state }: CaptionProps) {
  const { store } = useApp();
  const current =
    state === undefined
      ? store.session.state.value
      : typeof state === 'string'
        ? state
        : state.value;
  const live = current === 'hearing' || current === 'speaking';
  return (
    <p
      class={`iris-caption${live ? ' iris-caption--live' : ''}`}
      role="status"
      data-state={current}
    >
      {captionFor(store.session, current)}
    </p>
  );
}
