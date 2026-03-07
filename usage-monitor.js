/**
 * usage-monitor.js
 * Tracks estimated Firebase Reads/Writes and total document count.
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

// Intercept Firestore operations
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

    const originalCollection = db.collection;
    db.collection = function (path) {
        const colRef = originalCollection.apply(this, arguments);

        // Intercept .get()
        const originalGet = colRef.get;
        colRef.get = async function () {
            const snap = await originalGet.apply(this, arguments);
            window.usageStats.reads += snap.docs.length || 1; // Count each doc read
            updateUsageUI();
            return snap;
        };

        // Intercept .onSnapshot()
        const originalSnapshot = colRef.onSnapshot;
        colRef.onSnapshot = function (onNext, onError) {
            return originalSnapshot.call(this, (snap) => {
                window.usageStats.reads += snap.docs.length || 1;
                updateUsageUI();
                onNext(snap);
            }, onError);
        };

        // Intercept doc operations (add, set, update, delete)
        const originalDoc = colRef.doc;
        colRef.doc = function (id) {
            const docRef = originalDoc.apply(this, arguments);

            const originalSet = docRef.set;
            docRef.set = async function () {
                window.usageStats.writes += 1;
                updateUsageUI();
                return originalSet.apply(this, arguments);
            };

            const originalUpdate = docRef.update;
            docRef.update = async function () {
                window.usageStats.writes += 1;
                updateUsageUI();
                return originalUpdate.apply(this, arguments);
            };

            const originalDelete = docRef.delete;
            docRef.delete = async function () {
                window.usageStats.writes += 1;
                updateUsageUI();
                return originalDelete.apply(this, arguments);
            };

            return docRef;
        };

        // For collection.add()
        const originalAdd = colRef.add;
        colRef.add = async function () {
            window.usageStats.writes += 1;
            updateUsageUI();
            return originalAdd.apply(this, arguments);
        };

        return colRef;
    };

    // Initial count for "Total Storage Estimate"
    fetchTotalDocCount();
    window._trackerInitialized = true;
}

async function fetchTotalDocCount() {
    try {
        const collections = ['employees', 'salaries', 'drivers', 'advances', 'audit_logs'];
        let total = 0;
        for (const col of collections) {
            const snap = await db.collection(col).get();
            total += snap.docs.length;
        }
        window.usageStats.totalDocs = total;
        updateUsageUI();
    } catch (e) {
        console.warn('Failed to fetch total doc count', e);
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initUsageTracker, 1000); // Wait for firebase-config
});
