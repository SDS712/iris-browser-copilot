import { useApp } from '../context';

/** "Always show captions": both sides' live words, large, above the cards. */
export function LiveCaptions() {
  const { store } = useApp();
  const you = store.session.userLive.value;
  const iris = store.session.agentLive.value;
  if (!you && !iris) return null;
  return (
    <section class="iris-live-captions" aria-label="Live captions">
      {you && (
        <p>
          <span class="iris-live-captions__who">You</span>
          {you}
        </p>
      )}
      {iris && (
        <p>
          <span class="iris-live-captions__who">Iris</span>
          {iris}
        </p>
      )}
    </section>
  );
}
