import { createSupabaseServer } from "@/lib/supabase/server";
import AdminNewEventForm from "./form"; // Import the form component you just renamed

export const revalidate = 0;

// This is the new Server Component. Its job is to fetch data.
export default async function AdminNewEventPage() {
  const supabase = await createSupabaseServer();

  // Fetch all non-archived organizations to populate the dropdown
  const { data: orgs, error } = await supabase
    .from("orgs")
    .select("id, name")
    .is("archived_at", null)
    .order("name", { ascending: true });

  if (error) {
    return <p className="p-4 text-error">Error loading organizations: {error.message}</p>;
  }

  // Render the form component and pass the orgs data as a prop
  return <AdminNewEventForm orgs={orgs} />;
}