/** What's sent where, in plain words. */
export function About({ onBack }: { onBack: () => void }) {
  return (
    <section class="iris-about" aria-labelledby="iris-about-title">
      <h2 id="iris-about-title" class="iris-about__title">
        About Iris and your privacy
      </h2>
      <p>
        Iris reads the page with you and points at what matters before you fill, agree, pay or
        trust. It never clicks, types or submits anything for you.
      </p>
      <p>
        When you open Iris, the page's visible text and the layout of its forms go to Iris's server
        so it can answer you. What you type into the page's fields never leaves the page: Iris only
        notes whether a field is filled.
      </p>
      <p>
        While a session is on, your voice goes to AssemblyAI, which runs the conversation. Page text
        is held in memory for 30 minutes and never stored or logged.
      </p>
      <button type="button" class="iris-small-button" onClick={onBack}>
        Back
      </button>
    </section>
  );
}
