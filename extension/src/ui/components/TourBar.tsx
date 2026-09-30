import { ArrowLeft, ArrowRight, X } from 'lucide-preact';
import { useApp } from '../context';
import { RiskTag } from './RiskTag';

/**
 * The guided walkthrough's current stop: where it is, what this part
 * means, any risk found in it, and Back, Next and Stop.
 */
export function TourBar() {
  const app = useApp();
  const tour = app.store.tour.value;
  if (!tour) return null;
  const risks = (app.store.page.value?.scan?.risks ?? []).filter((risk) =>
    tour.risk_ids.includes(risk.id),
  );
  const last = tour.index + 1 >= tour.total;
  return (
    <section class="iris-card iris-card--tour" aria-label="Walkthrough" aria-live="polite">
      <header class="iris-card__header">
        <h3 class="iris-card__topic">
          Step {tour.index + 1} of {tour.total}
        </h3>
      </header>
      {tour.heading && <p class="iris-tour__heading">{tour.heading}</p>}
      <p class="iris-card__lead">{tour.say}</p>
      {risks.length > 0 && (
        <p class="iris-risk-tags">
          {risks.map((risk) => (
            <RiskTag key={risk.id} severity={risk.severity} category={risk.category} />
          ))}
        </p>
      )}
      <div class="iris-card__actions">
        <button
          type="button"
          class="iris-small-button"
          disabled={tour.index === 0}
          onClick={() => {
            app.tourAction('back');
          }}
        >
          <ArrowLeft size={16} strokeWidth={1.75} aria-hidden />
          Back
        </button>
        <button
          type="button"
          class="iris-small-button"
          onClick={() => {
            app.tourAction('next');
          }}
        >
          <ArrowRight size={16} strokeWidth={1.75} aria-hidden />
          {last ? 'Finish' : 'Next'}
        </button>
        <button
          type="button"
          class="iris-small-button"
          onClick={() => {
            app.tourAction('stop');
          }}
        >
          <X size={16} strokeWidth={1.75} aria-hidden />
          Stop
        </button>
      </div>
    </section>
  );
}
