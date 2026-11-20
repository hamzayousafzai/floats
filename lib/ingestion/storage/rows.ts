import type { AdapterType, CandidateStatus, DuplicateState, RunType, SourceType, TrustState } from "@/lib/ingestion/types";

export interface SourceRow {
  id: string;
  name: string;
  base_url: string;
  source_type: SourceType;
  adapter: AdapterType;
  trust_state: TrustState;
  enabled: boolean;
  discovery_only: boolean;
  crawl_delay_ms: number;
  configuration: Record<string, unknown>;
  valid_events: number;
  rejected_events: number;
  failed_runs: number;
  successful_runs: number;
  last_success_at: string | null;
  last_attempt_at: string | null;
  created_at: string;
  updated_at: string;
}

export type RunStatus = "running" | "succeeded" | "partial" | "failed";

export interface RunRow {
  id: string;
  run_type: RunType;
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
  sources_attempted: number;
  sources_succeeded: number;
  observations_found: number;
  candidates_created: number;
  candidates_published: number;
  candidates_review: number;
  error_summary: string | null;
  metadata: Record<string, unknown>;
}

export interface ObservationRow {
  id: string;
  source_id: string;
  run_id: string;
  external_event_id: string | null;
  source_url: string;
  raw_payload: Record<string, unknown>;
  content_hash: string;
  parser_version: string;
  observed_at: string;
}

export interface CandidateRow {
  id: string;
  primary_source_id: string;
  canonical_key: string;
  source_url: string;
  external_event_id: string | null;
  title: string;
  description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  timezone: "America/New_York";
  organizer_name: string | null;
  venue_name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  category_slugs: string[];
  vendor_count: number | null;
  vendor_evidence: string[];
  validation_reasons: string[];
  score: number;
  is_market: boolean;
  location_verified: boolean;
  vendor_verified: boolean;
  cancelled: boolean;
  duplicate_state: DuplicateState;
  status: CandidateStatus;
  manual_override: boolean;
  approved_by: string | null;
  published_event_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
  updated_at: string;
}

export type DiscoveryEvaluation = "pending" | "compatible" | "unsupported" | "restricted" | "rejected";

export interface DiscoveryRow {
  id: string;
  discovered_url: string;
  parent_source_id: string | null;
  evaluation: DiscoveryEvaluation;
  reason: string | null;
  adapter_detected: AdapterType | null;
  registered_source_id: string | null;
  discovered_at: string;
  evaluated_at: string | null;
}
