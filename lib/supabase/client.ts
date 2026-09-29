'use client';

import { createClient, type Session } from '@supabase/supabase-js';
import { getEmployeeSession } from './session';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: false,
  },
});

const goTrueGetSession = supabase.auth.getSession.bind(supabase.auth);
supabase.auth.getSession = async () => {
  const stored = getEmployeeSession();
  if (stored) {
    return { data: { session: stored as unknown as Session }, error: null };
  }
  return goTrueGetSession();
};