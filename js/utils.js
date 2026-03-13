/**
 * utils.js
 * Shared utility functions: hashing, toast, confirm dialog, formatting.
 */

// ─── Password Hashing ───────────────────────────────────────────────────────

/**
 * Hash a plain-text password with SHA-256 using the browser's SubtleCrypto API.
 * @param {string} password
 * @returns {Promise<string>} Hex-encoded hash
 */
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Toast Notifications ────────────────────────────────────────────────────

/**
 * Show a non-blocking toast notification.
 * @param {string} message
 * @param {'success'|'error'|'warning'|'info'} type
 */
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => {
        requestAnimationFrame(() => toast.classList.add('show'));
    });
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3200);
}

// ─── Global Keyboard Shortcuts ──────────────────────────────────────────────
/**
 * Global listener for the 'Escape' key to close any open modals, 
 * popups, or confirm dialogs automatically.
 */
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        // 1. Close the confirm dialog if open by clicking cancel
        const confirmOverlay = document.getElementById('confirm-overlay');
        if (confirmOverlay && confirmOverlay.classList.contains('show')) {
            const cancelBtn = document.getElementById('confirm-cancel');
            if (cancelBtn) cancelBtn.click();
            return; // Only close one top-level thing at a time
        }

        // 2. Call close functions for each page's specific modals
        // We use optional calling since some scripts might not be loaded or variables not defined.
        if (window.closeEmpModal) closeEmpModal();
        if (window.closeDrvModal) closeDrvModal();
        if (window.closeAddDriverModal) closeAddDriverModal();
        if (window.closeSalModal) closeSalModal();
        if (window.closeAccModal) closeAccModal();
        if (window.closeChangePwd) closeChangePwd();

        // 3. Fallback: find any element with 'modal-overlay show' and remove 'show'
        document.querySelectorAll('.modal-overlay.show, .modal.show').forEach(m => {
            m.classList.remove('show');
        });
    }
});

// ─── Confirm Dialog ─────────────────────────────────────────────────────────

/**
 * Show a custom confirm dialog. Returns a Promise<boolean>.
 * @param {string} message
 * @param {string} [title='تأكيد الإجراء']
 * @returns {Promise<boolean>}
 */
function showConfirm(message, title = 'تأكيد الإجراء') {
    return new Promise(resolve => {
        const overlay = document.getElementById('confirm-overlay');
        const titleEl = document.getElementById('confirm-title');
        const msgEl = document.getElementById('confirm-message');
        const okBtn = document.getElementById('confirm-ok');
        const cancelBtn = document.getElementById('confirm-cancel');

        titleEl.textContent = title;
        msgEl.textContent = message;
        overlay.classList.add('show');

        const cleanup = () => overlay.classList.remove('show');

        const newOk = okBtn.cloneNode(true);
        const newCancel = cancelBtn.cloneNode(true);
        okBtn.parentNode.replaceChild(newOk, okBtn);
        cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

        document.getElementById('confirm-ok').addEventListener('click', () => { cleanup(); resolve(true); }, { once: true });
        document.getElementById('confirm-cancel').addEventListener('click', () => { cleanup(); resolve(false); }, { once: true });
    });
}

// ─── Formatting ─────────────────────────────────────────────────────────────

/**
 * Format a number as currency string.
 * @param {number} amount
 * @returns {string}
 */
function formatCurrency(amount) {
    if (isNaN(amount) || amount === null) return '—';
    return new Intl.NumberFormat('en-US').format(Math.round(amount)) + ' د.ع';
}

/**
 * Get the current month as a YYYY-MM string.
 * @returns {string}
 */
function getCurrentMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

/**
 * Get a human-readable Arabic month label from a YYYY-MM string.
 * @param {string} monthStr
 * @returns {string}
 */
function getMonthLabel(monthStr) {
    if (!monthStr) return '';
    const [y, m] = monthStr.split('-');
    const date = new Date(Number(y), Number(m) - 1, 1);
    return date.toLocaleDateString('ar-SA', { month: 'long', year: 'numeric' });
}

/**
 * Show a loading placeholder row in a table body.
 * @param {string} tbodyId
 * @param {number} colSpan
 */
