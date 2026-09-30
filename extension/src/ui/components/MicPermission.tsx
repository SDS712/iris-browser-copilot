import { Mic } from 'lucide-preact';
import { useApp } from '../context';
import { Orb } from './Orb';
import { WindowButtons } from './Header';

/** Extension first run: the side panel can't prompt, so a tab asks. */
export function MicPermission({ onSkip }: { onSkip: () => void }) {
  const { platform } = useApp();
  return (
    <div class="iris-welcome">
      <div class="iris-welcome__top">
        <WindowButtons />
      </div>
      <div class="iris-welcome__body">
        <Orb size={96} state="idle" />
        <h1 class="iris-welcome__title">Hi, I'm Iris.</h1>
        <p class="iris-welcome__subtitle">
          Iris needs your microphone so you can talk to it. It only listens while a session is on.
        </p>
        <button type="button" class="iris-main-button" onClick={platform.openMicPermission}>
          <Mic size={20} strokeWidth={1.75} aria-hidden />
          Allow microphone
        </button>
        <button type="button" class="iris-link-button" onClick={onSkip}>
          Not now
        </button>
      </div>
    </div>
  );
}
