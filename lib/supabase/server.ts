import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/** Server client for Server Components (read-only cookies) */
export async function createSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
      },
    }
  );
}

/** Server client for Route Handlers / Server Actions (read-write cookies if needed) */
export async function createSupabaseServerRW(setCookie?: (name: string, value: string, options: CookieOptions) => void,
                                             delCookie?: (name: string, options: CookieOptions) => void) {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          // If you need to mutate cookies in a Route Handler,
          // prefer wiring through NextResponse in that handler and pass setters in here.
          if (setCookie) setCookie(name, value, options);
        },
        remove(name: string, options: CookieOptions) {
          if (delCookie) delCookie(name, options);
        },
      },
    }
  );
}
