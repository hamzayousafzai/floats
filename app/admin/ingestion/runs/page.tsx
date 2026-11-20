import { IngestionNav } from "@/components/ingestion/ingestion-nav";
import { RunTable } from "@/components/ingestion/run-table";
import { requireAdminPage } from "@/lib/ingestion/security/require-admin-page";

export const dynamic = "force-dynamic";

export default async function IngestionRunsPage() {
  await requireAdminPage();
  return (
    <main className="space-y-4">
      <h2 className="text-lg font-semibold">Ingestion runs</h2>
      <IngestionNav />
      <RunTable />
    </main>
  );
}
