import { createClient } from '@supabase/supabase-js'
import { type Database } from '@/lib/database.types'

// IMPORTANT: This client uses the SERVICE_ROLE_KEY and should only be used in secure
// server-side environments. It bypasses all RLS policies.
export const createSupabaseAdmin = () => {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase URL or Service Role Key is missing from environment variables.');
  }

  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}