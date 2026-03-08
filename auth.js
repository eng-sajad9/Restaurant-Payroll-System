/**
 * auth.js
 * Custom authentication using Firestore "users" collection.
 */

const SESSION_KEY = 'payroll_session';

async function login(username, password) {
    try {
        const hash = await hashPassword(password.trim());
        const snap = await db.collection('users')
            .where('username', '==', username.trim())
            .limit(1)
            .get();

        if (snap.empty) {
            return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' };
        }

        const doc = snap.docs[0];
        const user = { id: doc.id, ...doc.data() };

        if (user.password_hash !== hash) {
            return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' };
        }

        const session = {
            id: user.id,
            username: user.username,
            role: user.role,
            can_view_analytics: user.can_view_analytics !== false, // Default true
            can_delete: !!user.can_delete, // Default false
            loginTime: Date.now()
        };
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
        return { success: true, user: session };
    } catch (err) {
        console.error('[auth] login error:', err);
        return { success: false, error: 'خطأ في الاتصال. يرجى التحقق من إعدادات Firebase.' };
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

function isAdmin() { return hasRole(['admin']); }
function canWrite() { return hasRole(['admin', 'manager']); }

/**
 * Check if current user can delete records
 */
function canDelete() {
    const user = getCurrentUser();
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (user.role === 'manager') return !!user.can_delete;
    return false;
}

/**
 * Check if current user can view analytics
 */
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

    const roleLabels = { admin: 'مدير النظام', manager: 'مشرف', viewer: 'مشاهد' };

    const nameEl = document.getElementById('sidebar-username');
    const roleEl = document.getElementById('sidebar-role');
    const avatarEl = document.getElementById('sidebar-avatar');

    if (nameEl) nameEl.textContent = user.username;
    if (roleEl) roleEl.textContent = roleLabels[user.role] || user.role;
    if (avatarEl) avatarEl.innerHTML = getUserAvatarIcon();

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
        // Show mobile nav if visible in CSS
        const mNav = document.querySelector('.mobile-nav');
        if (mNav) mNav.style.display = 'flex';

        // Assuming loadDashboard and appSec are defined elsewhere or intended for another file
        // if (appSec) appSec.style.display = 'block'; 
        // loadDashboard(); 
        document.querySelectorAll('[data-write-only]').forEach(el => el.style.display = '');
    }
}
