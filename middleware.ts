import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const DEBUG = process.env.NODE_ENV === 'development';

export async function middleware(req: NextRequest) {
  let res = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => req.cookies.get(name)?.value,
        set: (name: string, value: string, options: any) => {
          res.cookies.set({ name, value, ...options });
        },
        remove: (name: string, options: any) => {
          res.cookies.delete({ name, ...options });
        },
      },
    }
  );

  if (req.nextUrl.pathname.startsWith('/admin')) {
    // Use getUser() (contacts auth server, verified)
    const { data: { user }, error: userErr } = await supabase.auth.getUser();

    if (DEBUG && userErr) console.log('middleware getUser error', userErr);
    if (!user) {
      const redirectUrl = req.nextUrl.clone();
      redirectUrl.pathname = '/login';
      redirectUrl.searchParams.set('redirectedFrom', req.nextUrl.pathname);
      return NextResponse.redirect(redirectUrl);
    }

    // Check admin table
    const { data: adminRow, error: adminErr } = await supabase
      .from('app_admins')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (DEBUG) {
      console.log('middleware user.id', user.id, 'adminRow?', !!adminRow, 'adminErr?', adminErr?.message);
    }

    if (!adminRow) {
      const redirectUrl = req.nextUrl.clone();
      redirectUrl.pathname = '/map';
      return NextResponse.redirect(redirectUrl);
    }
  }

  return res;
}

export const config = {
  matcher: '/admin/:path*',
};