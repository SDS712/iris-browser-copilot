/** A collapsed placeholder that shimmers while a tool runs. */
export function LoadingCard({ caption }: { caption: string }) {
  return (
    <div class="iris-card iris-card--loading" aria-busy="true">
      <span class="iris-card__loading-text">{caption}</span>
    </div>
  );
}
