import { useSignalEffect } from '@preact/signals';
import { useId, useRef } from 'preact/hooks';
import type { SessionState } from '../../core/store';
import { useApp } from '../context';

interface OrbProps {
  size: 28 | 32 | 96;
  /** Shows this state instead of the live one (gallery). */
  state?: SessionState;
}

/** The orb. Levels drive CSS variables directly, without re-rendering. */
export function Orb({ size, state }: OrbProps) {
  const { store } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const gradient = `iris-orb-${useId()}`;
  const shown = state ?? store.session.state.value;

  useSignalEffect(() => {
    const input = store.session.inputLevel.value;
    const output = store.session.outputLevel.value;
    const node = ref.current;
    if (!node) return;
    node.style.setProperty('--iris-level-in', input.toFixed(3));
    node.style.setProperty('--iris-level-out', output.toFixed(3));
  });

  return (
    <div
      ref={ref}
      class={`iris-orb${size < 32 ? ' iris-orb--small' : ''}`}
      style={{ '--iris-orb-size': `${size}px` }}
      data-state={shown}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 100" focusable="false">
        <defs>
          <radialGradient id={gradient} cx="50%" cy="50%" r="50%">
            <stop offset="0%" class="iris-orb__stop-centre" />
            <stop offset="60%" class="iris-orb__stop-centre" />
            <stop offset="100%" class="iris-orb__stop-edge" />
          </radialGradient>
        </defs>
        <circle class="iris-orb__ripple" cx="50" cy="50" r="47" />
        <circle class="iris-orb__ripple iris-orb__ripple--late" cx="50" cy="50" r="47" />
        <g class="iris-orb__body">
          <circle class="iris-orb__disc" cx="50" cy="50" r="47" fill={`url(#${gradient})`} />
          <g class="iris-orb__pupil">
            <circle class="iris-orb__ring" cx="50" cy="50" r="19" />
            <circle class="iris-orb__core" cx="50" cy="50" r="9" />
          </g>
          <circle class="iris-orb__glint" cx="33" cy="31" r="6" />
          <line class="iris-orb__slash" x1="24" y1="76" x2="76" y2="24" />
        </g>
      </svg>
    </div>
  );
}
