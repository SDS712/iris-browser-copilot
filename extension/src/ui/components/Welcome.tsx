import type { ComponentChildren } from 'preact';
import { useApp } from '../context';
import { suggestionsFor } from '../labels';
import { MainButton } from './MainButton';
import { Orb } from './Orb';
import { TextBox } from './TextBox';
import { SettingsButton, WindowButtons } from './Header';

/**
 * First open, or no session yet. The text box
 * and main button sit at the bottom, where the footer has them during a conversation.
 */
export function Welcome({
  settingsOpen,
  onSettings,
  children,
}: {
  settingsOpen: boolean;
  onSettings: () => void;
  children?: ComponentChildren;
}) {
  const app = useApp();
  const pageType = app.store.page.value?.page_type ?? null;
  return (
    <div class="iris-welcome">
      <div class="iris-welcome__top">
        <SettingsButton open={settingsOpen} onClick={onSettings} />
        <WindowButtons />
      </div>
      <div class="iris-welcome__body">
        <Orb size={96} />
        <h1 class="iris-welcome__title">Hi, I'm Iris.</h1>
        <p class="iris-welcome__subtitle">A second pair of eyes on this page.</p>
        {children}
        <h2 class="iris-welcome__try">Try asking</h2>
        <ul class="iris-suggestions">
          {suggestionsFor(pageType).map((suggestion) => (
            <li key={suggestion}>
              <button
                type="button"
                class="iris-suggestion"
                onClick={() => {
                  app.sendText(suggestion);
                }}
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div class="iris-welcome__bottom">
        <TextBox />
        <MainButton />
        <p class="iris-welcome__small">Your voice is processed by AssemblyAI.</p>
      </div>
    </div>
  );
}
