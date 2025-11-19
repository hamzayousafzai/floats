import { createSupabaseServer } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import OrgManager from "./OrgManager"; // Import the client component

// This is now a pure Server Component.
export default async function AdminOrgsPage() {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return notFound();

  const { data: isAdmin } = await supabase.rpc('is_platform_admin', { p_user_id: user.id });
  if (!isAdmin) return notFound();

  const { data: orgs, error } = await supabase
    .from('orgs')
    .select('*')
    .is('archived_at', null) // Only get orgs that are not archived
    .order('name');

  if (error) {
    console.error("Error fetching orgs:", error);
    return <p className="p-6 text-error">Could not load organizations.</p>;
  }

  // It fetches the data and passes it as props to the client component.
  return <OrgManager orgs={orgs} />;
}