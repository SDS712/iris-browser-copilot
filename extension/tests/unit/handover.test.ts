import { describe, expect, it } from 'vitest';
import {
  HANDOVER_KEY,
  HANDOVER_MAX_AGE_MS,
  saveHandover,
  takeHandover,
  watchLeaving,
} from '../../src/widget/handover';

describe('handing a session to the next page', () => {
  it('is taken once, while it is still fresh enough to resume', () => {
    saveHandover({ session_id: 'sess_1', started_at: 100 }, true, sessionStorage, 1_000);
    expect(takeHandover(sessionStorage, 1_000 + HANDOVER_MAX_AGE_MS)).toEqual({
      session_id: 'sess_1',
      started_at: 100,
      at: 1_000,
      muted: true,
    });
    expect(takeHandover(sessionStorage, 1_000)).toBeNull();
    saveHandover({ session_id: 'sess_2', started_at: 100 }, false, sessionStorage, 1_000);
    expect(takeHandover(sessionStorage, 1_001 + HANDOVER_MAX_AGE_MS)).toBeNull();
    sessionStorage.setItem(HANDOVER_KEY, 'not json');
    expect(takeHandover(sessionStorage)).toBeNull();
  });

  it("carries the session's voice, and drops one it doesn't know", () => {
    saveHandover({ session_id: 's', started_at: 1, voice: 'male' }, false, sessionStorage, 1_000);
    expect(takeHandover(sessionStorage, 1_000)?.voice).toBe('male');
    sessionStorage.setItem(
      HANDOVER_KEY,
      JSON.stringify({ session_id: 's', started_at: 1, at: 1_000, voice: 'robot' }),
    );
    expect(takeHandover(sessionStorage, 1_000)).not.toHaveProperty('voice');
  });

  it('keeps the session only for a navigation to another page of this site', () => {
    const navigation = new EventTarget();
    const win = {
      navigation,
      location: { origin: 'https://shop.example' },
    } as unknown as Window;
    const leaving = watchLeaving(win);
    const navigate = (url: string, extra: Record<string, unknown> = {}) => {
      const event = Object.assign(new Event('navigate'), {
        destination: { url, sameDocument: false },
        downloadRequest: null,
        ...extra,
      });
      navigation.dispatchEvent(event);
    };
    expect(leaving()).toBe(false);
    navigate('https://other.example/');
    expect(leaving()).toBe(false);
    navigate('https://shop.example/checkout');
    expect(leaving()).toBe(true);
    navigation.dispatchEvent(new Event('navigateerror'));
    expect(leaving()).toBe(false);
    navigate('https://shop.example/terms.pdf', { downloadRequest: 'terms.pdf' });
    expect(leaving()).toBe(false);
  });

  it('never keeps it in browsers without the Navigation API', () => {
    const win = { location: { origin: 'https://shop.example' } } as unknown as Window;
    expect(watchLeaving(win)()).toBe(false);
  });
});
