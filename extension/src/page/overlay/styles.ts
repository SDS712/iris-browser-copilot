/**
 * Overlay styles. Overlay colours are fixed, not
 * themed, because they sit on other people's websites.
 */
export const OVERLAY_CSS = `
:host { all: initial; }
.layer {
  position: fixed; inset: 0; pointer-events: none;
  font-family: IrisInter, system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: #1C2B2A;
}
.box { position: fixed; pointer-events: none; opacity: 0; transition: opacity 320ms cubic-bezier(0.2, 0, 0, 1); }
.box.shown { opacity: 1; }
.ring {
  box-shadow: 0 0 0 2px #FFFFFF, 0 0 0 4px #0F766E, 0 0 0 8px rgba(15, 118, 110, 0.18);
}
.ring.risk {
  box-shadow: 0 0 0 2px #FFFFFF, 0 0 0 4px #B42318, 0 0 0 8px rgba(180, 35, 24, 0.18);
}
.marker { background: rgba(250, 204, 21, 0.38); border-radius: 3px; }
.marker.dark { background: rgba(250, 204, 21, 0.3); }
.badge {
  width: 18px; height: 18px; border-radius: 50%; box-sizing: border-box;
  background: #0F766E; color: #FFFFFF; border: 1px solid #FFFFFF;
  font: 600 11px/16px IrisInter, system-ui, sans-serif; text-align: center;
  font-variant-numeric: tabular-nums;
}
.bubble {
  position: fixed; top: 0; left: 0; max-width: 280px; box-sizing: border-box;
  padding: 12px 14px; border-radius: 10px; background: #FFFFFF; color: #1C2B2A;
  box-shadow: 0 8px 24px rgba(16, 24, 23, 0.18);
  font-size: 13px; line-height: 20px; pointer-events: auto;
  opacity: 0; transform: scale(0.96); transform-origin: left center;
  transition: opacity 200ms cubic-bezier(0.2, 0, 0, 1), transform 200ms cubic-bezier(0.2, 0, 0, 1);
}
.bubble.shown { opacity: 1; transform: none; }
.bubble-head { display: flex; align-items: center; gap: 6px; }
.bubble-title { font-weight: 600; }
.bubble p { margin: 4px 0 0; }
.bubble .tag { display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 12px; }
.bubble .dot { width: 8px; height: 8px; border-radius: 50%; box-sizing: border-box; }
.dot.high { background: #B42318; }
.dot.medium { background: #B54708; }
.dot.info { border: 1.5px solid #667085; }
.got-it {
  display: inline-block; margin-top: 6px; padding: 0; border: 0; background: none;
  color: #0F766E; font: inherit; font-weight: 600; cursor: pointer; text-decoration: underline;
  text-underline-offset: 2px;
}
.arrow { position: absolute; width: 8px; height: 8px; background: #FFFFFF; transform: rotate(45deg); }
.chip-wrap { position: fixed; top: 0; left: 0; opacity: 0; transition: opacity 200ms cubic-bezier(0.2, 0, 0, 1); }
.chip-wrap.shown { opacity: 1; }
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  height: 28px; padding: 0 12px 0 8px; box-sizing: border-box; border-radius: 999px;
  border: 1px solid #DDE3DF; background: #FFFFFF; color: #1C2B2A;
  box-shadow: 0 1px 2px rgba(16, 24, 23, 0.06), 0 4px 12px rgba(16, 24, 23, 0.1);
  font: 500 13px/20px IrisInter, system-ui, sans-serif; white-space: nowrap;
  pointer-events: auto; cursor: pointer;
}
.chip:focus-visible, .got-it:focus-visible { outline: 2px solid #0F766E; outline-offset: 2px; }
.sr-only {
  position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0);
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .box, .bubble, .chip-wrap { transition: opacity 120ms linear; transform: none; }
}
`;
