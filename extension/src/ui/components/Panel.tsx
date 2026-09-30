import { useSignal } from '@preact/signals';
import { Volume2 } from 'lucide-preact';
import { COPY } from '../../core/copy';
import { useApp } from '../context';
import { About } from './About';
import { CardStack } from './CardStack';
import { Footer } from './Footer';
import { Header } from './Header';
import { LiveCaptions } from './LiveCaptions';
import { MicPermission } from './MicPermission';
import { Notice } from './Notice';
import { PageStrip } from './PageStrip';
import { SettingsPopover } from './SettingsPopover';
import { TourBar } from './TourBar';
import { Welcome } from './Welcome';

/** Notices from the session, the page and "stop suggesting". */
function Notices() {
  const app = useApp();
  const { store, platform } = app;
  const notice = store.notice.value;
  const status = store.pageStatus.value;
  const page = store.page.value;
  return (
    <>
      {status === 'unsupported' && <Notice kind="info" message={COPY.errors.cantRead} />}
      {status === 'unreachable' && <Notice kind="error" message={COPY.errors.backendUnreachable} />}
      {page?.truncated && <Notice kind="info" message={COPY.errors.partialPage} />}
      {store.session.nudgesOff.value && <Notice kind="nudges_off" message="Nudges off" />}
      {notice && (
        <Notice
          kind={notice.kind}
          message={notice.message}
          onDismiss={() => {
            app.dismissNotice();
          }}
          action={
            notice.kind === 'mic' && platform.openMicPermission
              ? { label: 'Allow microphone', onClick: platform.openMicPermission }
              : undefined
          }
        />
      )}
    </>
  );
}

function TapToHear() {
  const app = useApp();
  const { audioSuspended, quietResume } = app.store.session;
  // After a page load the user asked for no prompt: any click on the page brings audio back.
  if (!audioSuspended.value || quietResume.value) return null;
  return (
    <button
      type="button"
      class="iris-tap-to-hear"
      onClick={() => {
        void app.resumeAudio();
      }}
    >
      <Volume2 size={20} strokeWidth={1.75} aria-hidden />
      Tap to hear Iris
    </button>
  );
}

/** The Iris panel: the same content in the side panel and the widget. */
export function Panel() {
  const app = useApp();
  const { store } = app;
  const settingsOpen = useSignal(false);
  const aboutOpen = useSignal(false);
  const skippedMic = useSignal(false);

  const state = store.session.state.value;
  // A running session stays on screen when the grant lapses: the microphone notice offers
  // "Allow microphone" there instead.
  const sessionRunning = state !== 'idle' && state !== 'error';
  if (store.micPrompt.value && !skippedMic.value && !sessionRunning) {
    return <MicPermission onSkip={() => (skippedMic.value = true)} />;
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') app.escape();
  };
  // Welcome is for "first open, or no session yet": once there's a conversation, keep it.
  const welcome =
    state === 'idle' &&
    store.cards.value.length === 0 &&
    store.session.transcript.value.length === 0 &&
    !aboutOpen.value;
  const settings = settingsOpen.value && (
    <SettingsPopover
      onClose={() => (settingsOpen.value = false)}
      onAbout={() => {
        settingsOpen.value = false;
        aboutOpen.value = true;
      }}
    />
  );
  const toggleSettings = () => (settingsOpen.value = !settingsOpen.value);
  if (welcome) {
    return (
      <div class="iris-panel" onKeyDown={onKeyDown}>
        <Welcome settingsOpen={settingsOpen.value} onSettings={toggleSettings}>
          <Notices />
        </Welcome>
        {settings}
      </div>
    );
  }

  return (
    <div class="iris-panel" onKeyDown={onKeyDown}>
      <Header settingsOpen={settingsOpen.value} onSettings={toggleSettings} />
      {settings}
      <PageStrip scan={store.page.value?.scan ?? null} />
      <main class="iris-panel__body">
        {aboutOpen.value ? (
          <About onBack={() => (aboutOpen.value = false)} />
        ) : (
          <>
            <Notices />
            <TapToHear />
            <TourBar />
            {store.settings.value.captions && <LiveCaptions />}
            <CardStack />
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
