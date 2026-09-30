import { Minus, Settings, X } from 'lucide-preact';
import { useApp } from '../context';
import { Caption } from './Caption';
import { Orb } from './Orb';

/** Orb and caption, settings, close or minimise. */
export function Header({
  onSettings,
  settingsOpen,
}: {
  onSettings: () => void;
  settingsOpen: boolean;
}) {
  return (
    <header class="iris-header">
      <div class="iris-header__status">
        <Orb size={32} />
        <span class="iris-header__wordmark">iris</span>
        <Caption />
      </div>
      <div class="iris-header__actions">
        <SettingsButton open={settingsOpen} onClick={onSettings} />
        <WindowButtons />
      </div>
    </header>
  );
}

/** Opens the settings popover: in the header, and on the welcome screen. */
export function SettingsButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      class="iris-icon-button"
      aria-label="Settings"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onClick}
    >
      <Settings size={20} strokeWidth={1.75} aria-hidden />
    </button>
  );
}

export function WindowButtons() {
  const { platform } = useApp();
  return (
    <>
      {platform.minimise && (
        <button
          type="button"
          class="iris-icon-button"
          aria-label="Minimise Iris"
          onClick={platform.minimise}
        >
          <Minus size={20} strokeWidth={1.75} aria-hidden />
        </button>
      )}
      {platform.close && (
        <button
          type="button"
          class="iris-icon-button"
          aria-label="Close Iris"
          onClick={platform.close}
        >
          <X size={20} strokeWidth={1.75} aria-hidden />
        </button>
      )}
    </>
  );
}
