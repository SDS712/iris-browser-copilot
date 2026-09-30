/** Every component in every state with fixture data, in light and dark. */
import { render, type ComponentChildren } from 'preact';
import { createIrisApp, type IrisApp } from '../src/core/app';
import { COPY } from '../src/core/copy';
import type { CardEntry, NoticeKind, SessionState } from '../src/core/store';
import { captionFor } from '../src/ui/components/Caption';
import { CardView } from '../src/ui/components/CardStack';
import { Footer } from '../src/ui/components/Footer';
import { LoadingCard } from '../src/ui/components/LoadingCard';
import { Notice } from '../src/ui/components/Notice';
import { Orb } from '../src/ui/components/Orb';
import { PageStrip } from '../src/ui/components/PageStrip';
import { Panel } from '../src/ui/components/Panel';
import { RiskTag } from '../src/ui/components/RiskTag';
import { SettingsPopover } from '../src/ui/components/SettingsPopover';
import { SourceBadge } from '../src/ui/components/SourceBadge';
import { VerdictChip } from '../src/ui/components/VerdictChip';
import { AppContext } from '../src/ui/context';
import { CATEGORY_LABELS } from '../src/ui/labels';
import { IRIS_CSS } from '../src/ui/styles';
import { SCANS, TOOL_RESULTS, type ToolFixture } from '../tests/fixtures/results';
import { harnessOptions } from './flags';

const STATES: SessionState[] = [
  'idle',
  'connecting',
  'listening',
  'hearing',
  'thinking',
  'speaking',
  'muted',
  'error',
];

function galleryApp(setup?: (app: IrisApp) => void): IrisApp {
  const app = createIrisApp({ ...harnessOptions(), mockVoice: true });
  setup?.(app);
  return app;
}

function entry(id: string, tool: ToolFixture): CardEntry {
  return { id, tool, caption: '', result: TOOL_RESULTS[tool] };
}

const CARD_FIXTURES: ToolFixture[] = [
  'ask_page',
  'ask_not_found',
  'explain_field',
  'scan_tool',
  'summarize',
  'web_lookup',
  'loan_cost',
  'site_trust',
  'site_trust_ok',
];

