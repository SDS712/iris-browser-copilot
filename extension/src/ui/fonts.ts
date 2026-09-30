/**
 * Registers Inter as "IrisInter", so it never clashes with a page's own Inter.
 * FontFace objects are added to the document's font set, which Shadow DOM roots use too,
 * without adding anything to the page's <head>. If a site's security policy blocks the
 * files, text falls back to system-ui.
 */
const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
// Latin extended carries the rupee sign (U+20B9).
const LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

const WEIGHTS = [400, 500, 600] as const;
const SUBSETS = [
  ['latin', LATIN],
  ['latin-ext', LATIN_EXT],
] as const;

/** The woff2 files, as named by @fontsource/inter. */
export const FONT_FILES = WEIGHTS.flatMap((weight) =>
  SUBSETS.map(([subset]) => `inter-${subset}-${String(weight)}-normal.woff2`),
);

export function loadIrisFonts(urlFor: (file: string) => string, doc: Document = document): void {
  const fonts = doc.fonts as FontFaceSet | undefined;
  if (!fonts || typeof FontFace === 'undefined') return;
  for (const face of fonts) if (face.family === 'IrisInter') return;
  for (const weight of WEIGHTS) {
    for (const [subset, range] of SUBSETS) {
      const file = `inter-${subset}-${String(weight)}-normal.woff2`;
      fonts.add(
        new FontFace('IrisInter', `url(${urlFor(file)}) format('woff2')`, {
          weight: String(weight),
          style: 'normal',
          display: 'swap',
          unicodeRange: range,
        }),
      );
    }
  }
}
