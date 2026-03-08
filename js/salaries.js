/**
 * salaries.js
 * Monthly salary records with searchable employee picker.
 */

let _salaries = [];
let _allEmps = [];
let _editSalId = null;
let _salMonth = getCurrentMonth();
let _selectedEmpId = '';   // tracks the selected employee in the searchable picker

async function initSalaries() {
    setBreadcrumb('الرواتب الشهرية', 'إدارة سجلات الرواتب الشهرية');

    const mSel = document.getElementById('sal-month');
    if (mSel) {
        mSel.innerHTML = buildMonthOptions(_salMonth);
        mSel.addEventListener('change', () => {
            _salMonth = mSel.value;
            loadSalaries(_salMonth);
        });
    }

    const empSnap = await db.collection('employees').orderBy('name').get();
    _allEmps = empSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    await loadSalaries(_salMonth);
}

// ─── Load & Render ────────────────────────────────────────────────────────────

let _salUnsub = null;

async function loadSalaries(month) {
    if (_salUnsub) _salUnsub();
    showTableLoading('sal-tbody', 6);
    const labelEl = document.getElementById('sal-month-label');
    if (labelEl) labelEl.textContent = getMonthLabel(month);

    _salUnsub = db.collection('salaries')
        .where('month', '==', month)
        .onSnapshot(snap => {
            _salaries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderSalaryTable(_salaries);
        }, err => {
            console.error('[salaries] listener error:', err);
            showToast('فشل المزامنة اللحظية للرواتب.', 'error');
        });
}

