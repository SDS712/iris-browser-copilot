/**
 * The microphone permission page: a side panel can't show the prompt, so the
 * "Allow microphone" button opens this page in a tab. It asks once, stops the microphone
 * straight away, records the grant and closes itself.
 */
import { browser } from 'wxt/browser';

const status = document.getElementById('status');

async function ask(): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    await browser.storage.local.set({ mic_granted_at: new Date().toISOString() });
    if (status)
      status.textContent = 'Microphone allowed. You can close this tab and return to Iris.';
    setTimeout(() => {
      window.close();
    }, 2_000);
  } catch {
    if (status) {
      status.textContent =
        'Iris needs your microphone to hear you. Allow it from the icon in the address bar, then reload this page.';
    }
  }
}

void ask();
