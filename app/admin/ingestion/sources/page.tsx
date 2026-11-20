import { IngestionNav } from "@/components/ingestion/ingestion-nav";
import { SourceTable } from "@/components/ingestion/source-table";
import { requireAdminPage } from "@/lib/ingestion/security/require-admin-page";

export const dynamic = "force-dynamic";

export default async function IngestionSourcesPage() {
  await requireAdminPage();
  return (
    <main className="space-y-4">
      <h2 className="text-lg font-semibold">Ingestion sources</h2>
      <IngestionNav />
      <SourceTable />
    </main>
  );
}
