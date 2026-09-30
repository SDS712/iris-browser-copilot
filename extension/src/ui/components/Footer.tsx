import { useApp } from '../context';
import { MainButton } from './MainButton';
import { MuteButton } from './MuteButton';
import { NudgesToggle } from './NudgesToggle';
import { TextBox } from './TextBox';
import { TranscriptDrawer } from './TranscriptDrawer';

export function Footer() {
  const { store } = useApp();
  const state = store.session.state.value;
  const running = state !== 'idle' && state !== 'error';
  return (
    <footer class="iris-footer">
      <TranscriptDrawer />
      <TextBox />
      <div class="iris-footer__controls">
        <NudgesToggle />
        <span class="iris-footer__spacer" />
        {running && <MuteButton />}
        <MainButton />
      </div>
    </footer>
  );
}
