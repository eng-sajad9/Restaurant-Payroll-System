/**
 * salaries.js
 * Monthly salary records with searchable employee picker.
 */

let _salaries = [];
let _filteredSalaries = []; // Track currently filtered records for export
let _allEmps = [];
let _editSalId = null;
let _salMonth = getCurrentMonth();
let _selectedEmpId = '';   // tracks the selected employee in the searchable picker

async function initSalaries() {
    setBreadcrumb('الرواتب الشهرية', 'إدارة سجلات الرواتب الشهرية');

    const mSel = document.getElementById('sal-month');
    if (mSel) {
        mSel.innerHTML = buildMonthOptions(_salMonth);
        mSel.onchange = () => {
            _salMonth = mSel.value;
            loadSalaries(_salMonth);
        };
    }

    const { data: empData, error: empErr } = await supabase.from('employees').select('*').order('name');
    if (empErr) console.error(empErr);
    _allEmps = empData || [];

    await loadSalaries(_salMonth);
}

// ─── Load & Render ────────────────────────────────────────────────────────────

let _salUnsub = null;

async function loadSalaries(month) {
    if (_salUnsub) { supabase.removeChannel(_salUnsub); _salUnsub = null; }
    showTableLoading('sal-tbody', 6);
    const labelEl = document.getElementById('sal-month-label');
    if (labelEl) labelEl.textContent = getMonthLabel(month);

    try {
        const { data, error } = await supabase
            .from('salaries')
            .select('*')
            .eq('month', month);
            
        if (error) throw error;
        _salaries = data || [];
        populateSalRoleFilter();
        filterSalaries();

        _salUnsub = supabase
            .channel('public:salaries')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'salaries', filter: `month=eq.${month}` }, async () => {
                const { data } = await supabase.from('salaries').select('*').eq('month', month);
                _salaries = data || [];
                populateSalRoleFilter();
                filterSalaries();
            })
            .subscribe();

    } catch (err) {
        console.error('[salaries] listener error:', err);
        showToast('فشل المزامنة اللحظية للرواتب.', 'error');
    }
}

