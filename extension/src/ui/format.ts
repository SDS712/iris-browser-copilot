/** Display formatting only: every figure comes from the backend's code. */
const INR = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** ₹ with Indian digit grouping: ₹1,00,000. */
export function formatInr(amount: number): string {
  return `₹${INR.format(amount)}`;
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}
