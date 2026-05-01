import { createSupabaseServer } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import EditOrgForm from "@/components/admin/EditOrgForm"; // We will create this next

export default async function EditOrgPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return notFound();

  // Secure this page
  const { data: isAdmin } = await supabase.rpc('is_platform_admin', { p_user_id: user.id });
  if (!isAdmin) return notFound();

  // Fetch the specific organization to edit
  const { data: org, error } = await supabase.from('orgs').select('*').eq('id', id).single();

  if (error || !org) {
    return notFound();
  }

  // This server component passes the org data to the client form component
  return <EditOrgForm org={org} />;
}