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
// ─── Data Caching Layer ──────────────────────────────────────────────────────

/**
 * Global cache for application data to minimize Firestore reads.
 */
window.appCache = {
    _data: {},
    _promises: {},

    /**
     * Get data from cache or fetch from Firestore.
     */
    async get(collectionName) {
        // If already in data cache, return it
        if (this._data[collectionName]) {
            return this._data[collectionName];
        }

        // If a fetch is already in progress, wait for it
        if (this._promises[collectionName]) {
            return this._promises[collectionName];
        }

        this._promises[collectionName] = (async () => {
            try {
                console.log(`[Cache] Fetching: ${collectionName}`);
                const snap = await db.collection(collectionName).get();
                const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                this._data[collectionName] = data;

                if (window.updateUsageStats) {
                    window.updateUsageStats(snap.docs.length, 0);
                }
                return data;
            } catch (err) {
                console.error(`[Cache] Failed to fetch ${collectionName}:`, err);
                return []; // Return empty array on failure instead of throwing
            } finally {
                delete this._promises[collectionName];
            }
        })();

        return this._promises[collectionName];
    },

    invalidate(collectionName) {
        console.log(`[Cache] Invalidating: ${collectionName}`);
        delete this._data[collectionName];
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
