// Server-side Supabase admin client for the official Norte Sul database.
// Vercel still contains a legacy/misnamed server credential. We never use it
// as a Supabase API key; it is only a high-entropy server-only credential for
// the official Edge Function bridge, which injects the real service role key.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const OFFICIAL_SUPABASE_URL = 'https://pzwjbitjersngordgcsh.supabase.co';
const OFFICIAL_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_8lqjNzJHLqVmGWSJoxHqQA_jSYMzoqX';
const ADMIN_BRIDGE_URL = `${OFFICIAL_SUPABASE_URL}/functions/v1/server-admin-bridge`;

function serverBridgeCredential(): string {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.AUTH_RATE_LIMIT_PEPPER || '';
  if (value.length < 32) {
    throw new Error('Missing server-only credential required for the official Supabase admin bridge.');
  }
  return value;
}

function createBridgeFetch(credential: string): typeof fetch {
  return async (input, init) => {
    const sourceRequest = typeof Request !== 'undefined' && input instanceof Request ? input : undefined;
    const rawUrl = sourceRequest?.url || String(input);
    const target = new URL(rawUrl, OFFICIAL_SUPABASE_URL);

    if (target.origin !== new URL(OFFICIAL_SUPABASE_URL).origin) {
      throw new Error('Blocked non-official Supabase admin target.');
    }

    const method = (init?.method || sourceRequest?.method || 'GET').toUpperCase();
    const originalHeaders = new Headers(sourceRequest?.headers);
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => originalHeaders.set(key, value));
    }

    const bridgeHeaders = new Headers({
      'x-cutover-key': credential,
      'x-proxy-path': `${target.pathname}${target.search}`,
      'x-proxy-method': method,
    });

    for (const name of ['content-type', 'accept', 'prefer', 'range', 'if-match', 'if-none-match', 'x-client-info', 'x-upsert', 'cache-control']) {
      const value = originalHeaders.get(name);
      if (value) bridgeHeaders.set(`x-forward-${name}`, value);
    }

    let body: BodyInit | null | undefined = init?.body;
    if (body == null && sourceRequest && method !== 'GET' && method !== 'HEAD') {
      body = await sourceRequest.clone().arrayBuffer();
    }

    return fetch(ADMIN_BRIDGE_URL, {
      method: 'POST',
      headers: bridgeHeaders,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      cache: 'no-store',
    });
  };
}

function createSupabaseAdminClient() {
  const credential = serverBridgeCredential();
  return createClient<Database>(OFFICIAL_SUPABASE_URL, OFFICIAL_SUPABASE_PUBLISHABLE_KEY, {
    global: {
      fetch: createBridgeFetch(credential),
    },
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

let _supabaseAdmin: ReturnType<typeof createSupabaseAdminClient> | undefined;

// Server-only admin client. The browser never receives the bridge credential.
export const supabaseAdmin = new Proxy({} as ReturnType<typeof createSupabaseAdminClient>, {
  get(_, prop, receiver) {
    if (!_supabaseAdmin) _supabaseAdmin = createSupabaseAdminClient();
    return Reflect.get(_supabaseAdmin, prop, receiver);
  },
});
