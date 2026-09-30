/**
 * Every fictional name and figure on the QuickCred demo, in one place. The
 * backend's tests and the live check depend on the figures: change them only with the spec.
 */
export const BRAND = {
  company: 'QuickCred',
  product: 'Nimbus 14',
  productLong: 'Nimbus 14 laptop',
  domain: 'quickcred.example',
  email: {
    support: 'support@quickcred.example',
    privacy: 'privacy@quickcred.example',
    grievance: 'grievance@quickcred.example',
  },
  phone: '+91 00000 00000',
  address: '12 Example Road, Pune 411001 (fictional address)',
  membership: 'QuickCred Plus',
  protection: 'QuickCred Shield',
  grievanceOfficer: 'A. Example, Grievance Officer',
} as const;

/** The offer and checkout figures, written as the pages show them. */
export const FIGURES = {
  price: '₹59,999',
  emi: '₹5,900',
  tenure: 12,
  rate: '1.5% p.m. flat',
  processingFee: '₹1,416',
  shieldPerYear: '₹1,299',
  plusPerMonth: '₹199',
  plusTrialDays: 30,
  warranty: '₹2,499',
  convenienceFee: '₹49',
  dueToday: '₹1,299',
  dueAtPay: '₹1,348',
} as const;
