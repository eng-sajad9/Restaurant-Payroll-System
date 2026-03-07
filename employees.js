/**
 * employees.js
 * Employee CRUD — manages the `employees` Firestore collection.
 * Delivery drivers are now stored separately in the `drivers` collection.
 */

let _employees = [];
let _editEmpId = null;

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
            renderEmployeeTable(_employees);
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
    <tr data-emp-id="${emp.id}" data-emp-name="${escHtml(emp.name)}">
      <td data-label="الرقم" class="text-muted">${i + 1}</td>
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
          <button class="act-btn delete" title="حذف" onclick="deleteEmployee('${emp.id}')">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>` : ''}
        </div>
      </td>
    </tr>`).join('');
}

function bindEmployeeSearch() {
    const input = document.getElementById('emp-search');
    if (!input) return;
    input.addEventListener('input', () => {
        const q = input.value.toLowerCase();
        renderEmployeeTable(q
            ? _employees.filter(e =>
                e.name.toLowerCase().includes(q) ||
                (e.role || '').toLowerCase().includes(q) ||
                (e.phone || '').includes(q))
            : _employees
        );
    });
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

    const data = { name, role, base_salary, phone };

    try {
        if (_editEmpId) {
            await db.collection('employees').doc(_editEmpId).update(data);
            showToast('تم تحديث بيانات الموظف بنجاح.');
            logAudit('تعديل', 'موظف', name, `الدور: ${role} | الراتب: ${base_salary}`);
        } else {
            data.created_at = firebase.firestore.FieldValue.serverTimestamp();
            await db.collection('employees').add(data);
            showToast('تم إضافة الموظف بنجاح.');
            logAudit('إضافة', 'موظف', name, `الدور: ${role} | الراتب: ${base_salary}`);
        }
        closeEmpModal();
        await loadEmployees();
    } catch (err) {
        console.error('[employees] save error:', err);
        showToast('فشل حفظ بيانات الموظف. يرجى المحاولة مرة أخرى.', 'error');
    } finally {
        saveBtn.disabled = false;
    }
}

async function deleteEmployee(id) {
    const confirmed = await showConfirm(
        'سيتم حذف الموظف نهائياً ولا يمكن التراجع عن هذا الإجراء. هل تريد المتابعة؟',
        'حذف الموظف'
    );
    if (!confirmed) return;

    try {
        await db.collection('employees').doc(id).delete();
        const emp = _employees.find(e => e.id === id);
        logAudit('حذف', 'موظف', emp?.name || id, `الدور: ${emp?.role || '—'}`);
        showToast('تم حذف الموظف بنجاح.');
        await loadEmployees();
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
