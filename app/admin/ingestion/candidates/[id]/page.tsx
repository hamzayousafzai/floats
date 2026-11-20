import { notFound } from "next/navigation";
import { CandidateReviewForm } from "@/components/ingestion/candidate-review-form";
import { IngestionNav } from "@/components/ingestion/ingestion-nav";
import { requireAdminPage } from "@/lib/ingestion/security/require-admin-page";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function IngestionCandidatePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return (
    <main className="space-y-4">
      <h2 className="text-lg font-semibold">Review candidate</h2>
      <IngestionNav />
      <CandidateReviewForm candidateId={id} />
    </main>
  );
}
