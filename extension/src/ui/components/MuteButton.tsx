import { Mic, MicOff } from 'lucide-preact';
import { useApp } from '../context';

export function MuteButton() {
  const app = useApp();
  const muted = app.store.session.muted.value;
  const Icon = muted ? MicOff : Mic;
  return (
    <button
      type="button"
      class="iris-icon-button iris-mute-button"
      aria-label="Mute microphone"
      aria-pressed={muted}
      onClick={() => {
        app.toggleMute();
      }}
    >
      <Icon size={20} strokeWidth={1.75} aria-hidden />
    </button>
  );
}
