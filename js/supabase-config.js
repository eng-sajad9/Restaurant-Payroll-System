/**
 * supabase-config.js
 * Supabase configuration fallback layer mapping to Local IndexedDB service.
 *
 * ⚠️  CRITICAL LOADING ORDER:
 *  The Supabase CDN script sets  window.supabase = { createClient, ... }
 *  We MUST capture that reference BEFORE we overwrite window.supabase
 *  with the offline mock adapter. Without this the realSupabase client
 *  is never created and ALL cloud features break silently.
 */

// ─── Step 1: Save real SDK reference BEFORE mock overwrites it ────────────────
const _SupabaseSDK = (typeof supabase !== 'undefined' && typeof supabase.createClient === 'function')
    ? supabase
    : null;

// ─── Step 2: Bind offline-first mock adapter to window.supabase ───────────────
window.supabase = window.mockSupabase;

const db = { /* Mock db shim */ };

// ─── Step 3: Initialise real cloud client using the saved SDK ref ─────────────
window.SUPABASE_URL      = 'https://qimrmwwksfrwfdcuhiiq.supabase.co';
window.SUPABASE_ANON_KEY = 'sb_publishable_Dzjsbg7dUWBZ21k-uNwJNg_S9C1k_Lf';

if (_SupabaseSDK) {
    try {
        window.realSupabase = _SupabaseSDK.createClient(
            window.SUPABASE_URL,
            window.SUPABASE_ANON_KEY,
            {
                realtime: { params: { eventsPerSecond: 10 } }
            }
        );
        console.log('[Supabase Config] ✅ realSupabase client initialised successfully.');
    } catch (err) {
        console.error('[Supabase Config] ❌ Failed to create realSupabase client:', err);
        window.realSupabase = null;
    }
} else {
    console.warn('[Supabase Config] ⚠️  Supabase SDK not found — cloud bridge disabled.');
    window.realSupabase = null;
}
