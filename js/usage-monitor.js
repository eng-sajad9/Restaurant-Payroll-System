/**
 * usage-monitor.js
 * Tracks estimated Supabase Reads/Writes and total document count.
 */

window.usageStats = {
    reads: parseInt(localStorage.getItem('fb_reads') || '0'),
    writes: parseInt(localStorage.getItem('fb_writes') || '0'),
    totalDocs: 0
};

// Update LocalStorage and UI
function updateUsageUI() {
    localStorage.setItem('fb_reads', window.usageStats.reads);
    localStorage.setItem('fb_writes', window.usageStats.writes);

    const readEl = document.getElementById('usage-reads');
    const writeEl = document.getElementById('usage-writes');
    const totalEl = document.getElementById('usage-total');

    if (readEl) readEl.textContent = window.usageStats.reads.toLocaleString();
    if (writeEl) writeEl.textContent = window.usageStats.writes.toLocaleString();
    if (totalEl) totalEl.textContent = window.usageStats.totalDocs.toLocaleString();
}

// Reset Session Stats
function resetUsageStats() {
    window.usageStats.reads = 0;
    window.usageStats.writes = 0;
    updateUsageUI();
}

window.updateUsageStats = function(reads = 0, writes = 0) {
    window.usageStats.reads += reads;
    window.usageStats.writes += writes;
    updateUsageUI();
};

function initUsageTracker() {
    if (window._trackerInitialized) return;

    // Auto-Reset Check (Daily)
    const today = new Date().toLocaleDateString();
    const lastReset = localStorage.getItem('fb_last_reset');
    if (lastReset !== today) {
        window.usageStats.reads = 0;
        window.usageStats.writes = 0;
        localStorage.setItem('fb_last_reset', today);
        updateUsageUI();
    }

    // Initial count for "Total Storage Estimate"
    fetchTotalDocCount();
    window._trackerInitialized = true;
}

async function fetchTotalDocCount() {
    try {
        const collections = ['employees', 'salaries', 'drivers', 'audit_logs'];
        let total = 0;
        for (const col of collections) {
            const { count, error } = await supabase.from(col).select('*', { count: 'exact', head: true });
            if (!error && count) {
                total += count;
            }
        }
        window.usageStats.totalDocs = total;
        updateUsageUI();
    } catch (e) {
        console.warn('Failed to fetch total doc count', e);
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initUsageTracker, 1000); // Wait for supabase config
});