function renderSalaryTable(list) {
    const tbody = document.getElementById('sal-tbody');
    if (!tbody) return;

    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="9">
      <div class="empty-state">
        <svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        <strong>لا توجد سجلات لهذا الشهر</strong>
        <span>اضغط على "توليد رواتب الشهر" أو "إضافة سجل" للبدء.</span>
      </div>
    </td></tr>`;
        return;
    }

    const empMap = Object.fromEntries(_allEmps.map(e => [e.id, e]));
    let totalFinal = 0;

    const rows = list.map((sal, idx) => {
        const emp = empMap[sal.employee_id];
        const empName = emp ? emp.name : (sal.employee_name || sal.employee_id || '—');
        const isDeleted = !emp;
        totalFinal += sal.final_salary || 0;

        const status = sal.status || 'draft';
        let statusBadge = '';
        if (status === 'paid') {
            const methodLabel = sal.payment_method === 'cash' ? 'نقداً' : (sal.payment_method === 'bank_transfer' ? 'تحويل بنكي' : sal.payment_method || '');
            statusBadge = `<span class="badge badge-paid" title="تم الصرف بواسطة: ${escHtml(sal.paid_by || '—')}">${escHtml(methodLabel)}</span>`;
        } else if (status === 'approved') {
            statusBadge = `<span class="badge badge-approved">معتمد</span>`;
        } else {
            statusBadge = `<span class="badge badge-draft">مسودة</span>`;
        }

        const isPaid = status === 'paid';
        const actionsHtml = `
            <div class="tbl-actions">
              ${isPaid ? `
                <button class="act-btn view" title="وصل استلام الراتب" onclick="openReceiptModal('${sal.id}')">
                  <svg viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
                  كشف الاستلام
                </button>
                ${(isAdmin()) ? `
                <button class="act-btn delete" title="إلغاء الصرف (فك القفل)" onclick="revertPayout('${sal.id}')">
                  <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
                </button>` : ''}
              ` : `
                ${canWrite() ? `
                <button class="act-btn edit" title="تصفية وصرف الراتب" onclick="openSalModal('${sal.id}')">
                  <svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>
                  تصفية وصرف
                </button>
                ${canDelete() ? `
                <button class="act-btn delete" title="حذف" onclick="deleteSalary('${sal.id}')">
                  <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                </button>` : ''}
                ` : '—'}
              `}
            </div>
        `;

        const empRole = emp ? emp.role : '—';

        return `<tr data-sal-id="${sal.id}" data-emp-id="${sal.employee_id}" class="${isPaid ? 'paid-row' : ''}">
          <td data-label="ت" class="serial-cell fw-600" style="color:var(--c-text-3);width:50px;"></td>
          <td data-label="اسم الموظف" class="fw-600">
            ${escHtml(empName)}
            ${isDeleted ? ' <span class="text-danger" style="font-size:11px; margin-right:4px;">(محذوف)</span>' : ''}
          </td>
          <td data-label="الوظيفة"><span class="badge ${getRoleBadgeClass(empRole)}" style="font-size:11px;">${escHtml(empRole)}</span></td>
          <td data-label="الراتب الأساسي">${formatCurrency(emp ? emp.base_salary : 0)}</td>
          <td data-label="المكافأة" class="text-success fw-600">+${formatCurrency(sal.bonus || 0)}</td>
          <td data-label="الخصم">
            <span class="badge badge-red">−${formatCurrency(sal.deduction || 0)}</span>
            ${sal.deduction_note ? `<div style="font-size:11px;color:var(--c-text-2);margin-top:4px;">${escHtml(sal.deduction_note)}</div>` : ''}
          </td>
          <td data-label="صافي الراتب" class="highlight-cell fw-600">${formatCurrency(sal.final_salary || 0)}</td>
          <td data-label="الحالة">${statusBadge}</td>
          <td data-label="الإجراءات">${actionsHtml}</td>
        </tr>`;
    });

    rows.push(`<tr class="summary-row">
      <td colspan="6" class="text-right fw-600">المجموع النهائي لصافي الرواتب</td>
      <td class="highlight-cell fw-600">${formatCurrency(totalFinal)}</td>
      <td colspan="2"></td>
    </tr>`);

    tbody.innerHTML = rows.join('');
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function openSalModal(id) {
    if (!id) return;
    _editSalId = id;
    const titleEl = document.getElementById('sal-modal-title');
    document.getElementById('sal-form').reset();

    const sal = _salaries.find(s => s.id === id);
    if (!sal) return;

    titleEl.textContent = 'تعديل سجل الراتب';
    
    const emp = _allEmps.find(e => e.id === sal.employee_id);
    const empName = emp ? emp.name : (sal.employee_name || '—');
    
    document.getElementById('sal-emp-name-display').textContent = empName;
    document.getElementById('sal-emp-hidden').value = sal.employee_id;
    
    ['sal-bonus', 'sal-deduction'].forEach(i => attachCurrencyInput(document.getElementById(i)));

    document.getElementById('sal-bonus').value = (sal.bonus || 0).toLocaleString('en-US');
    document.getElementById('sal-deduction').value = (sal.deduction || 0).toLocaleString('en-US');
    
    const noteEl = document.getElementById('sal-deduction-note');
    if (noteEl) noteEl.value = sal.deduction_note || '';

    updateSalaryPreview();
    
    // Load and display supervisor deduction logs
    loadSalSupervisorLogs(sal.employee_id, sal.month);

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
        prevEl.textContent = `الراتب النهائي: ${formatCurrency(final)}`;
    }
}

async function saveSalaryDraft() {
    if (!_editSalId) return;

    const empId = document.getElementById('sal-emp-hidden').value;
    const bonus = getNumVal('sal-bonus');
    const deduct = getNumVal('sal-deduction');
    const note = (document.getElementById('sal-deduction-note')?.value || '').trim();

    const emp = _allEmps.find(e => e.id === empId);
    const base = emp ? emp.base_salary : 0;
    const final = Math.max(0, base + bonus - deduct);

    const draftBtn = document.getElementById('sal-draft-btn');
    if (draftBtn) draftBtn.disabled = true;

    const data = {
        employee_id: empId,
        employee_name: emp?.name || '',
        month: _salMonth,
        bonus,
        deduction: deduct,
        final_salary: final,
        deduction_note: note,
        status: 'draft'
    };

    try {
        const { error } = await supabase.from('salaries').update(data).eq('id', _editSalId);
        if (error) throw error;
        
        // Update local memory state synchronously
        const idx = _salaries.findIndex(s => s.id === _editSalId);
        if (idx > -1) {
            _salaries[idx] = {
                ..._salaries[idx],
                ...data
            };
        }
        
        const empName = emp?.name || empId;
        showToast('تم حفظ سجل الراتب كمسودة بنجاح.');
        logAudit('تعديل', 'راتب', empName, `تعديل وحفظ مسودة الراتب للشهر: ${getMonthLabel(_salMonth)} | صافي الراتب: ${final}`);
        
        invalidateCache('salaries');
        closeSalModal();
        filterSalaries();
    } catch (err) {
        console.error('[salaries] save draft error:', err);
        showToast('فشل في حفظ مسودة الراتب.', 'error');
    } finally {
        if (draftBtn) setTimeout(() => { draftBtn.disabled = false; }, 500);
    }
}

async function saveSalaryAndPay() {
    if (!_editSalId) return;

    const empId = document.getElementById('sal-emp-hidden').value;
    const bonus = getNumVal('sal-bonus');
    const deduct = getNumVal('sal-deduction');
    const note = (document.getElementById('sal-deduction-note')?.value || '').trim();
    const currentUser = getCurrentUser();

    const emp = _allEmps.find(e => e.id === empId);
    const base = emp ? emp.base_salary : 0;
    const final = Math.max(0, base + bonus - deduct);
    const empName = emp?.name || empId;

    const ok = await showConfirm(
        `تنبيه: أنت بصدد صرف الراتب للموظف "${empName}" نقداً (كاش) بمبلغ ${formatCurrency(final)} وقفل السجل.\nهل تريد إتمام الصرف؟`,
        'تأكيد صرف الراتب النهائي'
    );
    if (!ok) return;

    const saveBtn = document.getElementById('sal-save-btn');
    saveBtn.disabled = true;

    const data = {
        employee_id: empId,
        employee_name: emp?.name || '',
        month: _salMonth,
        bonus,
        deduction: deduct,
        final_salary: final,
        deduction_note: note,
        status: 'paid',
        payment_method: 'cash',
        paid_at: new Date().toISOString(),
        paid_by: currentUser ? currentUser.username : 'نظام'
    };

    try {
        const { error } = await supabase.from('salaries').update(data).eq('id', _editSalId);
        if (error) throw error;
        
        // Update local memory state synchronously
        const idx = _salaries.findIndex(s => s.id === _editSalId);
        if (idx > -1) {
            _salaries[idx] = {
                ..._salaries[idx],
                ...data
            };
        }
        
        showToast(`تم صرف وتثبيت الراتب للموظف "${empName}" بنجاح وقفل السجل.`);
        logAudit('تعديل', 'راتب', empName, `تصفية وصرف راتب الشهر: ${getMonthLabel(_salMonth)} | الراتب المصروف: ${final} (كاش)`);
        
        invalidateCache('salaries');
        const paidSalId = _editSalId;
        closeSalModal();
        filterSalaries();
        openReceiptModal(paidSalId);
    } catch (err) {
        console.error('[salaries] save and pay error:', err);
        showToast('فشل في حفظ وصرف الراتب.', 'error');
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
        const { error } = await supabase.from('salaries').delete().eq('id', id);
        if (error) throw error;
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

function populateSalRoleFilter() {
    const filter = document.getElementById('sal-role-filter');
    if (!filter) return;

    const currentVal = filter.value;
    const empMap = Object.fromEntries(_allEmps.map(e => [e.id, e]));

    // Get roles of employees who have a salary record this month
    const roles = [...new Set(_salaries.map(s => {
        const emp = empMap[s.employee_id];
        return emp?.role || '';
    }).filter(Boolean))].sort();

    filter.innerHTML = '<option value="">الكل</option>' +
        roles.map(r => `<option value="${escHtml(r)}">${escHtml(r)}</option>`).join('');

    if (roles.includes(currentVal)) {
        filter.value = currentVal;
    }
}

function filterSalaries() {
    const q = (document.getElementById('sal-search')?.value || '').toLowerCase().trim();
    const roleFilt = document.getElementById('sal-role-filter')?.value || '';
    const empMap = Object.fromEntries(_allEmps.map(e => [e.id, e]));

    _filteredSalaries = _salaries.filter(sal => {
        const emp = empMap[sal.employee_id] || {};
        const name = (emp.name || '').toLowerCase();
        const role = emp.role || '';

        const nameMatch = !q || name.includes(q);
        const roleMatch = !roleFilt || role === roleFilt;

        return nameMatch && roleMatch;
    });

    renderSalaryTable(_filteredSalaries);
}

// ─── Monthly Payroll Bulk Generation ──────────────────────────────────────────
async function generateMonthlyPayroll() {
    if (!canWrite()) {
        showToast('ليس لديك صلاحية لإجراء هذه العملية.', 'error');
        return;
    }
    
    const confirmGen = await showConfirm(
        `هل تريد توليد مسودات رواتب لجميع موظفي المطعم لشهر ${getMonthLabel(_salMonth)}؟\n(لن يتم تكرار السجلات الموجودة مسبقاً)`,
        'توليد كشف الرواتب'
    );
    if (!confirmGen) return;

    showTableLoading('sal-tbody', 8);

    try {
        // 1. Fetch active employees (we generate for all registered employees now)
        const { data: emps, error: empErr } = await supabase.from('employees').select('*');
        if (empErr) throw empErr;

        if (!emps || emps.length === 0) {
            showToast('لا يوجد موظفون لتوليد رواتبهم.', 'warning');
            await loadSalaries(_salMonth);
            return;
        }

        // 2. Fetch existing salaries for the month
        const { data: existingSalaries, error: salErr } = await supabase.from('salaries').select('*').eq('month', _salMonth);
        if (salErr) throw salErr;

        const existingEmpIds = new Set((existingSalaries || []).map(s => s.employee_id));

        // 3. Find employees who need salary sheets
        const empsToInsert = emps.filter(e => !existingEmpIds.has(e.id));

        if (empsToInsert.length === 0) {
            showToast('تم توليد كشف الرواتب لجميع الموظفين لهذا الشهر مسبقاً.', 'info');
            await loadSalaries(_salMonth);
            return;
        }

        // 4. Fetch all supervisor deductions for this month to auto-apply them
        const { data: allDeductions, error: deductErr } = await supabase
            .from('deduction_logs')
            .select('*')
            .eq('month', _salMonth);

        if (deductErr) console.warn('[salaries] failed to fetch deductions during generation:', deductErr);
        
        const deductionMap = {};
        if (allDeductions && allDeductions.length > 0) {
            allDeductions.forEach(d => {
                if (!deductionMap[d.employee_id]) {
                    deductionMap[d.employee_id] = { total: 0, notes: [], bys: [] };
                }
                deductionMap[d.employee_id].total += d.amount || 0;
                if (d.note) {
                    const dt = new Date(d.added_at);
                    const dateFormatted = dt.toLocaleDateString('ar-SA', { day: 'numeric', month: 'short' });
                    deductionMap[d.employee_id].notes.push(`[${dateFormatted} - ${d.added_by}] ${d.note}`);
                }
                if (d.added_by && !deductionMap[d.employee_id].bys.includes(d.added_by)) {
                    deductionMap[d.employee_id].bys.push(d.added_by);
                }
            });
        }

        // 5. Create draft records
        const records = empsToInsert.map(e => {
            const deductData = deductionMap[e.id] || { total: 0, notes: [], bys: [] };
            const finalSalary = Math.max(0, e.base_salary - deductData.total);
            return {
                employee_id: e.id,
                employee_name: e.name,
                month: _salMonth,
                bonus: 0,
                deduction: deductData.total,
                final_salary: finalSalary,
                deduction_note: deductData.notes.join(' | '),
                deduction_by: deductData.bys.join(', '),
                deduction_at: deductData.total > 0 ? new Date().toISOString() : null,
                status: 'draft',
                payment_method: '',
                paid_at: null,
                paid_by: null
            };
        });

        // Bulk insert using local mock adapter
        const { error: insertErr } = await supabase.from('salaries').insert(records);
        if (insertErr) throw insertErr;

        showToast(`تم بنجاح توليد مسودات رواتب ${records.length} موظف لشهر ${getMonthLabel(_salMonth)}.`);
        logAudit('إضافة', 'رواتب', `كشف شهري`, `توليد رواتب ${records.length} موظف لشهر ${_salMonth}`);
        
        invalidateCache('salaries');
    } catch (err) {
        console.error('[salaries] generate error:', err);
        showToast('فشل توليد كشف الرواتب.', 'error');
    }
    
    await loadSalaries(_salMonth);
}



// ─── Admin Override Revert lock ────────────────────────────────────────────────
async function revertPayout(salaryId) {
    if (!isAdmin()) {
        showToast('غير مصرح. هذا الإجراء لمدير النظام فقط.', 'error');
        return;
    }

    const sal = _salaries.find(s => s.id === salaryId);
    const empName = sal ? sal.employee_name : salaryId;

    const ok = await showConfirm(
        `تنبيه: أنت بصدد إلغاء الصرف للموظف "${empName}" وإرجاعه لحالة المسودة (Draft).\nسيتم فك القفل لتمكين التعديل. هل تريد الاستمرار؟`,
        'فك قفل وإلغاء صرف الراتب'
    );
    if (!ok) return;

    try {
        const updateData = {
            status: 'draft',
            payment_method: '',
            paid_at: null,
            paid_by: null
        };

        const { error } = await supabase.from('salaries').update(updateData).eq('id', salaryId);
        if (error) throw error;

        showToast(`تم فك القفل وإعادة الراتب إلى مسودة بنجاح للموظف "${empName}".`);
        logAudit('تعديل', 'راتب', empName, `إلغاء صرف الراتب وإعادته لمسودة للشهر: ${getMonthLabel(_salMonth)}`);
        
        invalidateCache('salaries');
    } catch (err) {
        console.error('[salaries] revert payout error:', err);
        showToast('فشل عملية إلغاء صرف الراتب وفك القفل.', 'error');
    }
}

// ─── Salary Receipt Slip Print & Modal Preview ─────────────────────────────────
function openReceiptModal(salaryId) {
    const sal = _salaries.find(s => s.id === salaryId);
    if (!sal) return;

    const emp = _allEmps.find(e => e.id === sal.employee_id);
    const roleLabel = emp ? emp.role : 'موظف';
    const paidDate = sal.paid_at ? new Date(sal.paid_at) : null;
    const dateStr = paidDate ? paidDate.toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
    const timeStr = paidDate ? paidDate.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', hour12: true }) : '';
    const bonusVal = sal.bonus || 0;
    const deductVal = sal.deduction || 0;
    const finalVal = sal.final_salary || 0;
    const baseVal = emp ? emp.base_salary : (sal.final_salary - bonusVal + deductVal);

    const voucherHtml = `
      <div class="voucher-preview-box">
        <div class="voucher-header">
          <div class="voucher-title">وصل صرف راتب شهري</div>
          <div class="voucher-subtitle">نظام إدارة رواتب المطعم — وثيقة رسمية</div>
        </div>

        <div class="voucher-details-grid">
          <div class="voucher-field">
            <span class="voucher-label">اسم الموظف</span>
            <span class="voucher-value">${escHtml(sal.employee_name)}</span>
          </div>
          <div class="voucher-field">
            <span class="voucher-label">المسمّى الوظيفي</span>
            <span class="voucher-value">${escHtml(roleLabel)}</span>
          </div>
          <div class="voucher-field">
            <span class="voucher-label">عن شهر</span>
            <span class="voucher-value">${getMonthLabel(sal.month)}</span>
          </div>
          <div class="voucher-field">
            <span class="voucher-label">طريقة الصرف</span>
            <span class="voucher-value">تسليم يدوي — نقداً (كاش)</span>
          </div>
          <div class="voucher-field">
            <span class="voucher-label">تاريخ الصرف</span>
            <span class="voucher-value">${escHtml(dateStr)}${timeStr ? ' — ' + escHtml(timeStr) : ''}</span>
          </div>
          <div class="voucher-field">
            <span class="voucher-label">المسؤول عن الصرف</span>
            <span class="voucher-value">${escHtml(sal.paid_by || '—')}</span>
          </div>
        </div>

        <table class="voucher-table">
          <thead>
            <tr>
              <th>البند</th>
              <th style="text-align: left;">المبلغ (د.ع)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>الراتب الأساسي الشهري</td>
              <td style="text-align: left;">${formatCurrency(baseVal)}</td>
            </tr>
            ${bonusVal > 0 ? `<tr>
              <td>المكافآت والحوافز</td>
              <td style="text-align: left; color: #059669; font-weight:600;">+${formatCurrency(bonusVal)}</td>
            </tr>` : ''}
            ${deductVal > 0 ? `<tr>
              <td>الاستقطاعات والخصومات</td>
              <td style="text-align: left; color: #dc2626; font-weight:600;">−${formatCurrency(deductVal)}</td>
            </tr>` : ''}
            ${sal.deduction_note ? `<tr>
              <td colspan="2" style="font-size: 11px; color: #64748b; padding: 4px 8px; background: #f8fafc; border-radius: 4px;">
                <strong>سبب الخصم:</strong> ${escHtml(sal.deduction_note)}
              </td>
            </tr>` : ''}
            <tr class="total-row">
              <td>صافي المبلغ المستحق والمُستلَم</td>
              <td style="text-align: left;">${formatCurrency(finalVal)}</td>
            </tr>
          </tbody>
        </table>

        <div class="voucher-footer">
          <div>
            <div class="voucher-signer-title">توقيع المستلم (الموظف)</div>
            <div class="voucher-sign-line"></div>
            <div class="voucher-signer-name">${escHtml(sal.employee_name)}</div>
          </div>
          <div>
            <div class="voucher-signer-title">توقيع المحاسب / الإدارة</div>
            <div class="voucher-sign-line"></div>
            <div class="voucher-signer-name">${escHtml(sal.paid_by || '—')}</div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('voucher-preview-content').innerHTML = voucherHtml;
    document.getElementById('salary-slip-print-area').innerHTML = voucherHtml;
    document.getElementById('receipt-modal').classList.add('show');
}

