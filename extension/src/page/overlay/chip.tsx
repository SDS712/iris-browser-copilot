/** The nudge chip beside an element. Tapping it opens Iris. */
import { Glyph } from './bubble';

export function Chip({ label, onActivate }: { label: string; onActivate: () => void }) {
  return (
    <button
      type="button"
      class="chip"
      // Keep focus in the field: leaving the field hides the chip before the click lands.
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={onActivate}
    >
      <Glyph />
      <span>{label}</span>
    </button>
  );
}