function Section({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="gallery__section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function WithApp({ app, children }: { app: IrisApp; children: ComponentChildren }) {
  return <AppContext.Provider value={app}>{children}</AppContext.Provider>;
}

function Frame({ app }: { app: IrisApp }) {
  return (
    <div class="gallery__frame">
      <WithApp app={app}>
        <Panel />
      </WithApp>
    </div>
  );
}

function activeApp(): IrisApp {
  return galleryApp((app) => {
    app.store.page.value = {
      page_id: 'pg_gallery',
      page_type: 'terms',
      url: 'https://iris.example.com/demo/terms',
      summary_for_agent: '',
      truncated: false,
      scan: SCANS.terms,
    };
    app.store.session.state.value = 'speaking';
    app.store.session.agentLive.value = 'Yes, with 30 days notice. It costs ₹499 in the first';
    app.store.cards.value = [
      entry('c1', 'ask_page'),
      entry('c2', 'explain_field_page'),
      entry('c3', 'loan_cost'),
    ];
    app.store.expandedCard.value = 'c1';
    app.store.session.transcript.value = [
      { id: 1, who: 'you', text: 'Can I cancel anytime?' },
      { id: 2, who: 'iris', text: TOOL_RESULTS.ask_page.say },
    ];
  });
}

function Theme({ theme }: { theme: 'light' | 'dark' }) {
  const shared = galleryApp();
  const notices: [NoticeKind, string][] = [
    ['error', COPY.errors.backendUnreachable],
    ['limit', COPY.errors.dailyLimit],
    ['closed', COPY.errors.closed],
    ['timeout', COPY.errors.timedOut],
    ['mic', COPY.errors.micBlocked],
    ['info', COPY.errors.partialPage],
    ['nudges_off', 'Nudges off'],
  ];
  return (
    <div class="gallery__theme iris-root" data-iris-theme={theme}>
      <WithApp app={shared}>
        <Section title="Orb states">
          <div class="gallery__row">
            {STATES.map((state) => (
              <div key={state} class="gallery__orb">
                <Orb size={32} state={state} />
                <span class="iris-caption">{captionFor(shared.store.session, state)}</span>
              </div>
            ))}
          </div>
          <div class="gallery__row">
            <Orb size={96} state="listening" />
            <Orb size={28} state="speaking" />
          </div>
        </Section>
      </WithApp>

      <Section title="Panels">
        <div class="gallery__row">
          <Frame
            app={galleryApp((app) => {
              app.store.page.value = {
                page_id: 'pg_w',
                page_type: 'checkout',
                url: '',
                summary_for_agent: '',
                truncated: false,
                scan: null,
              };
            })}
          />
          <Frame
            app={galleryApp((app) => {
              app.store.micPrompt.value = true;
            })}
          />
          <Frame app={activeApp()} />
          <Frame
            app={galleryApp((app) => {
              app.store.notice.value = { kind: 'limit', message: COPY.errors.dailyLimit };
            })}
          />
        </div>
      </Section>

      <Section title="Cards (expanded, latest first)">
        <div class="gallery__row">
          <WithApp app={shared}>
            <div class="gallery__column">
              {CARD_FIXTURES.slice(0, 5).map((tool, index) => (
                <CardView key={tool} entry={entry(tool, tool)} expanded latest={index === 0} />
              ))}
            </div>
            <div class="gallery__column">
              {CARD_FIXTURES.slice(5).map((tool) => (
                <CardView key={tool} entry={entry(tool, tool)} expanded latest={false} />
              ))}
              <LoadingCard caption={COPY.orb.checkingTerms} />
              {CARD_FIXTURES.map((tool) => (
                <CardView
                  key={`${tool}-c`}
                  entry={entry(`${tool}-c`, tool)}
                  expanded={false}
                  latest={false}
                />
              ))}
            </div>
          </WithApp>
        </div>
      </Section>

      <WithApp app={shared}>
        <Section title="Page strip">
          <div class="gallery__column">
            <PageStrip scan={SCANS.terms} />
            <PageStrip scan={SCANS.checkout} />
            <PageStrip
              scan={{ ...SCANS.terms, risks: [], counts: { high: 0, medium: 0, info: 0 } }}
            />
          </div>
        </Section>

        <Section title="Tags, badges and verdicts">
          <div class="gallery__row">
            {Object.keys(CATEGORY_LABELS).map((category, index) => (
              <RiskTag
                key={category}
                category={category as keyof typeof CATEGORY_LABELS}
                severity={(['high', 'medium', 'info'] as const)[index % 3] ?? 'info'}
              />
            ))}
          </div>
          <div class="gallery__row">
            <SourceBadge source="page" sourceCount={0} />
            <SourceBadge source="web" sourceCount={3} />
            <SourceBadge source="calculated" sourceCount={0} />
            <SourceBadge source="not_found" sourceCount={0} />
            <VerdictChip verdict="looks_ok" />
            <VerdictChip verdict="be_careful" />
            <VerdictChip verdict="likely_unsafe" />
          </div>
        </Section>

        <Section title="Notices">
          <div class="gallery__column">
            {notices.map(([kind, message]) => (
              <Notice key={kind} kind={kind} message={message} onDismiss={() => undefined} />
            ))}
          </div>
        </Section>

        <Section title="Settings and footer">
          <div class="gallery__row">
            <div class="gallery__column" style={{ position: 'relative', height: '220px' }}>
              <SettingsPopover onClose={() => undefined} onAbout={() => undefined} />
            </div>
            <div class="gallery__column">
              <Footer />
            </div>
          </div>
        </Section>
      </WithApp>
    </div>
  );
}

const style = document.createElement('style');
style.textContent = IRIS_CSS;
document.head.append(style);
const root = document.getElementById('gallery');
if (root) {
  render(
    <div class="gallery">
      <Theme theme="light" />
      <Theme theme="dark" />
    </div>,
    root,
  );
}
