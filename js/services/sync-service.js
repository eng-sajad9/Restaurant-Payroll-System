/**
 * sync-service.js
 * Cloud Bridge — bi-directional synchronisation pipeline.
 *
 * Responsibilities:
 *  1. Pull pending_deductions from Supabase → save to local IndexedDB → notify manager UI instantly
 *  2. Push active_employees from local IndexedDB → upsert to Supabase (Reverse Sync)
 *  3. Manage the global sync-indicator widget
 */

// ─── Sync States ──────────────────────────────────────────────────────────────
const SyncState = {
    OFFLINE:  'Offline',
    SYNCING:  'Syncing',
    SYNCED:   'Synced/Idle',
    ERROR:    'Error'
};

let currentSyncState = SyncState.SYNCED;
let isSyncInProgress  = false;
let syncChannel       = null;   // Realtime channel for pending_deductions

// ─────────────────────────────────────────────────────────────────────────────
// SECTION A — Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Downloads image from a URL and converts it to a Base64 data-URI string.
 * @param {string} url
 * @returns {Promise<string|null>}
 */
async function imageToBase64(url) {
    if (!url) return null;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror  = () => reject(new Error('FileReader failed'));
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error('[Sync Engine] Image base64 conversion failed:', error);
        throw error;
    }
}

/**
 * Extracts storage relative path from public Supabase bucket URL.
 * e.g. "https://...supabase.co/storage/v1/object/public/deductions_images/emp/uuid.jpg"
 *       → "emp/uuid.jpg"
 */
