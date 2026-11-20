import type { AdapterType, CollectionResult } from "@/lib/ingestion/types";

export interface SourceDefinition {
  id: string;
  name: string;
  baseUrl: string;
  adapter: AdapterType;
  crawlDelayMs: number;
  configuration: Record<string, unknown>;
}

export interface CollectionContext {
  runId: string;
  now: Date;
  horizonDays: number;
  signal: AbortSignal;
}

export interface EventAdapter {
  type: AdapterType;
  collect(source: SourceDefinition, context: CollectionContext): Promise<CollectionResult>;
}
