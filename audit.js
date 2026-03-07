/**
 * audit.js
 * Audit log page — shows all recorded actions on employees, salaries, and drivers.
 * Visible to admin and manager only.
 */

let _auditLogs = [];
let _auditFilter = 'all'; // 'all' | 'إضافة' | 'تعديل' | 'حذف'
let _auditPage = 1;
const AUDIT_PAGE_SIZE = 50;
const AUDIT_LIMIT = 200;

async function initAudit() {
  const user = getCurrentUser();
  if (!user || user.role === 'viewer') {
    showToast('هذه الصفحة غير متاحة لك.', 'error');
    navigateTo('dashboard');
    return;
  }
  setBreadcrumb('سجل التعديلات', 'مراقبة جميع التغييرات التي أجراها المستخدمون (آخر 200 عملية)');
  _auditPage = 1;
  await loadAuditLogs();
}

async function loadAuditLogs() {
  showTableLoading('audit-tbody', 7);
  const pagin = document.getElementById('audit-pagination');
  if (pagin) pagin.style.display = 'none';

  try {
    const snap = await db.collection('audit_logs')
      .orderBy('timestamp', 'desc')
      .limit(AUDIT_LIMIT)
      .get();
    _auditLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAuditTable(_auditFilter);
  } catch (err) {
    console.error('[audit] load error (index missing?):', err);
    try {
      const snap2 = await db.collection('audit_logs').limit(AUDIT_LIMIT).get();
      _auditLogs = snap2.docs.map(d => ({ id: d.id, ...d.data() }));
      _auditLogs.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
      renderAuditTable(_auditFilter);
    } catch (err2) {
      showToast('فشل تحميل سجل التعديلات.', 'error');
    }
  }
}

function filterAudit(type) {
  _auditFilter = type;
  _auditPage = 1;
  document.querySelectorAll('.audit-filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === type);
  });
  renderAuditTable(type);
}

function changeAuditPage(dir) {
  _auditPage += dir;
  renderAuditTable(_auditFilter);
  document.getElementById('content').scrollTop = 0;
}

function setAuditPage(p) {
  _auditPage = p;
  renderAuditTable(_auditFilter);
  document.getElementById('content').scrollTop = 0;
}

function renderAuditTable(filter) {
  const tbody = document.getElementById('audit-tbody');
  if (!tbody) return;

  const filtered = filter === 'all'
    ? _auditLogs
    : _auditLogs.filter(l => l.action === filter);

  const totalPages = Math.ceil(filtered.length / AUDIT_PAGE_SIZE);
  if (_auditPage > totalPages) _auditPage = totalPages || 1;

  const start = (_auditPage - 1) * AUDIT_PAGE_SIZE;
  const list = filtered.slice(start, start + AUDIT_PAGE_SIZE);

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7">
          <div class="empty-state">
            <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            <strong>لا توجد سجلات</strong>
          </div>
        </td></tr>`;
    renderPagination(0, 0);
    return;
  }

  tbody.innerHTML = list.map((log, i) => {
    const roleLabel = { admin: 'مدير النظام', manager: 'مدير', viewer: 'مشاهد' }[log.role] || log.role;
    const roleBadge = getRoleBadge(log.role);
    const actionCls = log.action === 'إضافة' ? 'text-success' : log.action === 'حذف' ? 'text-error' : 'text-warning';

    const ts = log.timestamp?.toDate?.();
    const dateStr = ts ? ts.toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
    const timeStr = ts ? ts.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', hour12: true }) : '';

    return `<tr>
          <td style="width:32px;color:var(--c-text-2);font-size:11px;">${start + i + 1}</td>
          <td>
            <div style="display:flex;align-items:center;gap:8px;">
              <div class="user-avatar" style="width:28px;height:28px;font-size:11px;flex-shrink:0;">
                ${(log.username || 'U')[0].toUpperCase()}
              </div>
              <div>
                <div class="fw-600" style="font-size:12.5px;">${_audEsc(log.username)}</div>
                <span class="${roleBadge}" style="font-size:9.5px;">${roleLabel}</span>
              </div>
            </div>
          </td>
          <td class="fw-600 ${actionCls}">${log.action}</td>
          <td><span class="badge badge-gray" style="font-size:10.5px;">${log.target_type || '—'}</span></td>
          <td class="fw-600" style="font-size:12.5px;">${_audEsc(log.target_name)}</td>
          <td style="font-size:12px;color:var(--c-text-2);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${_audEsc(log.details)}">
            ${_audEsc(log.details)}
          </td>
          <td>
            <div style="font-size:11.5px;color:var(--c-text);">${dateStr}</div>
            <div style="font-size:10.5px;color:var(--c-text-2);">${timeStr}</div>
          </td>
        </tr>`;
  }).join('');

  renderPagination(filtered.length, totalPages);
}

function renderPagination(totalItems, totalPages) {
  const wrap = document.getElementById('audit-pagination');
  if (!wrap) return;
  wrap.style.display = totalItems > AUDIT_PAGE_SIZE ? 'flex' : 'none';
  if (totalItems <= AUDIT_PAGE_SIZE) return;

  document.getElementById('audit-prev').disabled = (_auditPage === 1);
  document.getElementById('audit-next').disabled = (_auditPage === totalPages);

  const nums = document.getElementById('audit-page-numbers');
  let html = '';
  for (let p = 1; p <= totalPages; p++) {
    html += `<button class="pg-btn ${p === _auditPage ? 'active' : ''}" onclick="setAuditPage(${p})">${p}</button>`;
  }
  nums.innerHTML = html;
}

function _audEsc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _audEsc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
