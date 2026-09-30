/** Interface copy. The backend writes every spoken line itself. */
export const COPY = {
  orb: {
    idle: 'Tap to talk',
    connecting: 'Connecting…',
    listening: 'Listening',
    muted: 'Mic off',
    error: 'Connection lost · Tap to retry',
    readingPage: 'Reading the page…',
    checkingTerms: 'Checking the terms…',
    lookingUp: 'Looking that up…',
    doingMaths: 'Doing the maths…',
    checkingSite: 'Checking the site…',
  },
  errors: {
    micBlocked: 'Iris needs your microphone to hear you.',
    cantRead: "I can't read this kind of page. Try me on a website.",
    partialPage: 'I could only read part of this page.',
    backendUnreachable:
      "I can't reach my tools right now, so I can't read this page. Try again in a moment.",
    dailyLimit: "The demo has hit today's limit. Please try again tomorrow.",
    closed: 'The live demo is closed for now. You can still watch the video.',
    timedOut: 'That session timed out. Tap to start again.',
    rateLimited: 'Too many requests, try again in a minute.',
  },
  agent: {
    backendUnreachable:
      "Iris's tools can't be reached right now. Tell the user briefly and suggest trying again in a moment.",
  },
  /** reply.create instructions for a line Iris must say as written. */
  sayExactly: (line: string) =>
    `Tell the user this now, keeping the meaning and every figure exactly: "${line}"`,
  /** Put before sayExactly when Iris speaks the result of something the user tapped. */
  tapped: (what: string) =>
    `The user tapped ${what} in the Iris interface. The card for it is on screen.`,
  /** reply.create instructions for a typed question or a tapped suggestion. */
  typed: (text: string) =>
    `The user typed this instead of speaking: "${text}". Respond to it exactly as if they had said it aloud.`,
  sessionEndingSoon:
    'Tell the user in one short sentence that this session ends in about a minute.',
  /**
   * The automatic site check's spoken warning: the trust result's own
   * say line, after "Before you log in:" or "Before you pay:".
   */
  trustWarning: (form: 'login' | 'payment' | null, say: string) => {
    const verb = form === 'login' ? 'log in' : form === 'payment' ? 'pay' : 'continue';
    const line = say.trim();
    return `Before you ${verb}: ${line.charAt(0).toLowerCase()}${line.slice(1)}`;
  },
  /** The card's lead already starts with the verdict ("Likely unsafe. Looks a lot like…"). */
  trustNotice: (lead: string) => `Site check: ${lead}`,
  trustChip: '⚠ Check this site',
  /** The question a tapped "Explain" beside a clause or price asks. */
  hoverQuestion: 'What does this mean?',
  /** Under the voice setting when it differs from the running session's. */
  voiceNextSession: 'Applies next time you start Iris.',
} as const;