function showTableLoading(tbodyId, colSpan = 6) {
    const tbody = document.getElementById(tbodyId);
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="${colSpan}" class="loading-cell"><span class="spinner"></span>&nbsp; جاري التحميل...</td></tr>`;
    }
}

/**
 * Update the header breadcrumb.
 * @param {string} title
 * @param {string} [subtitle]
 */
function setBreadcrumb(title, subtitle = '') {
    const t = document.getElementById('breadcrumb-title');
    const s = document.getElementById('breadcrumb-sub');
    if (t) t.textContent = title;
    if (s) s.textContent = subtitle;
}

/**
 * Get a role badge class string.
 * @param {string} role
 * @returns {string}
 */
function getRoleBadge(role) {
    const map = {
        admin: 'badge badge-purple',
        manager: 'badge badge-blue',
        viewer: 'badge badge-gray',
        driver: 'badge badge-orange',
        delivery: 'badge badge-orange',
        cashier: 'badge badge-green',
        chef: 'badge badge-red',
    };
    const key = (role || '').toLowerCase();
    return map[key] || 'badge badge-gray';
}

/**
 * Build <select> options string for month range (from January of current year + next 2 months).
 * @param {string} selectedMonth   YYYY-MM
 * @returns {string} HTML options
 */
function buildMonthOptions(selectedMonth) {
    const options = [];
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthIndex = now.getMonth(); // 0 = Jan, 11 = Dec

    // Start from January (month index 0) of the current year
    // and go up to the current month + 2 months
    const endOffset = currentMonthIndex + 2;

    for (let i = 0; i <= endOffset; i++) {
        const d = new Date(currentYear, i, 1);
        const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = d.toLocaleDateString('ar-SA', { month: 'long', year: 'numeric' });
        options.push(`<option value="${val}" ${val === selectedMonth ? 'selected' : ''}>${label}</option>`);
    }
    return options.join('');
}

// ─── Currency Input Formatting ───────────────────────────────────────────────

/**
 * Attach live comma-formatting to a number input.
 * يُنسَّق الرقم تلقائياً مع كل ضغطة: 5000 → 5,000
 * @param {HTMLInputElement} el
 */
function attachCurrencyInput(el) {
    if (!el || el._currencyAttached) return;
    el._currencyAttached = true; // منع الربط المزدوج

    el.addEventListener('input', function () {
        // احتفظ فقط بالأرقام
        const digits = this.value.replace(/[^\d]/g, '');

        if (digits === '') {
            this.value = '';
            return;
        }

        // نسّق بفواصل: 5000 → 5,000
        this.value = Number(digits).toLocaleString('en-US');

        // ضع المؤشر في نهاية النص دائماً
        const len = this.value.length;
        try { this.setSelectionRange(len, len); } catch (_) { }
    });
}

/**
 * Get the numeric value from an input that may have comma-formatting.
 * @param {string} id  Element id
 * @returns {number}
 */
function getNumVal(id) {
    const el = document.getElementById(id);
    if (!el) return 0;
    return parseFloat(String(el.value).replace(/,/g, '')) || 0;
}

// ─── Audit Logging ───────────────────────────────────────────────────────────

/**
 * Write an audit log entry to Firestore.
 * @param {'إضافة'|'تعديل'|'حذف'} action
 * @param {'موظف'|'راتب'|'دليفري'|'حساب'} targetType
 * @param {string} targetName  Human-readable name of the affected record
 * @param {string} [details='']  Additional details about the change
 */
async function logAudit(action, targetType, targetName, details = '') {
    const user = getCurrentUser();
    if (!user) return;
    try {
        await db.collection('audit_logs').add({
            user_id: user.id,
            username: user.username,
            role: user.role,
            action,
            target_type: targetType,
            target_name: String(targetName || '—'),
            details: String(details || ''),
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (err) {
        console.warn('[audit] log failed:', err);
    }
}

/**
 * Returns a professional "Classic" SVG icon for user avatars.
 * @returns {string} SVG HTML string
 */
function getUserAvatarIcon() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
        <circle cx="12" cy="7" r="4"></circle>
    </svg>`;
}
// ─── Data Caching Layer (3-layer: Memory → localStorage → Firestore) ───────
//
// Layer 1: in-memory (_data)       — fastest, lives until page close
// Layer 2: localStorage            — survives page refresh, TTL = 15 min
// Layer 3: Firestore cache-first   — IndexedDB offline cache, then network
//
// Result: after first load, the app reads ZERO docs from Firestore
// for the next 15 minutes, even if the page is refreshed.

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 دقيقة
const LS_PREFIX    = 'arc_'; // arc = app-read-cache

