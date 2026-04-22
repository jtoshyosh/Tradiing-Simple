import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');

  const isDev = process.env.NODE_ENV !== 'production';
  const siteURL = (process.env.NEXT_PUBLIC_SITE_URL || (isDev ? 'http://localhost:3000' : requestUrl.origin)).replace(/\/$/, '');

  if (!code) {
    return NextResponse.redirect(`${siteURL}/?authError=missing_code`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${siteURL}/?authError=oauth_exchange_failed`);
  }

  return NextResponse.redirect(`${siteURL}/`);
}
