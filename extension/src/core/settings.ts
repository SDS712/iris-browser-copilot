/**
 * User settings: chrome.storage.local in the extension, localStorage in the
 * widget. Storage can fail (private mode, blocked site data), so every access falls back
 * to the defaults: nudges on, sound cues on, captions on, the female voice.
 */
export type VoiceChoice = 'female' | 'male';

export interface IrisSettings {
  nudges: boolean;
  captions: boolean;
  /** A soft chime before Iris speaks up by itself. */
  sound_cues: boolean;
  /** Fixed for a session: a change applies from the next one. */
  voice: VoiceChoice;
}

export const DEFAULT_SETTINGS: IrisSettings = {
  nudges: true,
  captions: true,
  sound_cues: true,
  voice: 'female',
};

function isVoice(value: unknown): value is VoiceChoice {
  return value === 'female' || value === 'male';
}

export interface SettingsStorage {
  load(): Promise<IrisSettings>;
  save(settings: IrisSettings): Promise<void>;
}

function normalise(value: unknown, fallback: IrisSettings): IrisSettings {
  if (typeof value !== 'object' || value === null) return fallback;
  const record = value as Record<string, unknown>;
  return {
    nudges: typeof record.nudges === 'boolean' ? record.nudges : fallback.nudges,
    captions: typeof record.captions === 'boolean' ? record.captions : fallback.captions,
    sound_cues: typeof record.sound_cues === 'boolean' ? record.sound_cues : fallback.sound_cues,
    voice: isVoice(record.voice) ? record.voice : fallback.voice,
  };
}

const LOCAL_KEY = 'iris.settings';

/** The widget: localStorage, wrapped in try/catch. `defaults` carries data-nudges. */
export function localSettings(defaults: IrisSettings = DEFAULT_SETTINGS): SettingsStorage {
  return {
    load() {
      try {
        const raw = localStorage.getItem(LOCAL_KEY);
        return Promise.resolve(normalise(raw ? JSON.parse(raw) : null, defaults));
      } catch {
        return Promise.resolve(defaults);
      }
    },
    save(settings) {
      try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(settings));
      } catch {
        // Storage blocked: the setting lasts until the page is closed.
      }
      return Promise.resolve();
    },
  };
}

/** The part of chrome.storage.local that settings need. */
export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** The extension: `{ settings: IrisSettings }` in chrome.storage.local. */
export function extensionSettings(area: StorageArea): SettingsStorage {
  return {
    async load() {
      try {
        const stored = await area.get('settings');
        return normalise(stored.settings, DEFAULT_SETTINGS);
      } catch {
        return DEFAULT_SETTINGS;
      }
    },
    async save(settings) {
      try {
        await area.set({ settings });
      } catch {
        // Storage failed: the setting lasts until the panel is closed.
      }
    },
  };
}
