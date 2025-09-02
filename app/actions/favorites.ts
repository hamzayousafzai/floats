"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/** Toggle user’s favorite for a vendor. Requires auth. */
export async function toggleFavorite(vendorId: string, revalidate: string | string[] = []) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => cookieStore.get(name)?.value,
        set() {}, remove() {},
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Check current state
  const { data: existing, error: checkErr } = await supabase
    .from("favorites")
    .select("user_id, vendor_id")
    .eq("user_id", user.id)
    .eq("vendor_id", vendorId)
    .maybeSingle();

  if (checkErr) throw new Error(checkErr.message);

  if (existing) {
    const { error: delErr } = await supabase
      .from("favorites")
      .delete()
      .eq("user_id", user.id)
      .eq("vendor_id", vendorId);
    if (delErr) throw new Error(delErr.message);
  } else {
    const { error: insErr } = await supabase
      .from("favorites")
      .insert({ user_id: user.id, vendor_id: vendorId });
    if (insErr) throw new Error(insErr.message);
  }

  // Revalidate any paths that show favorite state
  const paths = Array.isArray(revalidate) ? revalidate : [revalidate];
  for (const p of paths) if (p) revalidatePath(p);
  revalidatePath("/profile");
  return { ok: true, favorited: !existing };
}
