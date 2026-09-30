import { useApp } from '../context';

/** "Nudges ● on" in the footer. */
export function NudgesToggle() {
  const app = useApp();
  const on = app.store.settings.value.nudges;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      class="iris-nudges-toggle"
      onClick={() => {
        app.setSetting('nudges', !on);
      }}
    >
      Nudges
      <span class={`iris-nudges-toggle__dot${on ? ' iris-nudges-toggle__dot--on' : ''}`} />
      {on ? 'on' : 'off'}
    </button>
  );
}
