import type { Signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { Orb } from './Orb';
import { Panel } from './Panel';

/** The widget: a "Talk to Iris" pill, or the full panel. */
export function WidgetShell({ open, onOpen }: { open: Signal<boolean>; onOpen: () => void }) {
  const panel = useRef<HTMLElement>(null);
  const pill = useRef<HTMLButtonElement>(null);
  const isOpen = open.value;
  // Move focus into the panel when it opens, and back to the pill when it's minimised.
  useEffect(() => {
    if (isOpen) panel.current?.focus();
    else if (document.activeElement?.tagName === 'IRIS-WIDGET') pill.current?.focus();
  }, [isOpen]);

  if (!isOpen) {
    return (
      <button type="button" class="iris-widget__pill" ref={pill} onClick={onOpen}>
        <Orb size={28} />
        Talk to Iris
      </button>
    );
  }
  return (
    <section class="iris-widget__panel" aria-label="Iris" tabIndex={-1} ref={panel}>
      <Panel />
    </section>
  );
}