function renderSalaryTable(list) {
    const tbody = document.getElementById('sal-tbody');
    if (!tbody) return;

    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="6">
      <div class="empty-state">
        <svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        <strong>لا توجد سجلات لهذا الشهر</strong>
        <span>اضغط على "إضافة سجل" لإنشاء سجل راتب.</span>
      </div>
    </td></tr>`;
        return;
    }

    const empMap = Object.fromEntries(_allEmps.map(e => [e.id, e]));
    let totalFinal = 0;

    const rows = list.map((sal, idx) => {
        const emp = empMap[sal.employee_id] || {};
        const empName = emp.name || sal.employee_id || '—';
        const CACHE_NAME = 'payroll-system-v3';
        totalFinal += sal.final_salary || 0;

        return `<tr data-sal-id="${sal.id}" data-emp-id="${sal.employee_id}">
          <td data-label="ت" class="fw-600" style="color:var(--c-text-3);width:50px;">${idx + 1}</td>
          <td data-label="اسم الموظف" class="fw-600">${escHtml(empName)}</td>
          <td data-label="الراتب الأساسي">${formatCurrency(emp.base_salary || 0)}</td>
          <td data-label="المكافأة" class="text-success fw-600">+${formatCurrency(sal.bonus || 0)}</td>
          <td data-label="الخصم">
            <span class="badge badge-red">−${formatCurrency(sal.deduction || 0)}</span>
            ${sal.deduction_note ? `<div style="font-size:11px;color:var(--c-text-2);margin-top:4px;">${escHtml(sal.deduction_note)}</div>` : ''}
          </td>
          <td data-label="صافي الراتب" class="highlight-cell fw-600">${formatCurrency(sal.final_salary || 0)}</td>
          <td data-label="الإجراءات">
            <div class="tbl-actions">
              ${canWrite() ? `
              <button class="act-btn edit" title="تعديل" onclick="openSalModal('${sal.id}')">
                <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              ${canDelete() ? `
              <button class="act-btn delete" title="حذف" onclick="deleteSalary('${sal.id}')">
                <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              </button>` : ''}
` : '—'}
            </div>
          </td>
        </tr>`;
    });

    rows.push(`<tr class="summary-row">
      <td colspan="5" class="text-right">المجموع النهائي لصافي الرواتب</td>
      <td class="highlight-cell fw-600">${formatCurrency(totalFinal)}</td>
      <td></td>
    </tr>`);

    tbody.innerHTML = rows.join('');
}

// ─── Searchable Employee Picker ───────────────────────────────────────────────

/**
 * Filter the employee datalist/select based on search input.
 * Called on every keystroke in the search box.
 */
function filterSalEmployees() {
    const search = document.getElementById('sal-emp-search');
    const list = document.getElementById('sal-emp-list');
    if (!search || !list) return;

    const q = search.value.toLowerCase().trim();

    // Clear hidden ID when user types (they must re-select)
    _selectedEmpId = '';
    document.getElementById('sal-emp-hidden').value = '';
    updateSalaryPreview();

    // Filter employees and rebuild dropdown list
    const filtered = q
        ? _allEmps.filter(e =>
            e.name.toLowerCase().includes(q) ||
            (e.role || '').toLowerCase().includes(q))
        : _allEmps;

    if (!filtered.length) {
        list.innerHTML = `<div class="emp-picker-item emp-picker-empty">لا توجد نتائج</div>`;
        list.style.display = 'block';
        return;
    }

    list.innerHTML = filtered.slice(0, 50).map(e => `
        <div class="emp-picker-item" data-id="${e.id}" onclick="selectSalEmployee('${e.id}', '${escHtml(e.name)}', '${escHtml(e.role)}')">
      <span class="emp-picker-name">${escHtml(e.name)}</span>
      <span class="emp-picker-role">${escHtml(e.role)} — ${formatCurrency(e.base_salary)}</span>
    </div>`).join('');

    list.style.display = 'block';
}

function selectSalEmployee(id, name, role) {
    _selectedEmpId = id;
    document.getElementById('sal-emp-search').value = name;
    document.getElementById('sal-emp-hidden').value = id;
    document.getElementById('sal-emp-list').style.display = 'none';
    updateSalaryPreview();
}

function closeSalEmployeePicker() {
    setTimeout(() => {
        const list = document.getElementById('sal-emp-list');
        if (list) list.style.display = 'none';
    }, 200);
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function openSalModal(id = null) {
    _editSalId = id;
    _selectedEmpId = '';
    const titleEl = document.getElementById('sal-modal-title');
    document.getElementById('sal-form').reset();
    document.getElementById('sal-emp-hidden').value = '';
    document.getElementById('sal-emp-list').style.display = 'none';

    ['sal-bonus', 'sal-deduction'].forEach(i => attachCurrencyInput(document.getElementById(i)));

    if (id) {
        const sal = _salaries.find(s => s.id === id);
        if (!sal) return;
        titleEl.textContent = 'تعديل سجل الراتب';
        _selectedEmpId = sal.employee_id;
        document.getElementById('sal-emp-hidden').value = sal.employee_id;
        const emp = _allEmps.find(e => e.id === sal.employee_id);
        if (emp) document.getElementById('sal-emp-search').value = emp.name;
        document.getElementById('sal-bonus').value = (sal.bonus || 0).toLocaleString('en-US');
        document.getElementById('sal-deduction').value = (sal.deduction || 0).toLocaleString('en-US');
        const noteEl = document.getElementById('sal-deduction-note');
        if (noteEl) noteEl.value = sal.deduction_note || '';
        updateSalaryPreview();
    } else {
        titleEl.textContent = 'إضافة سجل راتب';
        document.getElementById('sal-bonus').value = '0';
        document.getElementById('sal-deduction').value = '0';
    }

    document.getElementById('sal-modal').classList.add('show');
}

function closeSalModal() {
    document.getElementById('sal-modal').classList.remove('show');
}

function updateSalaryPreview() {
    const empId = document.getElementById('sal-emp-hidden').value;
    const bonus = getNumVal('sal-bonus');
    const deduct = getNumVal('sal-deduction');
    const emp = _allEmps.find(e => e.id === empId);
    const base = emp ? emp.base_salary : 0;
    const final = Math.max(0, base + bonus - deduct);
    const prevEl = document.getElementById('sal-preview');
    if (prevEl) {
        prevEl.textContent = empId
            ? `الراتب النهائي: ${formatCurrency(final)} `
            : 'الراتب النهائي: — (اختر موظفاً)';
    }
}

// ─── Save ─────────────────────────────────────────────────────────────────────

async function saveSalary() {
    const empId = document.getElementById('sal-emp-hidden').value;
    const bonus = getNumVal('sal-bonus');
    const deduct = getNumVal('sal-deduction');
    const note = (document.getElementById('sal-deduction-note')?.value || '').trim();

    if (!empId) { showToast('يرجى اختيار موظف من القائمة.', 'error'); return; }

    const emp = _allEmps.find(e => e.id === empId);
    const base = emp ? emp.base_salary : 0;
    const final = Math.max(0, base + bonus - deduct);

    const saveBtn = document.getElementById('sal-save-btn');
    saveBtn.disabled = true;

    const data = { employee_id: empId, month: _salMonth, bonus, deduction: deduct, final_salary: final, deduction_note: note };

    try {
        if (_editSalId) {
            db.collection('salaries').doc(_editSalId).update(data);
            const empName = emp?.name || empId;
            showToast('تم تحديث سجل الراتب بنجاح.');
            logAudit('تعديل', 'راتب', empName, `الشهر: ${getMonthLabel(_salMonth)} | الراتب: ${final} (مكافأة: ${bonus}، خصم: ${deduct})`);
        } else {
            // Duplicate check (still helpful but technically might fail offline if cache is stale, 
            // but for salaries we usually fetch by month so it's okay)
            const dup = await db.collection('salaries')
                .where('employee_id', '==', empId)
                .where('month', '==', _salMonth)
                .limit(1).get();

            if (!dup.empty) {
                showToast('يوجد سجل لهذا الموظف في هذا الشهر مسبقاً.', 'warning');
                saveBtn.disabled = false;
                return;
            }
            data.created_at = firebase.firestore.FieldValue.serverTimestamp();
            db.collection('salaries').add(data);
            const empName = emp?.name || empId;
            showToast('تم إضافة سجل الراتب بنجاح.');
            logAudit('إضافة', 'راتب', empName, `الشهر: ${getMonthLabel(_salMonth)} | الراتب: ${final} (مكافأة: ${bonus}، خصم: ${deduct})`);
        }
        invalidateCache('salaries');
        closeSalModal();
    } catch (err) {
        console.error('[salaries] save error:', err);
        showToast('فشل في بدء عملية حفظ الراتب.', 'error');
    } finally {
        setTimeout(() => { saveBtn.disabled = false; }, 500);
    }
}

// ─── Delete ───────────────────────────────────────────────────────────────────

async function deleteSalary(id) {
    if (!canDelete()) {
        showToast('ليس لديك صلاحية الحذف.', 'error');
        return;
    }
    const ok = await showConfirm('هل تريد حذف سجل هذا الراتب نهائياً؟', 'حذف السجل');
    if (!ok) return;
    try {
        await db.collection('salaries').doc(id).delete();
        invalidateCache('salaries');
        const sal = _salaries.find(s => s.id === id);
        const emp = _allEmps.find(e => e.id === sal?.employee_id);
        logAudit('حذف', 'راتب', emp?.name || sal?.employee_id || id, `الشهر: ${getMonthLabel(sal?.month || '')} `);
        showToast('تم حذف السجل بنجاح.');
    } catch (err) {
        showToast('فشل حذف السجل.', 'error');
    }
}

function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── حاسبة خصم الغياب ────────────────────────────────────────────────────────

/**
 * Calculates the deduction amount for absent days.
 * Formula: Daily Rate = Base Salary / Working Days
 *          Deduction  = Daily Rate × Absent Days
 */
function calcAbsenceDeduction() {
    const absentEl = document.getElementById('sal-absent-days');
    const workEl = document.getElementById('sal-work-days');
    const resultEl = document.getElementById('sal-absence-val');

    const absent = parseFloat(absentEl?.value) || 0;
    const workDays = parseFloat(workEl?.value) || 30;
    const empId = document.getElementById('sal-emp-hidden')?.value;
    const emp = _allEmps.find(e => e.id === empId);
    const base = emp ? emp.base_salary : 0;

    if (!base || absent <= 0) {
        if (resultEl) resultEl.textContent = '—';
        return 0;
    }

    const dailyRate = base / workDays;
    const deduction = Math.round(dailyRate * absent);
    if (resultEl) resultEl.textContent = formatCurrency(deduction);
    return deduction;
}

/**
 * Apply the calculated absence deduction into the deduction input field.
 */
function applyAbsenceDeduction() {
    const deduction = calcAbsenceDeduction();
    if (!deduction) { showToast('يرجى اختيار الموظف وإدخال عدد أيام الغياب أولاً.', 'warning'); return; }
    const el = document.getElementById('sal-deduction');
    if (el) {
        el.value = deduction.toLocaleString('en-US');
        updateSalaryPreview();
        showToast(`تم احتساب الخصم: ${formatCurrency(deduction)} `, 'info');
    }
}

function filterSalaries() {
    const q = document.getElementById('sal-search').value.toLowerCase();
    const empMap = Object.fromEntries(_allEmps.map(e => [e.id, e]));
    const filtered = _salaries.filter(sal => {
        const emp = empMap[sal.employee_id] || {};
        return (emp.name || '').toLowerCase().includes(q);
    });
    renderSalaryTable(filtered);
}
