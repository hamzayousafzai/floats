"use server";

import { createSupabaseServer } from "@/lib/supabase/server";

export async function archiveOrgAction(orgId: string): Promise<{ error?: string }> {
  const supabase = await createSupabaseServer();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const { data: isAdmin } = await supabase.rpc('is_platform_admin', { p_user_id: user.id });
  if (!isAdmin) return { error: "Forbidden" };

  const { error } = await supabase
    .from('orgs')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', orgId);

  if (error) {
    console.error("Archive error:", error);
    return { error: "Failed to archive organization." };
  }
  return {};
}