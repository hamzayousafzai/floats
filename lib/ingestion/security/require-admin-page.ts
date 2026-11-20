import { notFound, redirect } from "next/navigation";
import { requireIngestionAdmin } from "@/lib/ingestion/security/require-admin";
import { ApiError } from "@/lib/ingestion/security/api-errors";

/**
 * Server-side gate for every ingestion admin page. Called from each page (not only a layout, which Next may skip on
 * client navigation). Anonymous users go to login; signed-in non-admins get a 404 so the area is not advertised.
 * The data APIs enforce the same check independently.
 */
export async function requireAdminPage(): Promise<void> {
  try {
    await requireIngestionAdmin();
  } catch (error) {
    if (error instanceof ApiError && error.code === "UNAUTHORIZED") redirect("/login");
    if (error instanceof ApiError && error.code === "FORBIDDEN") notFound();
    throw error;
  }
}
