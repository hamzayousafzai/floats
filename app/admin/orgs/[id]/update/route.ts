import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();

  // Use the same createServerClient as the rest of your app
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.delete({ name, ...options });
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: isAdmin } = await supabase.rpc('is_platform_admin', { p_user_id: user.id });
  if (!isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { name, slug } = await request.json();
  const { id: orgId } = await params;

  if (!name || !slug) {
    return NextResponse.json({ error: 'Name and slug are required.' }, { status: 400 });
  }

  const { error: updateError } = await supabase
    .from('orgs')
    .update({ name, slug, updated_at: new Date().toISOString() })
    .eq('id', orgId);

  if (updateError) {
    if (updateError.code === '23505') {
      return NextResponse.json({ error: 'This slug is already in use.' }, { status: 409 });
    }
    console.error('Error updating organization:', updateError);
    return NextResponse.json({ error: 'Failed to update organization.' }, { status: 500 });
  }

  return NextResponse.json({ message: 'Organization updated successfully' });
}