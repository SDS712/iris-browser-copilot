/** Contract-shaped backend results, captured from the backend in fake mode. */
import type { ScanResult, ToolResult } from '../../src/core/api';
import data from './backend-results.json';

export type ToolFixture =
  | 'ask_page'
  | 'ask_not_found'
  | 'summarize'
  | 'scan_tool'
  | 'explain_field'
  | 'explain_field_page'
  | 'web_lookup'
  | 'loan_cost'
  | 'site_trust'
  | 'site_trust_ok';

interface Fixtures {
  tool_results: Record<ToolFixture, ToolResult>;
  scans: { terms: ScanResult; checkout: ScanResult };
  pages: Record<string, { page_type: string; summary_for_agent: string }>;
}

export const FIXTURES = data as unknown as Fixtures;
export const TOOL_RESULTS = FIXTURES.tool_results;
export const SCANS = FIXTURES.scans;
