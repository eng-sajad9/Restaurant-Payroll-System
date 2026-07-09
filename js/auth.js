/**
 * auth.js
 * Custom authentication using Firestore "users" collection.
 */

const SESSION_KEY = 'payroll_session';

async function login(username, password) {
    try {
        const hash = await hashPassword(password.trim());
        let user = null;
        let authSource = 'local';

        // 1. Try real Supabase first if online (crucial for supervisors and online sync)
        if (window.realSupabase && navigator.onLine) {
            try {
                const { data: cloudUsers, error: cloudErr } = await window.realSupabase
                    .from('users')
                    .select('*')
                    .eq('username', username.trim())
                    .limit(1);

                if (!cloudErr && cloudUsers && cloudUsers.length > 0) {
                    user = cloudUsers[0];
                    authSource = 'cloud';
                }
            } catch (err) {
                console.warn('[auth] Cloud authentication failed, falling back to local IndexedDB:', err);
            }
        }

        // 2. Local IndexedDB fallback
        if (!user) {
            const { data: users, error } = await supabase
                .from('users')
                .select('*')
                .eq('username', username.trim())
                .limit(1);

            if (error) throw error;
            if (users && users.length > 0) {
                user = users[0];
            }
        }

        if (!user || user.password_hash !== hash) {
            return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' };
        }

        const session = {
            id: user.id,
            username: user.username,
            role: user.role,
            can_view_analytics: user.can_view_analytics !== false, // Default true
            can_delete: !!user.can_delete, // Default false
            authSource: authSource,
            loginTime: Date.now()
        };
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
        return { success: true, user: session };
    } catch (err) {
        console.error('[auth] login error:', err);
        let errorMsg = 'خطأ في الاتصال بقاعدة البيانات.';
        if (err.message && err.message.includes('permission-denied')) {
            errorMsg = 'تم رفض الوصول (Supabase RLS). يرجى التأكد من إعدادات القواعد.';
        } else if (err.message) {
            errorMsg = err.message;
        }
        return { success: false, error: errorMsg };
    }
}

function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    window.location.reload();
}

function getCurrentUser() {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function requireAuth() {
    const user = getCurrentUser();
    if (!user) { showLoginSection(); return null; }
    return user;
}

function hasRole(roles) {
    const user = getCurrentUser();
    return !!user && roles.includes(user.role);
}

// Global role checker functions
window.isAdmin = function() { return hasRole(['admin']); };
window.canWrite = function() { return hasRole(['admin', 'manager']); };
window.isSupervisor = function() { return hasRole(['مراقب']); };

function canDelete() {
    const user = getCurrentUser();
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (user.role === 'manager') return !!user.can_delete;
    return false;
}

function canViewAnalytics() {
    const user = getCurrentUser();
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (user.role === 'manager') return user.can_view_analytics !== false; // Default true
    return false;
}

function showLoginSection() {
    document.getElementById('login-section').style.display = 'flex';
    document.getElementById('app-section').style.display = 'none';
}

function showAppSection() {
    document.getElementById('login-section').style.display = 'none';
    document.getElementById('app-section').style.display = 'flex';
}

function renderUserCard() {
    const user = getCurrentUser();
    if (!user) return;

    const roleLabels = { admin: 'مدير النظام', manager: 'مشرف', viewer: 'مشاهد فقط', 'مراقب': 'مراقب الحضور' };

    const nameEl = document.getElementById('sidebar-username');
    const roleEl = document.getElementById('sidebar-role');
    const avatarEl = document.getElementById('sidebar-avatar');

    if (nameEl) nameEl.textContent = user.username;
    if (roleEl) roleEl.textContent = roleLabels[user.role] || user.role;
    if (avatarEl) avatarEl.innerHTML = getUserAvatarIcon();

    // ── مراقب الحضور: واجهة مخصصة تماماً، يُخفى كل شيء آخر ──
    if (isSupervisor()) {
        const sidebar = document.getElementById('sidebar');
        const mainArea = document.getElementById('main-area');
        const supSection = document.getElementById('supervisor-section');

        if (sidebar) sidebar.style.display = 'none';
        if (mainArea) mainArea.style.display = 'none';
        if (supSection) {
            supSection.style.display = 'flex';
            const supUser = document.getElementById('sup-header-username');
            const supRole = document.getElementById('sup-header-role');
            if (supUser) supUser.textContent = user.username;
            if (supRole) supRole.textContent = 'مراقب الحضور';
            initSupervisor();
        }
        return;
    }

    // -- Role-based Navigation Visibility --
    const accNav = document.getElementById('nav-accounts');
    const audNav = document.getElementById('nav-audit');

    if (accNav) accNav.style.display = (user.role === 'admin') ? '' : 'none';
    if (audNav) audNav.style.display = (user.role === 'admin' || user.role === 'manager') ? '' : 'none';

    // -- Analytics Visibility --
    const anNav = document.getElementById('nav-analytics');
    const anNavMobile = document.getElementById('m-nav-analytics');
    const hasAnAccess = canViewAnalytics();
    if (anNav) anNav.style.display = hasAnAccess ? '' : 'none';
    if (anNavMobile) anNavMobile.style.display = hasAnAccess ? '' : 'none';

    if (!canWrite()) {
        document.querySelectorAll('[data-write-only]').forEach(el => el.style.display = 'none');
    } else {
        const mNav = document.querySelector('.mobile-nav');
        if (mNav) mNav.style.display = 'flex';
        document.querySelectorAll('[data-write-only]').forEach(el => el.style.display = '');
    }

    // ─── Start background Cloud Bridge sync immediately upon loading dashboard ───
    if (typeof initializeCloudBridgeSync === 'function') {
        initializeCloudBridgeSync();
    }
}

