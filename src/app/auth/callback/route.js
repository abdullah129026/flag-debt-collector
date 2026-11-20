import { NextResponse } from 'next/server';
import { serverClient, service } from '@/lib/supabase';
import { readClaims, claimCookieValue } from '@/lib/auth';
import { sha256 } from '@/lib/validate';
import { log, logError } from '@/lib/log';

// Magic-link callback: exchanges the code for a session, attaches every
// anonymous scan the claim cookie names to the new account, redirects.
// First sign-in (new account) is the signup_completed analytics event;
// the client fires it from the landing page's callback handling in phase-4.
export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') || '/dashboard';
  const login = new URL('/login', url.origin);
  if (!code) {
    login.searchParams.set('error', 'expired');
    return NextResponse.redirect(login);
  }

  // Build the redirect response first: the session cookies the exchange
  // sets must land on it, or the sign-in is lost.
  const dest = new URL(next.startsWith('/') ? next : '/dashboard', url.origin);
  const response = NextResponse.redirect(dest);
  const sb = serverClient(request, response);
  if (!sb) {
    login.searchParams.set('error', 'send_failed');
    return NextResponse.redirect(login);
  }

  const { data, error } = await sb.auth.exchangeCodeForSession(code);
  if (error || !data || !data.user) {
    logError('auth.callback_exchange_failed', error, {});
    login.searchParams.set('error', 'expired');
    return NextResponse.redirect(login);
  }

  const userId = data.user.id;
  const claims = readClaims(request);
  const scanIds = Object.keys(claims);
  if (scanIds.length > 0) {
    const svc = service();
    if (svc) {
      for (const scanId of scanIds) {
        const { error: attachError } = await svc
          .from('scans')
          .update({ owner_id: userId })
          .eq('id', scanId)
          .eq('claim_hash', sha256(claims[scanId]))
          .is('owner_id', null);
        if (attachError) logError('auth.claim_attach_failed', attachError, { scan_id: scanId });
      }
      // Repos owned by those scans follow the scans.
      const { data: scanRows } = await svc.from('scans').select('repo_id').in('id', scanIds);
      const repoIds = [...new Set((scanRows || []).map((r) => r.repo_id).filter(Boolean))];
      if (repoIds.length > 0) {
        await svc.from('repos').update({ owner_id: userId }).in('id', repoIds).is('owner_id', null);
      }
    }
  }

  log('auth.callback_ok', { scans_attached: scanIds.length });
  // Keep the claim cookie: the public report still needs it for owner actions.
  response.cookies.set('fdc_claims', claimCookieValue(claims), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