function closeReceiptModal() {
    document.getElementById('receipt-modal').classList.remove('show');
}

function triggerSlipPrint() {
    window.print();
}

async function loadSalSupervisorLogs(empId, month) {
    const box = document.getElementById('sal-supervisor-history-box');
    const list = document.getElementById('sal-supervisor-history-list');
    if (!box || !list) return;

    box.style.display = 'none';
    list.innerHTML = '';

    try {
        const { data: logs, error } = await supabase
            .from('deduction_logs')
            .select('*')
            .eq('employee_id', empId)
            .eq('month', month);

        if (error) throw error;

        if (logs && logs.length > 0) {
            box.style.display = 'block';
            list.innerHTML = logs.map(log => {
                const dt = new Date(log.added_at);
                const dStr = dt.toLocaleDateString('ar-SA', { day: 'numeric', month: 'short' });
                const amt = log.amount || 0;
                
                return `
                <div style="background:#fff; border:1px solid #fed7d7; border-radius:8px; padding:8px 10px; font-size:12.5px; display:flex; justify-content:space-between; align-items:center; gap:8px;">
                  <div>
                    <div style="font-weight:700; color:var(--c-text);">${escHtml(dStr)} - بواسطة <span style="color:var(--c-accent); font-weight:700;">${escHtml(log.added_by)}</span></div>
                    ${log.note ? `<div style="color:var(--c-text-2); margin-top:2px;">${escHtml(log.note)}</div>` : ''}
                  </div>
                  <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
                    ${amt > 0 ? `<span style="color:#c53030; font-weight:700;">−${formatCurrency(amt)}</span>` : '<span style="color:#718096; font-size:10px;">ملاحظة</span>'}
                    ${log.image_data ? `<img src="${log.image_data}" class="dash-deduction-img-thumb" style="width:24px; height:24px; border-radius:4px;" onclick="viewGlobalImage(this.src)" title="اضغط لتكبير الصورة">` : ''}
                    <button type="button" class="btn btn-danger btn-sm" style="padding:2px 6px; font-size:11px; height:22px; line-height:1;" onclick="deleteSupervisorDeductionLog('${log.id}', '${empId}', '${month}')" title="حذف هذا السجل">حذف</button>
                  </div>
                </div>`;
            }).join('');
        }
    } catch (err) {
        console.error('[salaries] failed to load supervisor logs in modal:', err);
    }
}

