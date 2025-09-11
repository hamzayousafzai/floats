import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const DEBUG = process.env.NODE_ENV === 'development';

export async function middleware(req: NextRequest) {
  // We need to create a response object to be able to set cookies
  const res = NextResponse.next();

  // Create a Supabase client configured to use cookies
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          // The middleware can modify the response cookies
          res.cookies.set({
            name,
            value,
            ...options,
          });
        },
        remove(name: string, options: CookieOptions) {
          // The middleware can delete response cookies
          res.cookies.set({
            name,
            value: '',
            ...options,
          });
        },
      },
    }
  );

  // This line is crucial. It refreshes the session if needed.
  await supabase.auth.getSession();

  // You can still keep your admin route protection logic here
  if (req.nextUrl.pathname.startsWith('/admin')) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      // Handle redirect for non-users trying to access admin
      const redirectUrl = req.nextUrl.clone();
      redirectUrl.pathname = '/login';
      return NextResponse.redirect(redirectUrl);
    }
    // ... add your admin role check if you have one
  }

  // Return the response object, which now has the updated cookies
  return res;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - api/auth (to avoid loops)
     */
    '/((?!_next/static|_next/image|favicon.ico|api/auth).*)',
  ],
};