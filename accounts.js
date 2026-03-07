/**
 * accounts.js
 * User account management — admin only.
 * Full CRUD: list, create, edit role, change password, delete.
 */

let _accounts = [];
let _editAccId = null;
let _changePwdId = null;

async function initAccounts() {
    // Guard: admin only
    const user = getCurrentUser();
    if (!user || user.role !== 'admin') {
        showToast('هذه الصفحة للمسؤول فقط.', 'error');
        navigateTo('dashboard');
        return;
    }

    setBreadcrumb('إدارة الحسابات', 'إدارة حسابات المستخدمين وصلاحياتهم');
    await loadAccounts();
}

// ─── Load ─────────────────────────────────────────────────────────────────────

async function loadAccounts() {
    showTableLoading('acc-tbody', 5);
    try {
        const snap = await db.collection('users').orderBy('created_at', 'asc').get();
        _accounts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAccountsTable(_accounts);
    } catch (err) {
        console.error('[accounts] load error:', err);
        showToast('فشل تحميل الحسابات.', 'error');
    }
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderAccountsTable(list) {
    const tbody = document.getElementById('acc-tbody');
    const current = getCurrentUser();
    if (!tbody) return;

    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="5">
          <div class="empty-state">
            <svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <strong>لا توجد حسابات</strong>
          </div>
        </td></tr>`;
        return;
    }

    tbody.innerHTML = list.map(acc => {
        const isSelf = acc.id === current?.id;
        const roleLabel = ROLE_LABELS[acc.role] || acc.role;
        const roleBadge = getRoleBadge(acc.role);
        const createdAt = acc.created_at?.toDate?.().toLocaleDateString('ar-SA', {
            year: 'numeric', month: 'short', day: 'numeric'
        }) || '—';

        return `<tr ${isSelf ? 'style="background:rgba(37,99,235,.04);"' : ''}>
          <td>
            <div style="display:flex;align-items:center;gap:10px;">
              <div class="user-avatar" style="width:34px;height:34px;font-size:13px;flex-shrink:0;">
                ${(acc.username || 'U')[0].toUpperCase()}
              </div>
              <div>
                <div class="fw-600">${_aEsc(acc.username)}</div>
                ${isSelf ? '<div style="font-size:11px;color:var(--c-accent);">حسابك الحالي</div>' : ''}
              </div>
            </div>
          </td>
          <td><span class="${roleBadge}">${roleLabel}</span></td>
          <td class="text-muted" style="font-size:12px;">${createdAt}</td>
          <td>
            <div class="tbl-actions">
              <button class="act-btn edit" title="تعديل الدور" onclick="openAccModal('${acc.id}')">
                <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="act-btn" title="تغيير كلمة المرور" style="color:var(--c-warning,#d97706)"
                onclick="openChangePwd('${acc.id}')">
                <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              </button>
              ${!isSelf ? `<button class="act-btn delete" title="حذف الحساب" onclick="deleteAccount('${acc.id}')">
                <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              </button>` : ''}
            </div>
          </td>
        </tr>`;
    }).join('');
}

// Role labels map
const ROLE_LABELS = {
    admin: 'مدير النظام',
    manager: 'مدير',
    viewer: 'مشاهد فقط',
};

// ─── Add / Edit Modal ─────────────────────────────────────────────────────────

function openAccModal(id = null) {
    _editAccId = id;
    document.getElementById('acc-form').reset();
    const titleEl = document.getElementById('acc-modal-title');
    const unameGroup = document.getElementById('acc-username-group');
    const pwdGroup = document.getElementById('acc-pwd-group');

    if (id) {
        const acc = _accounts.find(a => a.id === id);
        if (!acc) return;
        titleEl.textContent = 'تعديل حساب المستخدم';
        document.getElementById('acc-username').value = acc.username;
        document.getElementById('acc-role').value = acc.role;
        // When editing: don't show password fields (use change-pwd instead)
        if (pwdGroup) pwdGroup.style.display = 'none';
    } else {
        titleEl.textContent = 'إضافة حساب جديد';
        if (pwdGroup) pwdGroup.style.display = '';
    }

    document.getElementById('acc-modal').classList.add('show');
}

function closeAccModal() {
    document.getElementById('acc-modal').classList.remove('show');
}

async function saveAccount() {
    const username = document.getElementById('acc-username').value.trim();
    const role = document.getElementById('acc-role').value;

    if (!username) { showToast('اسم المستخدم مطلوب.', 'error'); return; }
    if (!role) { showToast('يرجى اختيار الدور.', 'error'); return; }

    // Guard: admin role is exclusive — cannot be assigned to new/existing accounts
    if (role === 'admin') {
        showToast('دور مدير النظام محجوز ولا يمكن تعيينه لحسابات جديدة.', 'error');
        return;
    }

    const saveBtn = document.getElementById('acc-save-btn');
    saveBtn.disabled = true;

    try {
        if (_editAccId) {
            // Prevent editing the original admin account
            const target = _accounts.find(a => a.id === _editAccId);
            if (target?.role === 'admin') {
                showToast('لا يمكن تعديل حساب مدير النظام.', 'error');
                saveBtn.disabled = false;
                return;
            }
            await db.collection('users').doc(_editAccId).update({ username, role });
            logAudit('تعديل', 'حساب', username, `تعديل الدور إلى: ${ROLE_LABELS[role] || role}`);
            showToast('تم تحديث الحساب بنجاح.');
        } else {
            // Create new user
            const password = document.getElementById('acc-password').value;
            const confirm = document.getElementById('acc-password-confirm').value;

            if (!password) { showToast('كلمة المرور مطلوبة.', 'error'); saveBtn.disabled = false; return; }
            if (password !== confirm) { showToast('كلمتا المرور غير متطابقتين.', 'error'); saveBtn.disabled = false; return; }
            if (password.length < 6) { showToast('كلمة المرور يجب أن تكون 6 أحرف على الأقل.', 'error'); saveBtn.disabled = false; return; }

            // Check username uniqueness
            const dup = await db.collection('users').where('username', '==', username).limit(1).get();
            if (!dup.empty) { showToast('اسم المستخدم مستخدم مسبقاً.', 'warning'); saveBtn.disabled = false; return; }

            const password_hash = await hashPassword(password);
            await db.collection('users').add({
                username,
                password_hash,
                role,
                created_at: firebase.firestore.FieldValue.serverTimestamp()
            });
            logAudit('إضافة', 'حساب', username, `الدور الأساسي: ${ROLE_LABELS[role] || role}`);
            showToast('تم إنشاء الحساب بنجاح.');
        }
        closeAccModal();
        await loadAccounts();
    } catch (err) {
        console.error('[accounts] save error:', err);
        showToast('فشل حفظ الحساب.', 'error');
    } finally {
        saveBtn.disabled = false;
    }
}

// ─── Change Password Modal ────────────────────────────────────────────────────

function openChangePwd(id) {
    if (!id) return;
    _changePwdId = id;
    const current = getCurrentUser();
    const isSelf = id === current?.id;

    document.getElementById('cpwd-form').reset();

    // Show/Hide old password field
    const oldGroup = document.getElementById('cpwd-old-group');
    if (oldGroup) oldGroup.style.display = isSelf ? 'block' : 'none';

    // Set username label
    let uname = '';
    if (isSelf) {
        uname = current.username;
    } else {
        const acc = _accounts.find(a => a.id === id);
        uname = acc ? acc.username : 'المستخدم';
    }

    const el = document.getElementById('cpwd-username');
    if (el) el.textContent = uname;

    document.getElementById('cpwd-modal').classList.add('show');
}

function closeChangePwd() {
    document.getElementById('cpwd-modal').classList.remove('show');
}

async function saveChangePwd() {
    const current = getCurrentUser();
    const isSelf = _changePwdId === current?.id;

    const oldPwd = document.getElementById('cpwd-old').value;
    const newPwd = document.getElementById('cpwd-new').value;
    const confirm = document.getElementById('cpwd-confirm').value;

    if (isSelf && !oldPwd) { showToast('يرجى إدخال كلمة المرور الحالية.', 'error'); return; }
    if (!newPwd) { showToast('يرجى إدخال كلمة المرور الجديدة.', 'error'); return; }
    if (newPwd !== confirm) { showToast('كلمتا المرور غير متطابقتين.', 'error'); return; }
    if (newPwd.length < 6) { showToast('كلمة المرور قصيرة جداً (6 أحرف على الأقل).', 'error'); return; }

    const saveBtn = document.getElementById('cpwd-save-btn');
    saveBtn.disabled = true;

    try {
        // If self-changing, verify old password first
        if (isSelf) {
            const oldHash = await hashPassword(oldPwd.trim());
            const userDoc = await db.collection('users').doc(current.id).get();
            if (!userDoc.exists || userDoc.data().password_hash !== oldHash) {
                showToast('كلمة المرور الحالية غير صحيحة.', 'error');
                saveBtn.disabled = false;
                return;
            }
        }

        const newHash = await hashPassword(newPwd.trim());
        await db.collection('users').doc(_changePwdId).update({ password_hash: newHash });

        const targetUname = isSelf ? current.username : (_accounts.find(a => a.id === _changePwdId)?.username || '');
        logAudit('تعديل', 'حساب', `تغيير كلمة مرور ${targetUname}`);

        showToast('تم تغيير كلمة المرور بنجاح.');
        closeChangePwd();
    } catch (err) {
        console.error('[accounts] change pwd error:', err);
        showToast('فشل تغيير كلمة المرور.', 'error');
    } finally {
        saveBtn.disabled = false;
    }
}

// ─── Delete ───────────────────────────────────────────────────────────────────

async function deleteAccount(id) {
    const current = getCurrentUser();
    if (id === current?.id) { showToast('لا يمكنك حذف حسابك الخاص.', 'error'); return; }

    const acc = _accounts.find(a => a.id === id);
    const ok = await showConfirm(
        `هل تريد حذف حساب "${acc?.username || id}" نهائياً؟ لا يمكن التراجع.`,
        'حذف الحساب'
    );
    if (!ok) return;

    try {
        await db.collection('users').doc(id).delete();
        logAudit('حذف', 'حساب', acc?.username || id);
        showToast('تم حذف الحساب بنجاح.');
        await loadAccounts();
    } catch (err) {
        showToast('فشل حذف الحساب.', 'error');
    }
}

function _aEsc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
