// Where the Buddy account lives: the API that holds Buddy's keys and the
// Supabase project that signs users in. Baked in at build time; a build
// without them has no account and runs on the user's own keys.

export const ACCOUNT = {
  apiUrl: (import.meta.env.MAIN_VITE_BUDDY_API_URL ?? '').replace(/\/$/, ''),
  supabaseUrl: projectUrl(import.meta.env.MAIN_VITE_SUPABASE_URL ?? ''),
  supabaseAnonKey: import.meta.env.MAIN_VITE_SUPABASE_ANON_KEY ?? '',
};

/**
 * The bare project origin. The dashboard hands out the REST endpoint
 * (`…supabase.co/rest/v1/`), and pasting that here breaks every auth call
 * with "Invalid path specified in request URL".
 */
function projectUrl(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/** Fixed so it can be listed once under Supabase → Authentication → Redirect URLs. */
export const LOOPBACK_PORT = 51780;
export const LOOPBACK_URL = `http://127.0.0.1:${LOOPBACK_PORT}/callback`;

export function accountConfigured(): boolean {
  return Boolean(ACCOUNT.apiUrl && ACCOUNT.supabaseUrl && ACCOUNT.supabaseAnonKey);
}