function getStoragePathFromUrl(imageUrl) {
    const bucketToken = '/deductions_images/';
    const index = imageUrl.indexOf(bucketToken);
    if (index === -1) return imageUrl.substring(imageUrl.lastIndexOf('/') + 1);
    return decodeURIComponent(imageUrl.substring(index + bucketToken.length));
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION B — IndexedDB Extension
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Saves a processed cloud deduction permanently in local Dexie IndexedDB
 * and cascades the amount to the local salary record.
 */
window.dbService.addDeductionToLocalDraft = async function (deduction) {
    const record = {
        id:          deduction.id          || generateUUID(),
        employee_id: deduction.employee_id,
        month:       deduction.month       || getCurrentMonth(),
        amount:      deduction.amount      || 0,
        note:        deduction.reason      || '',
        image_data:  deduction.image_data,
        added_by:    deduction.supervisor_name || 'Supervisor (Cloud Bridge)',
        added_at:    deduction.created_at  || new Date().toISOString()
    };

    await this.insert('deduction_logs', record);

    if (typeof syncDeductionToSalary === 'function') {
        try {
            await syncDeductionToSalary(
                deduction.employee_id,
                record.month,
                record.note,
                record.added_by,
                record.added_at
            );
        } catch (cascadeErr) {
            console.warn('[Sync Engine] Salary cascade warning:', cascadeErr);
        }
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION C — Reverse Sync: Push employees → Supabase
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches all active employees from local IndexedDB and upserts them into the
 * Supabase `active_employees` table so the online Supervisor app can read them.
 *
 * Call this function from employees.js after:
 *   • saveEmployee()    (add / update)
 *   • deleteEmployee()  (delete — pass the deleted id to remove it)
 *   • bulkDeleteEmployees()
 *
 * @param {string|null} deletedId - If provided, this employee id is also
 *   deleted from the cloud table (used when an employee is removed locally).
 */
async function syncEmployeesToCloud(deletedId = null) {
    if (!window.realSupabase) {
        console.warn('[Reverse Sync] realSupabase not available — skipping employee sync.');
        return;
    }

    try {
        // 1. Fetch all employees from local IndexedDB
        const { data: localEmps, error: fetchErr } = await window.supabase
            .from('employees')
            .select('*');

        if (fetchErr) throw fetchErr;

        // Local driver checker to avoid uploading drivers
        const isEmpDriver = (role) => {
            const r = (role || '').toLowerCase();
            return r.includes('driver') || r.includes('delivery') ||
                r.includes('سائق') || r.includes('توصيل') || r.includes('دليفري');
        };

        const employees = (localEmps || []).filter(e => !isEmpDriver(e.role));

        // 2. Format to minimal { id, name, role } shape (Reverse Sync payload)
        const payload = employees.map(e => ({ 
            id: String(e.id), 
            name: e.name,
            role: e.role || '' // Essential for supervisor badge display
        }));

        // 3. Clear all old rows on Supabase to prevent stale/deleted employees from lingering
        const { error: clearErr } = await window.realSupabase
            .from('active_employees')
            .delete()
            .neq('id', ''); // Match all records

        if (clearErr) {
            console.warn('[Reverse Sync] Stale rows cleanup warning:', clearErr.message);
        }

        // 4. Bulk insert the fresh list of active employees
        if (payload.length > 0) {
            const { error: insertErr } = await window.realSupabase
                .from('active_employees')
                .insert(payload);

            if (insertErr) throw insertErr;
            console.log(`[Reverse Sync] 🔄 Sync complete. Uploaded ${payload.length} active employees to cloud.`);
        } else {
            console.log(`[Reverse Sync] 🔄 Sync complete. No active employees found locally.`);
        }

    } catch (err) {
        console.warn('[Reverse Sync] Employee sync to cloud failed:', err.message);
    }
}

// Expose globally so employees.js can call it without import
window.syncEmployeesToCloud = syncEmployeesToCloud;

// ─── Polling Fallback Timer ──────────────────────────────────────────────────
let syncPollInterval = null;

function startSyncPolling() {
    if (syncPollInterval) clearInterval(syncPollInterval);
    
    // Poll every 10 seconds as a robust fallback for realtime subscription
    syncPollInterval = setInterval(async () => {
        if (!navigator.onLine || isSyncInProgress || !window.realSupabase) return;
        
        const currentUser = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
        if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'manager')) return;

        try {
            const { data, error } = await window.realSupabase
                .from('pending_deductions')
                .select('*')
                .order('created_at', { ascending: true });

            if (!error && data && data.length > 0) {
                console.log(`[Sync Poller] 🔍 Found ${data.length} pending deductions on cloud queue.`);
                isSyncInProgress = true;
                updateSyncIndicator(SyncState.SYNCING);
                
                for (const row of data) {
                    await processIncomingDeduction(row);
                }
                
                updateSyncIndicator(SyncState.SYNCED);
                isSyncInProgress = false;
            }
        } catch (pollErr) {
            console.warn('[Sync Poller] Periodic check warning:', pollErr);
            isSyncInProgress = false;
        }
    }, 10000);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION D — Forward Sync: Pull deductions from Supabase → IndexedDB
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fires all necessary UI refresh calls after a deduction is processed.
 * This is the key function that makes the manager app update in real-time
 * without requiring a page refresh.
 */
async function _refreshManagerUI(employeeName) {
    // 1. Invalidate any in-memory caches
    if (window.appCache && typeof window.appCache.invalidate === 'function') {
        window.appCache.invalidate('deduction_logs');
        window.appCache.invalidate('salaries');
    }
    if (typeof invalidateCache === 'function') {
        invalidateCache('deduction_logs');
        invalidateCache('salaries');
    }

    // 2. Re-render the salary table if that page is currently active
    const salPage = document.getElementById('page-salaries');
    if (salPage && salPage.classList.contains('active')) {
        if (typeof loadSalaries === 'function') {
            try { await loadSalaries(typeof _salMonth !== 'undefined' ? _salMonth : getCurrentMonth()); }
            catch (e) { console.warn('[Sync UI] loadSalaries failed:', e); }
        }
    }

    // 3. Refresh dashboard if active
    const dashPage = document.getElementById('page-dashboard');
    if (dashPage && dashPage.classList.contains('active')) {
        if (typeof initDashboard === 'function') {
            try { await initDashboard(); }
            catch (e) { console.warn('[Sync UI] initDashboard failed:', e); }
        }
    }

    // 4. Show a premium toast notification to the manager
    if (typeof showToast === 'function') {
        showToast(`🔔 خصم جديد وصل من المراقب للموظف: ${employeeName}`, 'success');
    }

    // 5. Play a subtle notification sound (if browser supports it)
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.frequency.value = 880;
        oscillator.type = 'sine';
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.4);
    } catch (_) { /* Audio not critical */ }
}

/**
 * Process a single incoming deduction from the Supabase queue.
 */
