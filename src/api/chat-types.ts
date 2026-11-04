/** Public transport contract only: safe to import from the browser. */
import type { Version } from './types.ts';

export type Language = 'fil' | 'en';
export type Stage = Version | 'house' | 'gaa';
export interface ChatRequest {
  message: string;
  language?: Language;
  context?: { projectKey?: string; snapshotId?: string };
  filters?: { year?: number; program?: string; projectKey?: string; stage?: Stage };
  /** Old assistant text is untrusted conversation, never evidence. */
  history?: { user: string; assistant: string }[];
}
export interface Source {
  id: string;
  title: string;
  url: string;
  page?: number;
  recordKey?: string;
}
export interface Fact {
  id: string;
  label: string;
  kind: 'amount' | 'count' | 'difference';
  value: number | null;
  unit: 'PHP' | 'records' | 'families';
  year: number;
  stage: Stage | 'house-minus-nep';
  sourceIds: string[];
  /** A partial sum has missingCount > 0; an entirely missing sum is null. */
  availableCount: number;
  missingCount: number;
  recordKey?: string;
}
export interface ChatResponse {
  mode: 'ai' | 'reference' | 'clarification' | 'no_data';
  answer: string;
  facts: Fact[];
  sources: Source[];
  citationIds: string[];
  factIds: string[];
  aiUnavailable?: true;
  snapshot: { id: string; collectedAt: string; stale: boolean; notice: string };
  provenance: {
    snapshotId: string;
    filter: { year: number | null; stages: Stage[]; program: string | null; projectKey: string | null; keywords: string[] };
    matchedCount: number;
    recordKeys: string[];
    sourceIds: string[];
    coverage: string;
  };
}
export interface ChatError {
  error: {
    code: 'invalid_request' | 'method_not_allowed' | 'payload_too_large' | 'unavailable' | 'not_found';
    message: string;
  };
}
