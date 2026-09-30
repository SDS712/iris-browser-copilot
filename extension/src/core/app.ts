/**
 * The composition root shared by the side panel and the widget: it wires the store, the
 * voice session (real or mock), the page context and the tool router.
 */
import type { PageAdapter } from '../adapters/page-adapter';
import type { IrisApi } from './api';
import { browserAudio } from './audio/io';
import { PageContext } from './context';
import { COPY } from './copy';
import { JourneyTrail, memoryStorage, type JourneyStorage } from './journey';
import { Tour, tourCommand, type TourAction, type TourMode } from './tour';
import { memorySites, TrustWatch, type CheckedSites } from './trust-watch';
import { MockVoiceSession } from './mock-session';
import { isStopSuggesting, NudgeEngine } from './nudges';
import {
  VoiceSession,
  type SessionHandover,
  type SessionHooks,
  type StartOptions,
  type VoiceSessionLike,
} from './session';
import type { IrisSettings, SettingsStorage } from './settings';
import { cardHighlight } from './show-on-page';
import { addTranscriptLine, createStore, type IrisStore } from './store';
import { ToolRouter, type ToolOutcome } from './tools/router';

/** What differs between the side panel and the widget. */
export interface Platform {
  kind: 'extension' | 'widget';
  settings: SettingsStorage;
  /** Extension: opens the microphone permission tab. */
  openMicPermission?: () => void;
  /** Side panel: closes the panel. */
  close?: () => void;
  /** Widget: collapses the panel to the pill. */
  minimise?: () => void;
  /** Widget: expands the panel (a chip was tapped). The side panel is already open. */
  open?: () => void;
  /** Keyboard shortcut shown in settings (extension only). */
  shortcut?: string;
  /**
   * Widget: a running session carries on to the next page of the same site.
   * `shouldKeep` says whether the page is going to one; `save` stores the handover.
   */
  keepAcrossPageLoads?: {
    shouldKeep(): boolean;
    save(handover: SessionHandover): void;
  };
}

export interface IrisAppOptions {
  api: IrisApi;
  platform: Platform;
  mockVoice: boolean;
  /** URL of pcm-worklet.js (extension resource, next to the widget script, or dev harness). */
  workletUrl: string;
  debug: boolean;
  /** Dev harness only (voice picker). */
  adjustSession?: StartOptions['adjustSession'];
  /** The page Iris reads; none on pages it can't read. */
  adapter?: PageAdapter | null;
  /** Where the tab's journey lives; memory by default. */
  journeyStorage?: JourneyStorage;
  /** Sites already checked by the automatic trust check; memory by default. */
  checkedSites?: CheckedSites;
}

export interface IrisApp {
  readonly store: IrisStore;
  readonly session: VoiceSessionLike;
  readonly platform: Platform;
  readonly context: PageContext | null;
  readonly nudges: NudgeEngine | null;
  /** The tab's journey: its earlier pages and their summary. */
  readonly journey: JourneyTrail;
  /** Widget: carry on the session handed over by the previous page, quietly. */
  continueSession(handover: SessionHandover): void;
  /** The walkthrough's buttons: run it as if asked, and say the result. */
  tourAction(action: TourAction): void;
  /** Which walkthrough is running, if any. */
  tourMode(): TourMode | null;
  /** Starts following the page: register it now and whenever it changes. */
  openPage(): Promise<void>;
  /** Registers the latest snapshot if the page changed since the last one. */
  refreshPage(): Promise<void>;
  /** Runs a tool as the agent would (chips, "Review", IrisDebug.runTool). */
  runTool(name: string, args?: Record<string, unknown>): Promise<ToolOutcome>;
  /**
   * A tool the user started from the interface (a chip): show the card, and if a session is
   * running, have Iris say the result. `what` names what was tapped.
   */
  runFromInterface(name: string, args: Record<string, unknown>, what: string): Promise<ToolOutcome>;
  /** The main button: start a session with a greeting, or end the running one. */
  talk(): void;
  endSession(): Promise<void>;
  /** A typed question or a tapped suggestion. */
  sendText(text: string): void;
  toggleMute(): void;
  resumeAudio(): Promise<void>;
  setSetting<K extends keyof IrisSettings>(key: K, value: IrisSettings[K]): void;
  expandCard(id: string): void;
  /**
   * Highlights a card's elements on the page, stepping through them on each tap. For a
   * risk list, `riskIndex` picks one risk.
   */
  showOnPage(cardId: string, riskIndex?: number): void;
  /** "Review" on the page strip: a risk list card with every flag. */
  review(): void;
  copyText(text: string): void;
  /** Esc: stop Iris's current audio and clear the page's highlights. */
  escape(): void;
  dismissNotice(): void;
  /**
   * Extension: the microphone permission changed. Not granted shows the permission view
   * (while no session runs); granted restarts capture if a running session lost it.
   */
  onMicPermission(granted: boolean): void;
  dispose(): void;
}