async function processIncomingDeduction(row) {
    if (currentSyncState === SyncState.OFFLINE) return;

    try {
        let base64Image = null;
        if (row.image_url) {
            base64Image = await imageToBase64(row.image_url);
        }

        // Lookup employee name for notification
        let employeeName = `رقم ${row.employee_id}`;
        try {
            const { data: localEmps } = await window.supabase
                .from('employees')
                .select('*')
                .eq('id', row.employee_id)
                .limit(1);
            if (localEmps && localEmps.length > 0) employeeName = localEmps[0].name;
        } catch (_) {}

        // Save to local IndexedDB (also cascades to salary)
        await window.dbService.addDeductionToLocalDraft({
            id:              row.id,
            employee_id:     row.employee_id,
            amount:          row.amount,
            reason:          row.reason,
            image_data:      base64Image,
            created_at:      row.created_at,
            supervisor_name: row.supervisor_name
        });

        // Delete receipt image from storage
        if (row.image_url) {
            const storagePath = getStoragePathFromUrl(row.image_url);
            const { error: imgDelErr } = await window.realSupabase.storage
                .from('deductions_images')
                .remove([storagePath]);
            if (imgDelErr) console.warn('[Sync Engine] Storage cleanup warning:', imgDelErr.message);
        }

        // Delete queue row
        const { error: rowDelErr } = await window.realSupabase
            .from('pending_deductions')
            .delete()
            .eq('id', row.id);

        if (rowDelErr) throw new Error(`Queue cleanup failed: ${rowDelErr.message}`);

        // ✅ Refresh manager UI immediately (real-time feel)
        await _refreshManagerUI(employeeName);

        return true;
    } catch (error) {
        console.error('[Sync Engine] Processing halted:', error);
        updateSyncIndicator(SyncState.ERROR);
        throw error;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION E — Main Sync Entry Points
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs the initial backlog pull and sets up the Realtime subscription.
 */
async function initializeCloudBridgeSync() {
    if (isSyncInProgress) return;
    if (!navigator.onLine) { updateSyncIndicator(SyncState.OFFLINE); return; }
    if (!window.realSupabase) {
        console.warn('[Sync Engine] realSupabase not ready — sync disabled.');
        updateSyncIndicator(SyncState.OFFLINE);
        return;
    }

    // Only run for admin / manager roles
    const currentUser = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'manager')) return;

    isSyncInProgress = true;
    updateSyncIndicator(SyncState.SYNCING);

    try {
        // Pull existing backlog
        const { data, error } = await window.realSupabase
            .from('pending_deductions')
            .select('*')
            .order('created_at', { ascending: true });

        if (error) throw error;

        if (data && data.length > 0) {
            console.log(`[Sync Engine] Processing ${data.length} backlog records.`);
            for (const row of data) {
                await processIncomingDeduction(row);
            }
        }

        // 3. Subscribe to real-time additions
        subscribeToRealtimeDeductions();
        
        // 4. Run reverse sync to populate/update active_employees in Supabase
        await syncEmployeesToCloud();
        
        // 5. Start periodic polling fallback
        startSyncPolling();
        
        updateSyncIndicator(SyncState.SYNCED);
    } catch (err) {
        console.error('[Sync Engine] Sync run failed:', err);
        updateSyncIndicator(SyncState.ERROR);
    } finally {
        isSyncInProgress = false;
    }
}

/**
 * Establishes Postgres Realtime subscription for instant deduction delivery.
 */
function subscribeToRealtimeDeductions() {
    if (syncChannel) return; // Already subscribed

    syncChannel = window.realSupabase
        .channel('cloud-bridge-deductions')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'pending_deductions' },
            async (payload) => {
                console.log('[Realtime] 📥 New deduction arrived:', payload.new);
                updateSyncIndicator(SyncState.SYNCING);
                try {
                    await processIncomingDeduction(payload.new);
                    updateSyncIndicator(SyncState.SYNCED);
                } catch (err) {
                    console.error('[Realtime] Processing failed:', err);
                    updateSyncIndicator(SyncState.ERROR);
                }
            }
        )
        .subscribe((status) => {
            console.log('[Realtime] Channel status:', status);
        });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION F — Sync Indicator Widget
// ─────────────────────────────────────────────────────────────────────────────

function updateSyncIndicator(state) {
    currentSyncState = state;
    const container = document.getElementById('sync-indicator');
    if (!container) return;

    container.className = 'sync-indicator-container';
    const textEl  = container.querySelector('.sync-text');
    const spinner = container.querySelector('.sync-spinner');

    switch (state) {
        case SyncState.OFFLINE:
            container.classList.add('state-offline');
            if (textEl)  textEl.textContent  = 'أوفلاين (غير متصل)';
            if (spinner) spinner.style.display = 'none';
            break;
        case SyncState.SYNCING:
            container.classList.add('state-syncing');
            if (textEl)  textEl.textContent  = 'جاري المزامنة...';
            if (spinner) spinner.style.display = 'inline-block';
            break;
        case SyncState.SYNCED:
            container.classList.add('state-synced');
            if (textEl)  textEl.textContent  = 'متصل (جاهز)';
            if (spinner) spinner.style.display = 'none';
            break;
        case SyncState.ERROR:
            container.classList.add('state-error');
            if (textEl)  textEl.textContent  = 'خطأ في المزامنة';
            if (spinner) spinner.style.display = 'none';
            break;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION G — Event Listeners & Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

window.addEventListener('online',  () => initializeCloudBridgeSync());
window.addEventListener('offline', () => updateSyncIndicator(SyncState.OFFLINE));

document.addEventListener('DOMContentLoaded', () => {
    // Small delay to ensure all modules (auth, db-service) are fully loaded
    setTimeout(() => {
        const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
        if (user && (user.role === 'admin' || user.role === 'manager')) {
            initializeCloudBridgeSync();
        }
    }, 1500);
});
