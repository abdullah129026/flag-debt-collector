import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const GATED = ['/dashboard', '/repos', '/settings'];

// Signed-in gate for the app routes. Signed-out visitors get a 307 to
// /login with the destination preserved; app chrome never flashes.
// The gate runs on cookie presence even when Supabase env is unset, so
// a missing env cannot leak a signed-in page as a 200 (project 4 bug).
export async function proxy(request) {
  const path = request.nextUrl.pathname;
  if (!GATED.some((p) => path === p || path.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let signedIn = false;

  if (url && key) {
    const response = NextResponse.next();
    const sb = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookies) {
          cookies.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    });
    const { data } = await sb.auth.getUser();
    signedIn = Boolean(data && data.user);
    if (signedIn) return response;
  } else {
    // No env: fall back to cookie presence. A Supabase auth cookie means
    // a session exists; without one, redirect. The page itself will 503
    // gracefully if the session cannot be verified.
    signedIn = request.cookies.getAll().some((c) => c.name.startsWith('sb-') && c.name.endsWith('-auth-token'));
    if (signedIn) return NextResponse.next();
  }

  const login = new URL('/login', request.url);
  login.searchParams.set('next', path);
  return NextResponse.redirect(login, 307);
}

export const config = {
  matcher: ['/dashboard/:path*', '/repos/:path*', '/settings/:path*'],
};
