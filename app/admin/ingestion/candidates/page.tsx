import { CandidateTable } from "@/components/ingestion/candidate-table";
import { IngestionNav } from "@/components/ingestion/ingestion-nav";
import { requireAdminPage } from "@/lib/ingestion/security/require-admin-page";

export const dynamic = "force-dynamic";

export default async function IngestionCandidatesPage() {
  await requireAdminPage();
  return (
    <main className="space-y-4">
      <h2 className="text-lg font-semibold">Ingestion candidates</h2>
      <IngestionNav />
      <CandidateTable />
    </main>
  );
}
