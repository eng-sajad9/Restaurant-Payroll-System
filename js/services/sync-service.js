/**
 * sync-service.js
 * Cloud Bridge synchronization pipeline for Restaurant Payroll system.
 * Syncs online pending deductions queue from Supabase into local IndexedDB.
 */

// Synchronization States
const SyncState = {
    OFFLINE: 'Offline',
    SYNCING: 'Syncing',
    SYNCED: 'Synced/Idle',
    ERROR: 'Error'
};

let currentSyncState = SyncState.SYNCED;
let isSyncInProgress = false;
let syncChannel = null;

/**
 * Downloads image from a URL and converts it to a Base64 data-URI string.
 * @param {string} url - The public URL of the receipt image.
 * @returns {Promise<string|null>}
 */
async function imageToBase64(url) {
    if (!url) return null;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('FileReader failed to convert image blob.'));
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error('[Sync Engine] Image base64 conversion failed:', error);
        throw error; // Rethrow to halt the pipeline to preserve integrity
    }
}

/**
 * Extracts storage relative file path from public Supabase URL.
 * Example: https://xyz.supabase.co/storage/v1/object/public/deductions_images/emp-id/uuid.jpg
 * Returns: "emp-id/uuid.jpg"
 */
function getStoragePathFromUrl(imageUrl) {
    const bucketToken = '/deductions_images/';
    const index = imageUrl.indexOf(bucketToken);
    if (index === -1) {
        return imageUrl.substring(imageUrl.lastIndexOf('/') + 1);
    }
    return decodeURIComponent(imageUrl.substring(index + bucketToken.length));
}

/**
 * Extension for DatabaseService.
 * Saves processed cloud deductions permanently in local IndexedDB.
 */
window.dbService.addDeductionToLocalDraft = async function (deduction) {
    const record = {
        id: deduction.id || generateUUID(),
        employee_id: deduction.employee_id,
        month: deduction.month || getCurrentMonth(),
        amount: deduction.amount || 0,
        note: deduction.reason || '',
        image_data: deduction.image_data, 
        added_by: deduction.supervisor_name || 'Supervisor (Cloud Bridge)', // Audit Trail mapping!
        added_at: deduction.created_at || new Date().toISOString()
    };

    // Store in local Dexie IndexedDB
    await this.insert('deduction_logs', record);

    // Cascades the deduction amount into the local salaries table (if function exists)
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
            console.warn('[Sync Engine] Local salary cascade update warning:', cascadeErr);
        }
    }
};

/**
 * Process a single deduction log queue entry.
 * Runs in a secure transaction flow.
 */
async function processIncomingDeduction(row) {
    if (currentSyncState === SyncState.OFFLINE) return;

    try {
        let base64Image = null;

        // 1. Fetch image and convert to Base64
        if (row.image_url) {
            base64Image = await imageToBase64(row.image_url);
        }

        // 2. Lookup employee name locally (for premium personalized toasts)
        let employeeName = `رقم ${row.employee_id}`;
        try {
            const localEmps = await window.dbService.select('employees', {
                filters: [{ type: 'eq', field: 'id', value: row.employee_id }]
            });
            if (localEmps && localEmps.length > 0) {
                employeeName = localEmps[0].name;
            }
        } catch (dbErr) {
            console.warn('[Sync Engine] Failed local employee lookup:', dbErr);
        }

        // 3. Save deduction permanently in local IndexedDB
        const localDeduction = {
            id: row.id,
            employee_id: row.employee_id,
            amount: row.amount,
            reason: row.reason,
            image_data: base64Image,
            created_at: row.created_at,
            supervisor_name: row.supervisor_name // Passed to local IndexedDB coordinator
        };
        await window.dbService.addDeductionToLocalDraft(localDeduction);

        // 4. Delete file from storage bucket
        if (row.image_url) {
            const storagePath = getStoragePathFromUrl(row.image_url);
            const { error: deleteImgError } = await window.realSupabase.storage
                .from('deductions_images')
                .remove([storagePath]);
            if (deleteImgError) {
                console.warn('[Sync Engine] Storage cleanup failed:', deleteImgError.message);
            }
        }

        // 5. Delete deduction row from pending queue
        const { error: deleteRowError } = await window.realSupabase
            .from('pending_deductions')
            .delete()
            .eq('id', row.id);

        if (deleteRowError) {
            throw new Error(`Failed to remove queue item: ${deleteRowError.message}`);
        }

        // 6. Trigger non-blocking toast notification
        if (typeof showToast === 'function') {
            showToast(`تم استلام خصم جديد للموظف: ${employeeName}`, 'success');
        }

        // Invalidate cache so manager page shows updated deductions
        if (window.appCache && typeof window.appCache.invalidate === 'function') {
            window.appCache.invalidate('deduction_logs');
            window.appCache.invalidate('salaries');
        }
        
        // Refresh local dashboard if currently on it
        if (typeof initDashboard === 'function' && document.getElementById('page-dashboard')?.classList.contains('active')) {
            initDashboard();
        }

        return true;
    } catch (error) {
        console.error('[Sync Engine] Processing transaction halted:', error);
        updateSyncIndicator(SyncState.ERROR);
        throw error; // Halts sequential loop to prevent data deletion without saving
    }
}

