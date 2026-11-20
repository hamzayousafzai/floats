import type { AdapterType } from "@/lib/ingestion/types";
import { type AdapterDeps } from "./common";
import { createHtmlAdapter } from "./html";
import { createIcsAdapter } from "./ics";
import { createJsonLdAdapter } from "./jsonld";
import { createPlaywrightAdapter, type PlaywrightAdapterDeps } from "./playwright";
import { createEstherElsaAdapter } from "./sources/esther-elsa";
import { createMakersMarketCltAdapter } from "./sources/makers-market-clt";
import { createUrbanDistrictMarketAdapter } from "./sources/urban-district-market";
import type { EventAdapter, SourceDefinition } from "./types";

export interface AdapterRegistry {
  /** Returns the source-specific adapter when `configuration.adapterKey` names one, otherwise the generic adapter. */
  resolve(source: SourceDefinition): EventAdapter;
  register(key: string, adapter: EventAdapter): void;
}

export class UnknownAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnknownAdapterError";
  }
}

export function createAdapterRegistry(deps: AdapterDeps, playwright?: PlaywrightAdapterDeps): AdapterRegistry {
  const generic = new Map<AdapterType, EventAdapter>([
    ["jsonld", createJsonLdAdapter(deps)],
    ["ics", createIcsAdapter(deps)],
    ["html", createHtmlAdapter(deps)],
  ]);
  if (playwright) generic.set("playwright", createPlaywrightAdapter(playwright));
  const specific = new Map<string, EventAdapter>([
    ["makers-market-clt", createMakersMarketCltAdapter(deps)],
    ["urban-district-market", createUrbanDistrictMarketAdapter(deps)],
    ["esther-elsa", createEstherElsaAdapter(deps)],
  ]);

  return {
    register(key, adapter) {
      specific.set(key, adapter);
    },
    resolve(source) {
      const key = source.configuration.adapterKey;
      if (typeof key === "string") {
        const adapter = specific.get(key);
        if (!adapter) throw new UnknownAdapterError(`No source adapter registered for key "${key}"`);
        return adapter;
      }
      const adapter = generic.get(source.adapter);
      if (!adapter) throw new UnknownAdapterError(`No adapter available for type "${source.adapter}"`);
      return adapter;
    },
  };
}
