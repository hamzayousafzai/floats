import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';

export async function GET(req: NextRequest) {
  const requestUrl = new URL(req.url);
  // FIX: The token from our database is now called 'invite_token' in the URL
  const inviteToken = requestUrl.searchParams.get('invite_token');

  if (!inviteToken) {
    return NextResponse.redirect(`${requestUrl.origin}/login?error=Invalid invite link: No token provided.`);
  }

  const supabase = createRouteHandlerClient({ cookies });
  const supabaseAdmin = createSupabaseAdmin();

  // The magic link has already done its job. Exchanging the code for a session happens here.
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();

  // If the session exchange fails, the magic link was invalid or expired.
  if (sessionError || !session) {
    return NextResponse.redirect(`${requestUrl.origin}/login?error=Invalid or expired magic link. Please try again.`);
  }

  // Fetch the invite using our invite_token
  const { data: invite, error: inviteError } = await supabaseAdmin
    .from('org_invites')
    .select('*, orgs(slug)')
    .eq('token', inviteToken)
    .single();

  if (inviteError || !invite || !invite.orgs) {
    return NextResponse.redirect(`${requestUrl.origin}/?error=This invite is invalid or has expired.`);
  }

  // Security Check: Ensure the logged-in user's email matches the invite email.
  if (session.user.email !== invite.invitee_email) {
    return NextResponse.redirect(`${requestUrl.origin}/?error=Authentication mismatch. Please log in with the invited email address.`);
  }

  const orgSlug = invite.orgs.slug;

  // Add the user to the org_members table
  const { error: memberError } = await supabaseAdmin.from('org_members').insert({
    org_id: invite.org_id,
    user_id: session.user.id,
    role: invite.role,
  });

  if (memberError && memberError.code !== '23505') {
    return NextResponse.redirect(`${requestUrl.origin}/?error=Failed to add you to the organization.`);
  }

  // Clean up the used invite
  await supabaseAdmin.from('org_invites').delete().eq('id', invite.id);

  // Success! Redirect the now-logged-in user to their new host dashboard.
  return NextResponse.redirect(`${requestUrl.origin}/host/${orgSlug}`);
}