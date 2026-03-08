/**
 * employees.js
 * Employee CRUD — manages the `employees` Firestore collection.
 * Delivery drivers are now stored separately in the `drivers` collection.
 */

let _employees = [];
let _editEmpId = null;
let _selectedEmpIds = new Set();

/** Checks if an employee role is a delivery driver */
function isDriver(role) {
    const r = (role || '').toLowerCase();
    return r.includes('driver') || r.includes('delivery') ||
        r.includes('سائق') || r.includes('توصيل') || r.includes('دليفري');
}

async function initEmployees() {
    setBreadcrumb('الموظفون', 'إدارة سجلات موظفي المطعم');
    bindEmployeeSearch();
    await loadEmployees();
}

let _empUnsub = null;

async function loadEmployees() {
    if (_empUnsub) _empUnsub();
    showTableLoading('emp-tbody', 6);

    _empUnsub = db.collection('employees')
        .orderBy('created_at', 'desc')
        .onSnapshot(snap => {
            _employees = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            populateRoleFilter();
            applyEmployeeFilters();
        }, err => {
            console.error('[employees] listener error:', err);
            showToast('فشل المزامنة اللحظية للموظفين', 'error');
        });
}

function renderEmployeeTable(list) {
    const tbody = document.getElementById('emp-tbody');
    if (!tbody) return;

    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="6">
      <div class="empty-state">
        <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        <strong>لا يوجد موظفون</strong>
        <span>أضف أول موظف باستخدام زر "إضافة موظف" أعلاه.</span>
      </div>
    </td></tr>`;
        return;
    }

    tbody.innerHTML = list.map((emp, i) => `
    <tr data-emp-id="${emp.id}" data-emp-name="${escHtml(emp.name)}" class="${_selectedEmpIds.has(emp.id) ? 'selected-row' : ''}">
      <td style="width:40px;">
        <label class="custom-checkbox">
          <input type="checkbox" ${_selectedEmpIds.has(emp.id) ? 'checked' : ''} onchange="toggleSelectEmp('${emp.id}', this.checked)">
          <span class="checkmark"></span>
        </label>
      </td>
      <td data-label="الرقم" class="text-muted serial-cell"></td>
      <td data-label="اسم الموظف" class="fw-600">${escHtml(emp.name)}</td>
      <td data-label="الراتب الأساسي" class="highlight-cell">${formatCurrency(emp.base_salary)}</td>
      <td data-label="المسمى الوظيفي">
        <span class="badge ${getRoleBadgeClass(emp.role)}">${escHtml(emp.role)}</span>
      </td>
      <td data-label="رقم الهاتف" class="text-muted">${escHtml(emp.phone || '—')}</td>
      <td data-label="الإجراءات">
        <div class="tbl-actions">
          ${canWrite() ? `
          <button class="act-btn edit" title="تعديل" onclick="openEmpModal('${emp.id}')">
            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          ${canDelete() ? `
          <button class="act-btn delete" title="حذف" onclick="deleteEmployee('${emp.id}')">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>` : ''}
` : ''}
        </div>
      </td>
    </tr>`).join('');
}

// ─── Selection Logic ─────────────────────────────────────────────────────────

function toggleSelectAllEmps(checked) {
    const list = document.querySelectorAll('#emp-tbody input[type="checkbox"]');
    list.forEach(cb => cb.checked = checked);

    // Filtered list is what's currently in the table
    // (Assuming current list is available globally or we re-filter)
    // Actually better to just use the IDs of the employees currently shown in the table
    const rows = document.querySelectorAll('#emp-tbody tr[data-emp-id]');
    rows.forEach(row => {
        const id = row.getAttribute('data-emp-id');
        if (checked) _selectedEmpIds.add(id);
        else _selectedEmpIds.delete(id);
    });

    onSelectionChange();
}

function toggleSelectEmp(id, checked) {
    if (checked) _selectedEmpIds.add(id);
    else _selectedEmpIds.delete(id);

    // Update "Select All" state
    const selectAllCb = document.getElementById('emp-select-all');
    if (selectAllCb) {
        const rows = document.querySelectorAll('#emp-tbody tr[data-emp-id]');
        const allChecked = Array.from(rows).every(r => _selectedEmpIds.has(r.getAttribute('data-emp-id')));
        selectAllCb.checked = allChecked;
    }

    onSelectionChange();
}

function onSelectionChange() {
    const bar = document.getElementById('emp-bulk-actions');
    const countEl = document.getElementById('emp-selected-count');
    const selectedCount = _selectedEmpIds.size;

    console.log('[Bulk] Selection changed:', selectedCount);

    if (bar) {
        if (selectedCount > 0) {
            bar.classList.add('show');
            if (countEl) countEl.textContent = selectedCount;
        } else {
            bar.classList.remove('show');
        }
    }

    // Highlight selected rows
    const rows = document.querySelectorAll('#emp-tbody tr[data-emp-id]');
    rows.forEach(row => {
        const id = row.getAttribute('data-emp-id');
        if (_selectedEmpIds.has(id)) {
            row.classList.add('selected-row');
            const cb = row.querySelector('input[type="checkbox"]');
            if (cb) cb.checked = true;
        } else {
            row.classList.remove('selected-row');
            const cb = row.querySelector('input[type="checkbox"]');
            if (cb) cb.checked = false;
        }
    });

    // Update Select All checkbox
    const selectAllCb = document.getElementById('emp-select-all');
    if (selectAllCb && rows.length > 0) {
        const allCheckedInView = Array.from(rows).every(r => _selectedEmpIds.has(r.getAttribute('data-emp-id')));
        selectAllCb.checked = allCheckedInView;
    }
}

function clearEmployeeSelection() {
    _selectedEmpIds.clear();
    const selectAllCb = document.getElementById('emp-select-all');
    if (selectAllCb) selectAllCb.checked = false;

    const checkboxes = document.querySelectorAll('#emp-tbody input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = false);

    onSelectionChange();
}

async function bulkDeleteEmployees() {
    if (!canDelete()) {
        showToast('ليس لديك صلاحية الحذف.', 'error');
        return;
    }

    const count = _selectedEmpIds.size;
    if (count === 0) return;

    const ok = await showConfirm(`هل أنت متأكد من حذف ${count} موظفين نهائياً؟`, 'حذف جماعي');
    if (!ok) return;

    const idsToDelete = Array.from(_selectedEmpIds);
    let successCount = 0;

    try {
        const batch = db.batch();
        idsToDelete.forEach(id => {
            batch.delete(db.collection('employees').doc(id));
        });

        await batch.commit();
        successCount = idsToDelete.length;

        logAudit('حذف جماعي', 'موظفين', `${successCount} موظف`, `تم حذف مجموعة من الموظفين بشكل جماعي.`);
        showToast(`تم حذف ${successCount} موظف بنجاح.`);

        _selectedEmpIds.clear();
        invalidateCache('employees');
        onSelectionChange();
    } catch (err) {
        console.error('[employees] bulk delete error:', err);
        showToast('حدث خطأ أثناء الحذف الجماعي.', 'error');
    }
}

function bindEmployeeSearch() {
    const input = document.getElementById('emp-search');
    const filter = document.getElementById('emp-role-filter');
    if (input) input.addEventListener('input', applyEmployeeFilters);
    if (filter) filter.addEventListener('change', applyEmployeeFilters);
}

function applyEmployeeFilters() {
    const q = document.getElementById('emp-search')?.value.toLowerCase() || '';
    const role = document.getElementById('emp-role-filter')?.value || '';

    const filtered = _employees.filter(e => {
        const matchesSearch = !q ||
            e.name.toLowerCase().includes(q) ||
            (e.role || '').toLowerCase().includes(q) ||
            (e.phone || '').includes(q);

        const matchesRole = !role || e.role === role;

        return matchesSearch && matchesRole;
    });

    renderEmployeeTable(filtered);
}

function populateRoleFilter() {
    const filter = document.getElementById('emp-role-filter');
    if (!filter) return;

    const currentVal = filter.value;
    const roles = [...new Set(_employees.map(e => e.role).filter(Boolean))].sort();

    filter.innerHTML = '<option value="">الكل</option>' +
        roles.map(r => `<option value="${escHtml(r)}">${escHtml(r)}</option>`).join('');

    // Restore previous selection if still exists
    if (roles.includes(currentVal)) {
        filter.value = currentVal;
    }
}

function openEmpModal(id = null) {
    _editEmpId = id;
    const modal = document.getElementById('emp-modal');
    const titleEl = document.getElementById('emp-modal-title');
    document.getElementById('emp-form').reset();

    if (id) {
        const emp = _employees.find(e => e.id === id);
        if (!emp) return;
        titleEl.textContent = 'تعديل بيانات الموظف';
        document.getElementById('emp-name').value = emp.name;
        document.getElementById('emp-role').value = emp.role;
        document.getElementById('emp-salary').value = emp.base_salary.toLocaleString('en-US');
        document.getElementById('emp-phone').value = emp.phone || '';
    } else {
        titleEl.textContent = 'إضافة موظف جديد';
    }

    attachCurrencyInput(document.getElementById('emp-salary'));
    modal.classList.add('show');
}

function closeEmpModal() {
    document.getElementById('emp-modal').classList.remove('show');
}

async function saveEmployee() {
    const name = document.getElementById('emp-name').value.trim();
    const role = document.getElementById('emp-role').value.trim();
    const base_salary = getNumVal('emp-salary');
    const phone = document.getElementById('emp-phone').value.trim();

    if (!name || !role || isNaN(base_salary) || base_salary < 0) {
        showToast('يرجى تعبئة جميع الحقول المطلوبة بشكل صحيح.', 'error');
        return;
    }

    const saveBtn = document.getElementById('emp-save-btn');
    saveBtn.disabled = true;

    const duplicate = _employees.find(e =>
        e.name.trim().toLowerCase() === name.toLowerCase() && e.id !== _editEmpId
    );

    if (duplicate) {
        showToast(`الموظف "${name}" موجود مسبقاً.`, 'warning');
        saveBtn.disabled = false;
        return;
    }

    const data = { name, role, base_salary, phone };

    try {
        if (_editEmpId) {
            db.collection('employees').doc(_editEmpId).update(data);
            showToast('تم تحديث بيانات الموظف بنجاح.');
            logAudit('تعديل', 'موظف', name, `الدور: ${role} | الراتب: ${base_salary}`);
        } else {
            data.created_at = firebase.firestore.FieldValue.serverTimestamp();
            db.collection('employees').add(data);
            showToast('تم إضافة الموظف بنجاح.');
            logAudit('إضافة', 'موظف', name, `الدور: ${role} | الراتب: ${base_salary}`);
        }
        invalidateCache('employees');
        closeEmpModal();
    } catch (err) {
        console.error('[employees] save error:', err);
        showToast('فشل في بدء عملية الحفظ.', 'error');
    } finally {
        setTimeout(() => { saveBtn.disabled = false; }, 500);
    }
}

async function deleteEmployee(id) {
    const confirmed = await showConfirm(
        'سيتم حذف الموظف نهائياً ولا يمكن التراجع عن هذا الإجراء. هل تريد المتابعة؟',
        'حذف الموظف'
    );
    if (!confirmed) return;

    const emp = _employees.find(e => e.id === id);

    try {
        await db.collection('employees').doc(id).delete();
        logAudit('حذف', 'موظف', emp?.name || id, `الدور: ${emp?.role || '—'}`);
        invalidateCache('employees');
        showToast('تم حذف الموظف بنجاح.');
    } catch (err) {
        showToast('فشل حذف الموظف.', 'error');
    }
}

function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getRoleBadgeClass(role) {
    if (!role) return 'badge-gray';
    if (role.includes('مدير') || role.includes('إدارة')) return 'badge-purple';
    if (role.includes('شيف') || role.includes('طباخ')) return 'badge-orange';
    if (role.includes('مقدم') || role.includes('ويتر') || role.includes('كابتن')) return 'badge-blue';
    if (role.includes('كاشير') || role.includes('حسابات')) return 'badge-green';
    return 'badge-gray';
}
