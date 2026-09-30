import type { RiskCategory, RiskFlag, ScanResult, Severity } from '../../core/api';
import { useApp } from '../context';
import { stripLabel } from '../labels';
import { RiskTag } from './RiskTag';

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, info: 2 };

interface Group {
  category: RiskCategory;
  count: number;
  severity: Severity;
}

/** Risks grouped by category with counts, worst first. */
export function groupRisks(risks: readonly RiskFlag[]): Group[] {
  const groups = new Map<RiskCategory, Group>();
  for (const risk of risks) {
    const group = groups.get(risk.category);
    if (!group) {
      groups.set(risk.category, { category: risk.category, count: 1, severity: risk.severity });
    } else {
      group.count += 1;
      if (SEVERITY_RANK[risk.severity] < SEVERITY_RANK[group.severity]) {
        group.severity = risk.severity;
      }
    }
  }
  return [...groups.values()].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.count - a.count,
  );
}

/** Shown once the scan is ready; hidden while it's pending. */
export function PageStrip({ scan }: { scan: ScanResult | null }) {
  const app = useApp();
  if (scan?.status !== 'ready') return null;
  const groups = groupRisks(scan.risks).slice(0, 3);
  return (
    <section class="iris-strip" aria-label="This page">
      <span class="iris-strip__label">This page</span>
      {groups.length === 0 ? (
        <span class="iris-strip__clear">
          <span class="iris-dot iris-dot--info" aria-hidden="true" />
          Nothing worrying found
        </span>
      ) : (
        <>
          <span class="iris-strip__tags">
            {groups.map((group) => (
              <RiskTag
                key={group.category}
                severity={group.severity}
                label={stripLabel(group.category, group.count)}
              />
            ))}
          </span>
          <button
            type="button"
            class="iris-link-button"
            onClick={() => {
              app.review();
            }}
          >
            Review ▸
          </button>
        </>
      )}
      {!app.store.tour.value && (
        <button
          type="button"
          class="iris-link-button"
          onClick={() => {
            app.tourAction('start');
          }}
        >
          Walk me through ▸
        </button>
      )}
    </section>
  );
}
