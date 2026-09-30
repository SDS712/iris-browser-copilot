import { Mic } from 'lucide-preact';
import { useApp } from '../context';

/** "Talk to Iris" when idle, "End" during a session, "Try again" after an error. */
export function MainButton() {
  const app = useApp();
  const state = app.store.session.state.value;
  const label = state === 'idle' ? 'Talk to Iris' : state === 'error' ? 'Try again' : 'End';
  const running = state !== 'idle' && state !== 'error';
  return (
    <button
      type="button"
      class={`iris-main-button${running ? ' iris-main-button--end' : ''}`}
      onClick={() => {
        app.talk();
      }}
    >
      {!running && <Mic size={20} strokeWidth={1.75} aria-hidden />}
      {label}
    </button>
  );
}
