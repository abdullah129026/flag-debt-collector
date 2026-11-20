import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

export function configured() {
  return Boolean(
    process.env.SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

// Service-role client. Bypasses RLS, so it only runs in server code that
// has already checked ownership. Null when env is missing; routes fail
// closed with 503 instead of crashing.
let serviceClient = null;

export function service() {
  if (!configured()) return null;
  if (!serviceClient) {
    serviceClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return serviceClient;
}

// Browser client for the few client components that need one.
export function browserClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

// SSR client bound to the request cookies, for auth in routes and pages.
// Pass the response when the call must persist cookies (exchangeCodeForSession
// in the callback); without it, setAll is a no-op and only reads work.
export function serverClient(request, response) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookies) {
          if (!response) return;
          cookies.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );
}
