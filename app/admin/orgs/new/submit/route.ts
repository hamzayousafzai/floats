import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
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

  // CRITICAL: Verify the user is a platform admin before proceeding.
  const { data: isAdmin, error: rpcError } = await supabase.rpc('is_platform_admin', { p_user_id: user.id });

  if (rpcError || !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { name, slug } = await request.json();

  if (!name || !slug) {
    return NextResponse.json({ error: 'Name and slug are required.' }, { status: 400 });
  }

  // Insert the new organization, setting the current user as the owner.
  const { error: insertError } = await supabase.from('orgs').insert({
    name,
    slug,
    owner_id: user.id,
  });

  if (insertError) {
    // Handle potential unique constraint violation for the slug
    if (insertError.code === '23505') {
      return NextResponse.json({ error: 'This slug is already in use. Please choose another.' }, { status: 409 });
    }
    console.error('Error creating organization:', insertError);
    return NextResponse.json({ error: 'Failed to create organization.' }, { status: 500 });
  }

  return NextResponse.json({ message: 'Organization created successfully' }, { status: 201 });
}