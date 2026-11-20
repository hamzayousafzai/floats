import { IngestionNav } from "@/components/ingestion/ingestion-nav";
import { IngestionSummary } from "@/components/ingestion/ingestion-summary";
import { requireAdminPage } from "@/lib/ingestion/security/require-admin-page";

export const dynamic = "force-dynamic";

export default async function IngestionOverviewPage() {
  await requireAdminPage();
  return (
    <main className="space-y-4">
      <h2 className="text-lg font-semibold">Event ingestion</h2>
      <IngestionNav />
      <IngestionSummary />
    </main>
  );
}
