/**
 * employees.js
 * Employee CRUD — manages the `employees` Firestore collection.
 * Delivery drivers are now stored separately in the `drivers` collection.
 */

let _employees = [];
let _filteredEmployees = [];
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
    if (_empUnsub) { supabase.removeChannel(_empUnsub); _empUnsub = null; }
    showTableLoading('emp-tbody', 7);

    try {
        const { data, error } = await supabase
            .from('employees')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        _employees = data || [];
        populateRoleFilter();
        applyEmployeeFilters();

        _empUnsub = supabase
            .channel('public:employees')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, payload => {
                if (payload.eventType === 'INSERT') {
                    _employees.unshift(payload.new);
                } else if (payload.eventType === 'UPDATE') {
                    const idx = _employees.findIndex(e => e.id === payload.new.id);
                    if (idx > -1) _employees[idx] = payload.new;
                } else if (payload.eventType === 'DELETE') {
                    _employees = _employees.filter(e => e.id !== payload.old.id);
                }
                populateRoleFilter();
                applyEmployeeFilters();
            })
            .subscribe();

    } catch (err) {
        console.error('[employees] load error:', err);
        showToast('فشل جلب الموظفين', 'error');
    }
}

function renderEmployeeTable(list) {
    const tbody = document.getElementById('emp-tbody');
    if (!tbody) return;

    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="7">
      <div class="empty-state">
        <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        <strong>لا يوجد موظفون</strong>
        <span>أضف أول موظف باستخدام زر "إضافة موظف" أعلاه.</span>
      </div>
    </td></tr>`;
        return;
    }

    const arabicCountryToCode = {
        'عراقي': 'iq', 'عراق': 'iq', 'العراق': 'iq',
        'مصري': 'eg', 'مصر': 'eg',
        'بنغلاديشي': 'bd', 'بنغلادش': 'bd', 'بنغلاديش': 'bd',
        'باكستاني': 'pk', 'باكستان': 'pk'
    };

    tbody.innerHTML = list.map((emp, i) => {
        const nat = (emp.nationality || '').trim();
        const gov = (emp.governorate || '').trim();
        let natHtml = '<span class="text-muted">—</span>';
        if (nat) {
            const code = arabicCountryToCode[nat] || '';
            let flagHtml = '';
            if (code) {
                flagHtml = `<img src="https://flagcdn.com/16x12/${code}.png" style="width: 16px; height: 12px; border-radius: 2px; border: 1px solid var(--c-border); flex-shrink: 0;" alt="${escHtml(nat)}">`;
            } else {
                flagHtml = `<span style="font-size: 14px; line-height: 1;">🌍</span>`;
            }
            let displayText = nat;
            if (nat === 'عراقي' && gov) {
                displayText += ` (${gov})`;
            }
            natHtml = `<span style="display: inline-flex; align-items: center; gap: 6px; font-weight: 600;">
                ${flagHtml}
                <span>${escHtml(displayText)}</span>
            </span>`;
        }

        return `
        <tr data-emp-id="${emp.id}" data-emp-name="${escHtml(emp.name)}" class="${_selectedEmpIds.has(emp.id) ? 'selected-row' : ''}">
          <td style="width:40px;">
            <label class="custom-checkbox">
              <input type="checkbox" ${_selectedEmpIds.has(emp.id) ? 'checked' : ''} onchange="toggleSelectEmp('${emp.id}', this.checked)">
              <span class="checkmark"></span>
            </label>
          </td>
          <td data-label="الرقم" class="text-muted serial-cell"></td>
          <td data-label="اسم الموظف" class="fw-600">${escHtml(emp.name)}</td>
          <td data-label="الجنسية / البلد">${natHtml}</td>
          <td data-label="الراتب الأساسي" class="highlight-cell">${formatCurrency(emp.base_salary)}</td>
          <td data-label="المسمى الوظيفي">
            <span class="badge ${getRoleBadgeClass(emp.role)}">${escHtml(emp.role)}</span>
          </td>
          <td data-label="رقم الهاتف" class="text-muted">${escHtml(emp.phone || '—')}</td>
          <td data-label="الإجراءات">
            <div class="tbl-actions">
              ${canWrite() ? `
              <button class="act-btn view" title="تعديل" onclick="openEmpModal('${emp.id}')">
                <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                تعديل
              </button>
              ${canDelete() ? `
              <button class="act-btn delete" title="حذف" onclick="deleteEmployee('${emp.id}')">
                <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              </button>` : ''}
    ` : ''}
            </div>
          </td>
        </tr>`;
    }).join('');
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
        const { error } = await supabase
            .from('employees')
            .delete()
            .in('id', idsToDelete);

        if (error) throw error;

        successCount = idsToDelete.length;

        logAudit('حذف جماعي', 'موظفين', `${successCount} موظف`, `تم حذف مجموعة من الموظفين بشكل جماعي.`);
        showToast(`تم حذف ${successCount} موظف بنجاح.`);

        _selectedEmpIds.clear();
        invalidateCache('employees');
        onSelectionChange();
        // ── Reverse Sync: remove deleted employees from Supabase ──
        if (typeof syncEmployeesToCloud === 'function') {
            for (const deletedId of idsToDelete) syncEmployeesToCloud(deletedId);
        }
    } catch (err) {
        console.error('[employees] bulk delete error:', err);
        showToast('حدث خطأ أثناء الحذف الجماعي.', 'error');
    }
}

function bindEmployeeSearch() {
    const input = document.getElementById('emp-search');
    const filter = document.getElementById('emp-role-filter');
    if (input) input.oninput = applyEmployeeFilters;
    if (filter) filter.onchange = applyEmployeeFilters;
}

function applyEmployeeFilters() {
    const q = document.getElementById('emp-search')?.value.toLowerCase() || '';
    const role = document.getElementById('emp-role-filter')?.value || '';

    _filteredEmployees = _employees.filter(e => {
        const matchesSearch = !q ||
            e.name.toLowerCase().includes(q) ||
            (e.role || '').toLowerCase().includes(q) ||
            (e.phone || '').includes(q);

        const matchesRole = !role || e.role === role;

        return matchesSearch && matchesRole;
    });

    renderEmployeeTable(_filteredEmployees);
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
        document.getElementById('emp-nationality').value = emp.nationality || '';
        document.getElementById('emp-governorate').value = emp.governorate || '';
    } else {
        titleEl.textContent = 'إضافة موظف جديد';
        document.getElementById('emp-nationality').value = '';
        document.getElementById('emp-governorate').value = '';
    }

    populateNationalitiesDatalist();
    toggleEmpGovernorateField();
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

    const nationality = document.getElementById('emp-nationality').value;
    const governorate = (nationality === 'عراقي') ? document.getElementById('emp-governorate').value.trim() : '';

    const data = { name, role, base_salary, phone, nationality, governorate };

    try {
        if (_editEmpId) {
            const { error } = await supabase.from('employees').update(data).eq('id', _editEmpId);
            if (error) throw error;
            showToast('تم تحديث بيانات الموظف بنجاح.');
            logAudit('تعديل', 'موظف', name, `الدور: ${role} | الراتب: ${base_salary}`);
        } else {
            const { error } = await supabase.from('employees').insert([data]);
            if (error) throw error;
            showToast('تم إضافة الموظف بنجاح.');
            logAudit('إضافة', 'موظف', name, `الدور: ${role} | الراتب: ${base_salary}`);
        }
        invalidateCache('employees');
        closeEmpModal();
        // ── Reverse Sync: push updated employee list to Supabase for Supervisor app ──
        if (typeof syncEmployeesToCloud === 'function') syncEmployeesToCloud();
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
        const { error } = await supabase.from('employees').delete().eq('id', id);
        if (error) throw error;
        logAudit('حذف', 'موظف', emp?.name || id, `الدور: ${emp?.role || '—'}`);
        invalidateCache('employees');
        showToast('تم حذف الموظف بنجاح.');
        // ── Reverse Sync: remove deleted employee from Supabase active_employees ──
        if (typeof syncEmployeesToCloud === 'function') syncEmployeesToCloud(id);
    } catch (err) {
        console.error('[employees] delete error:', err);
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

function toggleEmpGovernorateField() {
    const nat = document.getElementById('emp-nationality').value.trim();
    const govGroup = document.getElementById('emp-gov-group');
    if (govGroup) {
        govGroup.style.display = (nat === 'عراقي') ? 'block' : 'none';
    }
}

function populateNationalitiesDatalist() {
    const listEl = document.getElementById('emp-nationalities-list');
    if (!listEl) return;
    
    const defaults = ['عراقي', 'مصري', 'بنغلاديشي', 'باكستاني'];
    const existing = _employees.map(e => (e.nationality || '').trim()).filter(Boolean);
    const combined = [...new Set([...defaults, ...existing])].sort();
    
    listEl.innerHTML = combined.map(name => `<option value="${escHtml(name)}"></option>`).join('');
}

