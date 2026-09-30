/** Every Iris stylesheet as one string, injected once into Iris's root. */
import base from './base.css?inline';
import caption from './caption.css?inline';
import cards from './cards.css?inline';
import chrome from './chrome.css?inline';
import footer from './footer.css?inline';
import orb from './orb.css?inline';
import panel from './panel.css?inline';
import tokens from './tokens.css?inline';
import transcript from './transcript.css?inline';

export const IRIS_CSS = [tokens, base, panel, orb, caption, transcript, footer, cards, chrome].join(
  '\n',
);
