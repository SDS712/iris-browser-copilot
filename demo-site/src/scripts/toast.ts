/** The demo toast: "This is a demo. Nothing was sent." */
export const DEMO_TOAST = 'This is a demo. Nothing was sent.';

let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(message: string = DEMO_TOAST): void {
  const toast = document.getElementById('qc-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => {
    toast.hidden = true;
  }, 4_000);
}