async function deleteSupervisorDeductionLog(logId, empId, month) {
    const ok = await showConfirm('هل أنت متأكد من حذف هذا الخصم/الملاحظة المسجلة من قبل المراقب؟', 'حذف خصم المراقب');
    if (!ok) return;

    try {
        const { error } = await supabase.from('deduction_logs').delete().eq('id', logId);
        if (error) throw error;

        showToast('تم حذف الخصم بنجاح.', 'success');
        
        // Fetch remaining logs to recalculate
        const { data: logs, error: logsErr } = await supabase
            .from('deduction_logs').select('*').eq('employee_id', empId).eq('month', month);
        if (logsErr) throw logsErr;

        const totalDeduction = (logs || []).reduce((sum, l) => sum + (l.amount || 0), 0);
        const combinedNote = (logs || [])
            .filter(l => l.note)
            .map(l => {
                const dt = new Date(l.added_at);
                const d = dt.toLocaleDateString('ar-SA', { day: 'numeric', month: 'short' });
                return '[' + d + ' - ' + l.added_by + '] ' + l.note;
            }).join(' | ');

        // Update modal values immediately
        const deductEl = document.getElementById('sal-deduction');
        if (deductEl) {
            deductEl.value = totalDeduction.toLocaleString('en-US');
        }
        const noteEl = document.getElementById('sal-deduction-note');
        if (noteEl) {
            noteEl.value = combinedNote;
        }

        updateSalaryPreview();

        // Refresh logs list in modal
        await loadSalSupervisorLogs(empId, month);

    } catch (err) {
        console.error('[salaries] failed to delete supervisor log:', err);
        showToast('فشل حذف سجل الخصم.', 'error');
    }
}