window.appCache = {
    _data: {},      // Layer 1: memory
    _promises: {},  // Dedup in-flight requests

    // ── Layer 2 helpers ──
    _lsRead(col) {
        try {
            const raw = localStorage.getItem(LS_PREFIX + col);
            if (!raw) return null;
            const { data, ts } = JSON.parse(raw);
            if (Date.now() - ts > CACHE_TTL_MS) {
                localStorage.removeItem(LS_PREFIX + col);
                return null; // منتهي الصلاحية
            }
            return data;
        } catch { return null; }
    },

    _lsWrite(col, data) {
        try {
            localStorage.setItem(LS_PREFIX + col, JSON.stringify({ data, ts: Date.now() }));
        } catch (e) {
            // localStorage full — remove oldest entry and retry once
            try {
                for (const k of Object.keys(localStorage)) {
                    if (k.startsWith(LS_PREFIX)) { localStorage.removeItem(k); break; }
                }
                localStorage.setItem(LS_PREFIX + col, JSON.stringify({ data, ts: Date.now() }));
            } catch { /* ignore */ }
        }
    },

    _lsClear(col) {
        try {
            if (col) {
                localStorage.removeItem(LS_PREFIX + col);
            } else {
                // مسح كل الكاش
                for (const k of Object.keys(localStorage)) {
                    if (k.startsWith(LS_PREFIX)) localStorage.removeItem(k);
                }
            }
        } catch { /* ignore */ }
    },

    // ── Main get ──
    async get(collectionName) {
        // Layer 1: memory
        if (this._data[collectionName]) {
            return this._data[collectionName];
        }

        // Dedup parallel calls
        if (this._promises[collectionName]) {
            return this._promises[collectionName];
        }

        this._promises[collectionName] = (async () => {
            // Layer 2: localStorage
            const lsData = this._lsRead(collectionName);
            if (lsData) {
                console.log(`[Cache] ✅ localStorage hit: ${collectionName} (${lsData.length} docs)`);
                this._data[collectionName] = lsData;
                return lsData;
            }

            // Layer 3: Firestore cache-first (IndexedDB), then network
            try {
                let snap, fromCache = true;
                try {
                    // جرّب الـ IndexedDB أولاً (لا قراءات شبكة)
                    snap = await db.collection(collectionName).get({ source: 'cache' });
                    console.log(`[Cache] ✅ Firestore IndexedDB hit: ${collectionName}`);
                } catch {
                    // الـ cache فارغ → اجلب من الشبكة
                    fromCache = false;
                    snap = await db.collection(collectionName).get({ source: 'server' });
                    console.log(`[Cache] 🌐 Network fetch: ${collectionName} (${snap.docs.length} docs)`);
                }

                const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                this._data[collectionName] = data;
                this._lsWrite(collectionName, data);

                if (!fromCache && window.updateUsageStats) {
                    window.updateUsageStats(snap.docs.length, 0);
                }
                return data;

            } catch (err) {
                console.error(`[Cache] ❌ Failed: ${collectionName}`, err);
                return [];
            } finally {
                delete this._promises[collectionName];
            }
        })();

        return this._promises[collectionName];
    },

    // ── Invalidate (after write operations) ──
    invalidate(collectionName) {
        console.log(`[Cache] 🗑 Invalidate: ${collectionName}`);
        delete this._data[collectionName];
        this._lsClear(collectionName);
    }
};

/**
 * Wrapper for appCache.get
 */
function cachedGet(collection) {
    return window.appCache.get(collection);
}

/**
 * Wrapper for appCache.invalidate
 */
function invalidateCache(collection) {
    return window.appCache.invalidate(collection);
}

// ─── Connectivity Monitor ────────────────────────────────────────────────────

/**
 * Monitors the browser's online/offline status and updates the UI header.
 */
function initConnectivityMonitor() {
    if (window._connectivityInitialized) return;
    window._connectivityInitialized = true;

    const el = document.getElementById('connectivity-status');
    if (!el) return;

    const text = el.querySelector('.status-text');

    function updateStatus() {
        // navigator.onLine is a good indicator but can be misleading.
        // On refresh, we force a check.
        if (navigator.onLine) {
            el.className = 'connectivity-online';
            if (text) text.textContent = 'متصل';
        } else {
            el.className = 'connectivity-offline';
            if (text) text.textContent = 'لا يوجد اتصال بالإنترنت';
        }
    }

    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);

    // Initial check
    updateStatus();

    // Safety re-check after a short delay (browser network stack might lag)
    setTimeout(updateStatus, 1000);
}

// Initialize as soon as possible
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initConnectivityMonitor);
} else {
    initConnectivityMonitor();
}

// ─── Mobile Sidebar Toggle ───────────────────────────────────────────────────

function openSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.add('open');
    if (overlay) {
        overlay.style.display = 'block';
        requestAnimationFrame(() => overlay.classList.add('show'));
    }
    document.body.style.overflow = 'hidden';
}

function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) {
        overlay.classList.remove('show');
        setTimeout(() => { overlay.style.display = ''; }, 320);
    }
    document.body.style.overflow = '';
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.classList.contains('open')) {
        closeSidebar();
    } else {
        openSidebar();
    }
}

// إغلاق تلقائي عند النقر على أي عنصر بالقائمة الجانبية على الجوال
document.addEventListener('DOMContentLoaded', () => {
    const navItems = document.querySelectorAll('#sidebar .nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            if (window.innerWidth <= 768) closeSidebar();
        });
    });
});
