/**
 * supabase-config.js
 * Supabase configuration fallback layer mapping to Local IndexedDB service.
 */

// Initialize the mock Supabase client adapter from db-service
window.supabase = window.mockSupabase;

const db = {
    // Mock db object shim
};

// ─── Real Supabase Client Configuration (Cloud Bridge Engine) ────────────────
// These credentials are used in the background to sync with the online DB.
// Update these placeholders with your actual Supabase URL and public anon key.
window.SUPABASE_URL = window.SUPABASE_URL || 'https://your-project.supabase.co';
window.SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';

// Instantiate the real Supabase client if the official SDK is loaded
if (typeof supabase !== 'undefined' && typeof supabase.createClient === 'function') {
    try {
        window.realSupabase = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
        console.log('[Supabase Config] Real Supabase client successfully initialized.');
    } catch (err) {
        console.warn('[Supabase Config] Failed to initialize real Supabase client:', err);
    }
} else {
    console.warn('[Supabase Config] Supabase library is not loaded. Realtime sync will be disabled.');
}