export function createIrisApp(options: IrisAppOptions): IrisApp {
  const store = createStore();
  const { platform } = options;
  void platform.settings.load().then((settings) => {
    store.settings.value = settings;
  });

  const adapter = options.adapter ?? null;
  // Created below; the page context and nudges only call it once the app is running.
  let nudges: NudgeEngine | null = null;
  const trustWatch = new TrustWatch({
    api: options.api,
    store,
    nudges: () => nudges,
    checked: options.checkedSites ?? memorySites(),
  });
  const journey = new JourneyTrail({
    storage: options.journeyStorage ?? memoryStorage(),
    summarise: async (facts, previous) =>
      (await options.api.journeySummary(facts, previous)).summary,
    onChange: () => {
      context?.sendPageContext();
    },
  });
  const context = adapter
    ? new PageContext({
        api: options.api,
        store,
        adapter,
        session: () => session,
        excludeKeys: () => nudges?.excludeKeys() ?? [],
        onScan: (scan) => {
          nudges?.onScan(scan);
        },
        onNewDocument: () => {
          tour?.end();
          store.cards.value = [];
          store.expandedCard.value = null;
          store.highlightIds.value = [];
          nudges?.newDocument();
        },
        journey,
        onJourneyFinding: (finding) => {
          nudges?.onJourneyFinding(finding);
        },
        onNewDocumentRegistered: (snapshot, response) => {
          void trustWatch.onNewDocument(snapshot, response);
        },
      })
    : null;
  const tour = adapter
    ? new Tour({
        api: options.api,
        store,
        adapter,
        snapshot: () => context?.lastSnapshot ?? null,
        session: () => session,
      })
    : null;
  // A form walkthrough follows the user's clicks into the form.
  adapter?.onPageEvent((event) => {
    if (event.type === 'control-focus') tour?.onControlFocus(event.element_id);
  });
  const router = new ToolRouter({
    api: options.api,
    store,
    adapter,
    context,
    tour,
    pageUrl: () => store.page.value?.url ?? location.href,
    earlierPageIds: () => journey.earlierPageIds(),
    onActivity: () => {
      journey.touch();
    },
    submit: (callId, result, isError) => {
      session.submitToolResult(callId, result, isError);
    },
  });

  const hooks: SessionHooks = {
    onReady: () => {
      // A new session on the server (the first, or a fresh one after a refused resume).
      context?.onSessionEnded();
      context?.sendPageContext();
      nudges?.onSessionReady();
    },
    onResumed: () => {
      // The conversation carried on; this page (maybe a new one) may not be in it yet.
      context?.sendPageContext();
      nudges?.onSessionReady();
    },
    onToolCall: (call) => {
      void router.handle(call);
    },
    onUserFinal: (text) => {
      journey.touch();
      if (isStopSuggesting(text)) stopSuggesting();
    },
    onEnded: () => {
      tour?.end();
      store.session.nudgesOff.value = false;
      store.session.quietResume.value = false;
      context?.onSessionEnded();
    },
  };

  const session: VoiceSessionLike = options.mockVoice
    ? new MockVoiceSession({ store, hooks })
    : new VoiceSession({
        api: options.api,
        store,
        audio: browserAudio(options.workletUrl),
        hooks,
        log: options.debug
          ? (direction, type, detail) => {
              console.debug(`[Iris] ${direction === 'in' ? '←' : '→'} ${type}`, detail ?? '');
            }
          : undefined,
      });

  /** "Stop suggesting": no nudges or chips for the rest of this session. */
  const stopSuggesting = () => {
    store.session.nudgesOff.value = true;
    nudges?.hideChips();
  };

  const runFromInterface = async (name: string, args: Record<string, unknown>, what: string) => {
    const outcome = await router.run(name, args);
    // A local tool (the walkthrough) returns its line in the agent result.
    const local = outcome.agentResult.say;
    const say = outcome.toolResult?.say ?? (typeof local === 'string' ? local : undefined);
    if (say && session.isRunning) {
      session.createReply(`${COPY.tapped(what)} ${COPY.sayExactly(say)}`);
    }
    return outcome;
  };

  if (adapter) {
    nudges = new NudgeEngine({
      store,
      adapter,
      session: () => session,
      touring: () => store.tour.value !== null,
      actions: {
        openIris: () => platform.open?.(),
        async explainField(elementId) {
          if (!session.isRunning) void session.start({ greet: false });
          await runFromInterface('explain_field', { field_id: elementId }, 'Explain');
        },
        showRisks: () => void router.run('scan_page_risks', {}),
        explainHere: async (pointer) => {
          await runFromInterface('ask_page', { question: COPY.hoverQuestion, pointer }, 'Explain');
        },
        showTrust: () => {
          const trust = store.cards.value.find((entry) => entry.result?.card?.kind === 'trust');
          if (trust) store.expandedCard.value = trust.id;
          else void router.run('check_site_trust', {});
        },
        async cardForNudge(pageType, nudge) {
          if (pageType === 'checkout') await router.run('scan_page_risks', {});
          else if (nudge.risk_keys.some((key) => key.includes(':flat_rate_offer:'))) {
            await router.run('calculate_loan_cost', {});
          }
        },
      },
    });
    nudges.start();
  }

  // Closing the page or panel must end the session: a bare socket close keeps billing. The
  // widget going to another page of the same site hands the session over instead.
  const onPageHide = () => {
    const keep = platform.keepAcrossPageLoads;
    const handover = keep?.shouldKeep() ? session.handOver() : null;
    if (handover) keep?.save(handover);
    else session.endNow();
  };
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('beforeunload', onPageHide);

  // "Show on page" steps through a card's items on each tap.
  let step: { key: string; index: number } | null = null;

  return {
    store,
    session,
    platform,
    context,
    nudges,
    journey,
    tourAction(action) {
      const labels: Record<TourAction, string> = {
        start: 'Walk me through',
        next: 'Next',
        back: 'Back',
        repeat: 'Repeat',
        stop: 'Stop',
      };
      void runFromInterface('walk_through', { action }, labels[action]);
    },
    tourMode: () => tour?.mode ?? null,
    continueSession(handover) {
      store.session.quietResume.value = true;
      void session.start({ greet: false, resume: handover });
    },
    openPage: () => context?.start() ?? Promise.resolve(),
    refreshPage: () => context?.refresh() ?? Promise.resolve(),
    runTool: (name, args = {}) => router.run(name, args),
    runFromInterface,
    talk() {
      if (session.isRunning) void session.end();
      else void session.start({ greet: true, adjustSession: options.adjustSession });
    },
    endSession: () => session.end(),
    sendText: (text) => {
      journey.touch();
      // During a walkthrough, a typed "next" or "stop" is the button, not a question.
      const command = store.tour.value ? tourCommand(text) : null;
      if (command) {
        addTranscriptLine(store, 'you', text.trim());
        void runFromInterface('walk_through', { action: command }, `"${text.trim()}"`);
        return;
      }
      if (isStopSuggesting(text)) stopSuggesting();
      session.sendUserText(text);
    },
    toggleMute: () => {
      session.setMuted(!store.session.muted.value);
    },
    resumeAudio: () => session.resumeAudio(),
    setSetting(key, value) {
      const next = { ...store.settings.value, [key]: value };
      store.settings.value = next;
      void platform.settings.save(next);
      if (key === 'nudges' && !value) nudges?.hideChips();
    },
    expandCard(id) {
      store.expandedCard.value = id;
    },
    showOnPage(cardId, riskIndex) {
      const result = store.cards.value.find((entry) => entry.id === cardId)?.result;
      const request = result ? cardHighlight(result, riskIndex) : null;
      if (!request || !adapter) return;
      const key = `${cardId}:${String(riskIndex ?? '')}`;
      const index = step?.key === key ? (step.index + 1) % request.ids.length : 0;
      step = { key, index };
      void adapter.highlight({ ...request, focus: index }).then((shown) => {
        store.highlightIds.value = shown.found;
      });
    },
    review() {
      void router.run('scan_page_risks', {});
    },
    copyText(text) {
      void navigator.clipboard.writeText(text).catch(() => undefined);
    },
    escape() {
      session.stopAudio();
      store.highlightIds.value = [];
      void adapter?.clearHighlights().catch(() => undefined);
    },
    dismissNotice() {
      store.notice.value = null;
    },
    onMicPermission(granted) {
      store.micPrompt.value = !granted;
      if (granted) void session.retryMicrophone();
    },
    dispose() {
      context?.stop();
      nudges?.stop();
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onPageHide);
      session.endNow();
    },
  };
}