/**
 * Runs bulk sync process to pull existing backlog.
 */
async function initializeCloudBridgeSync() {
    if (isSyncInProgress) return;
    
    if (!navigator.onLine) {
        updateSyncIndicator(SyncState.OFFLINE);
        return;
    }

    if (!window.realSupabase) {
        console.warn('[Sync Engine] Real Supabase client is not loaded. Sync disabled.');
        updateSyncIndicator(SyncState.OFFLINE);
        return;
    }

    // Only run sync pulls for authorized manager or admin users
    const currentUser = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'manager')) {
        return;
    }

    isSyncInProgress = true;
    updateSyncIndicator(SyncState.SYNCING);

    try {
        // 1. Fetch pending rows (backlog)
        const { data, error } = await window.realSupabase
            .from('pending_deductions')
            .select('*')
            .order('created_at', { ascending: true });

        if (error) throw error;

        // 2. Sequentially process rows
        if (data && data.length > 0) {
            console.log(`[Sync Engine] Processing ${data.length} queued records.`);
            for (const row of data) {
                await processIncomingDeduction(row);
            }
        }

        // 3. Subscribe to real-time additions
        subscribeToRealtimeDeductions();
        
        updateSyncIndicator(SyncState.SYNCED);
    } catch (err) {
        console.error('[Sync Engine] Sync run failed:', err);
        updateSyncIndicator(SyncState.ERROR);
    } finally {
        isSyncInProgress = false;
    }
}

/**
 * Establishes realtime subscription to Postgres table inserts.
 */
function subscribeToRealtimeDeductions() {
    if (syncChannel) return; // Channel already active

    syncChannel = window.realSupabase.channel('cloud-bridge-channel')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'pending_deductions' },
            async (payload) => {
                console.log('[Realtime Event] New deduction received:', payload.new);
                try {
                    await processIncomingDeduction(payload.new);
                    updateSyncIndicator(SyncState.SYNCED);
                } catch (err) {
                    console.error('[Realtime Event] Processing failed:', err);
                    updateSyncIndicator(SyncState.ERROR);
                }
            }
        )
        .subscribe();
}

/**
 * Updates the Global Sync Indicator visually.
 * @param {string} state - The SyncState value.
 */
function updateSyncIndicator(state) {
    currentSyncState = state;
    const container = document.getElementById('sync-indicator');
    if (!container) return;

    // Reset current classes while retaining container class
    container.className = 'sync-indicator-container';
    
    const textEl = container.querySelector('.sync-text');
    const spinner = container.querySelector('.sync-spinner');

    switch (state) {
        case SyncState.OFFLINE:
            container.classList.add('state-offline');
            if (textEl) textEl.textContent = 'أوفلاين (غير متصل)';
            if (spinner) spinner.style.display = 'none';
            break;
            
        case SyncState.SYNCING:
            container.classList.add('state-syncing');
            if (textEl) textEl.textContent = 'جاري المزامنة...';
            if (spinner) spinner.style.display = 'inline-block';
            break;
            
        case SyncState.SYNCED:
            container.classList.add('state-synced');
            if (textEl) textEl.textContent = 'متصل (جاهز)';
            if (spinner) spinner.style.display = 'none';
            break;
            
        case SyncState.ERROR:
            container.classList.add('state-error');
            if (textEl) textEl.textContent = 'خطأ في المزامنة';
            if (spinner) spinner.style.display = 'none';
            break;
    }
}

// Watch network status to trigger sync or update indicator
window.addEventListener('online', () => {
    initializeCloudBridgeSync();
});
window.addEventListener('offline', () => {
    updateSyncIndicator(SyncState.OFFLINE);
});

// Trigger sync after login/session is verified
document.addEventListener('DOMContentLoaded', () => {
    // Small delay to ensure all modules are fully loaded
    setTimeout(() => {
        const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
        if (user && (user.role === 'admin' || user.role === 'manager')) {
            initializeCloudBridgeSync();
        }
    }, 1500);
});
