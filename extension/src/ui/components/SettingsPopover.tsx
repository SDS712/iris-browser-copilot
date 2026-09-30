import { useEffect, useRef } from 'preact/hooks';
import { COPY } from '../../core/copy';
import type { VoiceChoice } from '../../core/settings';
import { useApp } from '../context';

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      class="iris-setting"
      onClick={() => {
        onChange(!checked);
      }}
    >
      <span>{label}</span>
      <span class={`iris-switch${checked ? ' iris-switch--on' : ''}`} aria-hidden="true" />
    </button>
  );
}

const VOICES: { value: VoiceChoice; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
];

/** Female or male. A session keeps the voice it started with. */
function VoicePicker() {
  const app = useApp();
  const chosen = app.store.settings.value.voice;
  const speaking = app.store.session.voice.value;
  return (
    <>
      <div
        class="iris-setting iris-setting--choice"
        role="group"
        aria-labelledby="iris-voice-label"
      >
        <span id="iris-voice-label">Voice</span>
        <span class="iris-segmented">
          {VOICES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={chosen === value}
              onClick={() => {
                app.setSetting('voice', value);
              }}
            >
              {label}
            </button>
          ))}
        </span>
      </div>
      {speaking !== null && speaking !== chosen && (
        <p class="iris-setting__note" role="status">
          {COPY.voiceNextSession}
        </p>
      )}
    </>
  );
}

/** Nudges, sound, captions, voice, the shortcut and "About and privacy". */
export function SettingsPopover({
  onClose,
  onAbout,
}: {
  onClose: () => void;
  onAbout: () => void;
}) {
  const app = useApp();
  const settings = app.store.settings.value;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    // Captured first, so Esc with settings open only closes settings.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !event.composedPath().includes(ref.current)) onClose();
    };
    const root = ref.current?.getRootNode() as Document | ShadowRoot | undefined;
    root?.addEventListener('keydown', onKey as EventListener, true);
    root?.addEventListener('pointerdown', onPointer as EventListener, true);
    return () => {
      root?.removeEventListener('keydown', onKey as EventListener, true);
      root?.removeEventListener('pointerdown', onPointer as EventListener, true);
    };
  }, [onClose]);

  return (
    <div ref={ref} class="iris-popover" role="dialog" aria-label="Settings">
      <Toggle
        label="Nudges"
        checked={settings.nudges}
        onChange={(value) => {
          app.setSetting('nudges', value);
        }}
      />
      <Toggle
        label="Sound before Iris speaks up"
        checked={settings.sound_cues}
        onChange={(value) => {
          app.setSetting('sound_cues', value);
        }}
      />
      <Toggle
        label="Always show captions"
        checked={settings.captions}
        onChange={(value) => {
          app.setSetting('captions', value);
        }}
      />
      <VoicePicker />
      {app.platform.shortcut && (
        <p class="iris-popover__shortcut">
          Shortcut <kbd>{app.platform.shortcut}</kbd>
        </p>
      )}
      <button type="button" class="iris-link-button" onClick={onAbout}>
        About and privacy
      </button>
    </div>
  );
}
