import { X } from 'lucide-preact';
import type { NoticeKind } from '../../core/store';

interface NoticeProps {
  kind: NoticeKind;
  message: string;
  onDismiss?: () => void;
  action?: { label: string; onClick: () => void };
}

const QUIET_KINDS: ReadonlySet<NoticeKind> = new Set(['info', 'nudges_off']);

/** Errors, demo limits and small notes. */
export function Notice({ kind, message, onDismiss, action }: NoticeProps) {
  const quiet = QUIET_KINDS.has(kind);
  return (
    <div class={`iris-notice iris-notice--${kind}`} role={quiet ? 'status' : 'alert'}>
      <p class="iris-notice__text">{message}</p>
      {action && (
        <button type="button" class="iris-small-button" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {onDismiss && (
        <button
          type="button"
          class="iris-icon-button iris-notice__dismiss"
          aria-label="Dismiss"
          onClick={onDismiss}
        >
          <X size={16} strokeWidth={1.75} aria-hidden />
        </button>
      )}
    </div>
  );
}
