import { createIrisApp } from '../src/core/app';
import { mountPanel } from '../src/ui/mount';
import { harnessOptions } from './flags';

// The English voices and the test script.
const VOICES = [
  'alba',
  'eve',
  'george',
  'jane',
  'jean',
  'mary',
  'michael',
  'anna',
  'charles',
  'paul',
  'vera',
];
const SCRIPT =
  'Heads up: this sets up a NACH auto-debit of ₹4,999 a month through UPI AutoPay. ' +
  'Your IFSC code looks like SBIN0001234. ' +
  'Paying the loan off early costs 4% plus GST on ₹1,00,000.';

const select = document.getElementById('voice') as HTMLSelectElement | null;
const script = document.getElementById('script');
const read = document.getElementById('read');
const root = document.getElementById('iris-harness-panel');

if (select && script && read && root) {
  for (const voice of VOICES) select.append(new Option(voice, voice));
  script.textContent = SCRIPT;
  const app = createIrisApp({
    ...harnessOptions(),
    mockVoice: false,
    adjustSession: (session) => ({
      ...session,
      output: { ...session.output, voice: select.value },
    }),
  });
  mountPanel(root, app);
  read.addEventListener('click', () => {
    app.session.createReply(
      `Read the following out loud exactly as written, word for word, and say nothing else: "${SCRIPT}"`,
    );
  });
}
