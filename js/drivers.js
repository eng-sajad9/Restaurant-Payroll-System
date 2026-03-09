/**
 * drivers.js
 * Delivery driver registry (stored in the `drivers` collection, separate from `employees`).
 * Payment records stay in the `salaries` collection, referencing driver IDs via `employee_id`.
 * Supports bi-weekly pay periods: 'first' (1-15), 'second' (16-end), 'full' (monthly).
 * Formula: Final = Base Salary + (Orders × Price per Order) + Bonus − Deduction
 */

let _driverRecords = [];
let _filteredDriverEmps = []; // Track currently filtered drivers for export
let _driverEmps = [];
let _editDrvId = null;
let _drvMonth = getCurrentMonth();
let _drvPeriod = 'first'; // 'first' | 'second' | 'full'

const PERIOD_LABELS = {
    full: 'الشهر كامل',
    first: 'النصف الأول  (1 - 15)',
    second: 'النصف الثاني  (16 - نهاية الشهر)',
};

async function initDrivers() {
    setBreadcrumb('الدليفري', 'إدارة مدفوعات سائقي التوصيل');

    // Month selector
    const mSel = document.getElementById('drv-month');
    if (mSel) {
        mSel.innerHTML = buildMonthOptions(_drvMonth);
        mSel.addEventListener('change', () => {
            _drvMonth = mSel.value;
            loadDriverPage(_drvMonth, _drvPeriod);
        });
    }

    // Period selector
    const pSel = document.getElementById('drv-period');
    if (pSel) {
        pSel.value = _drvPeriod;
        pSel.addEventListener('change', () => {
            _drvPeriod = pSel.value;
            _updatePeriodColors();
            loadDriverPage(_drvMonth, _drvPeriod);
        });
    }

    // Load from the dedicated `drivers` collection
    await _reloadDriverList();
    await loadDriverPage(_drvMonth, _drvPeriod);
    _updatePeriodColors();
}

/** Updates the background and text color of the period dropdown based on its current value */
function _updatePeriodColors() {
    const wrapper = document.getElementById('drv-period-wrapper');
    const pSel = document.getElementById('drv-period');
    if (!wrapper || !pSel) return;

    if (_drvPeriod === 'first') {
        // Light Green for First Half
        wrapper.style.background = '#dcfce7'; // green-100
        wrapper.style.border = '1px solid #4ade80'; // green-400
        wrapper.querySelector('label').style.color = '#166534'; // green-800
        pSel.style.background = '#dcfce7';
        pSel.style.borderColor = '#dcfce7';
        pSel.style.color = '#166534';
    } else if (_drvPeriod === 'second') {
        // Original Golden Yellow for Second Half
        wrapper.style.background = '#fffbeb';
        wrapper.style.border = '1px solid #fcd34d';
        wrapper.querySelector('label').style.color = '#92400e';
        pSel.style.background = '#fef3c7';
        pSel.style.borderColor = '#fef3c7';
        pSel.style.color = '#92400e';
    } else {
        // Standard styling for Full Month
        wrapper.style.background = 'var(--c-bg)';
        wrapper.style.border = '1px solid var(--c-border)';
        wrapper.querySelector('label').style.color = 'var(--c-text-2)';
        pSel.style.background = 'var(--c-bg)';
        pSel.style.borderColor = 'var(--c-border)';
        pSel.style.color = 'var(--c-text)';
    }
}

let _drvListUnsub = null;

/** Reload the list of registered drivers from Firestore `drivers` collection using real-time listener */
async function _reloadDriverList() {
    if (_drvListUnsub) _drvListUnsub();
    _drvListUnsub = db.collection('drivers')
        .orderBy('created_at', 'desc')
        .onSnapshot(snap => {
            _driverEmps = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            populateDrvDropdown();
            // Trigger a page reload if we are on the drivers page to refresh data links
            if (document.getElementById('page-drivers').classList.contains('active')) {
                loadDriverPage(_drvMonth, _drvPeriod);
            }
        }, err => console.error('[drivers] list listener error:', err));
}

function populateDrvDropdown() {
    const sel = document.getElementById('drv-emp-select');
    if (!sel) return;
    if (!_driverEmps.length) {
        sel.innerHTML = `<option value="">لا يوجد سائقون — أضف سائقاً أولاً</option>`;
        return;
    }
    sel.innerHTML = `<option value="">اختر سائقاً...</option>` +
        _driverEmps.map(e =>
            `<option value="${e.id}">${escHtml(e.name)} — راتب أساسي: ${formatCurrency(e.base_salary)}</option>`
        ).join('');
}

let _drvPageUnsub = null;

async function loadDriverPage(month, period) {
    if (_drvPageUnsub) _drvPageUnsub();
    showTableLoading('drv-tbody', 8);

    const labelEl = document.getElementById('drv-month-label');
    if (labelEl) labelEl.textContent = `${getMonthLabel(month)} — ${PERIOD_LABELS[period] || ''}`;

    const empIds = _driverEmps.map(e => e.id);

    if (!empIds.length) {
        const tbody = document.getElementById('drv-tbody');
        tbody.innerHTML = `<tr><td colspan="8">
          <div class="empty-state">
            <svg viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 3v4h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
            <strong>لا يوجد سائقو توصيل بعد</strong>
            <span>استخدم زر "إضافة سائق" لإضافة أول سائق.</span>
          </div>
        </td></tr>`;
        return;
    }

    // Since 'in' queries have limits and snap listeners are better broad, 
    // we listen to all salary records for the month and filter locally for speed and reactivity.
    _drvPageUnsub = db.collection('salaries')
        .where('month', '==', month)
        .onSnapshot(snap => {
            const allRecords = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            // Filter to include ALL records with a pay_period (indicating they are driver records)
            // even if the driver has been deleted from the active list.
            const driverRelated = allRecords.filter(r => !!r.pay_period);

            _driverRecords = driverRelated.filter(r => {
                if (period === 'full') return !r.pay_period || r.pay_period === 'full';
                return r.pay_period === period;
            });

            // Re-apply filters whenever data changes to keep _filteredDriverEmps in sync
            filterDrivers();
            renderDriverTable(_driverEmps, _driverRecords);
        }, err => {
            console.error('[drivers] page listener error:', err);
            showToast('فشل المزامنة اللحظية لسجلات السائقين.', 'error');
        });
}

function chunkArray(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
    return chunks;
}

function renderDriverTable(drivers, records) {
    const tbody = document.getElementById('drv-tbody');
    if (!tbody) return;

    const recMap = Object.fromEntries(records.map(r => [r.employee_id, r]));
    let totalPay = 0;

    // To handle deleted drivers, we collect all unique IDs from both active drivers and current records
    const activeIds = drivers.map(d => d.id);
    const recordIds = records.map(r => r.employee_id);
    const allIds = [...new Set([...activeIds, ...recordIds])];

    const rows = [];
    allIds.forEach((id, idx) => {
        const drv = drivers.find(d => d.id === id) || { id: id, isDeleted: true };
        const rec = recMap[id];

        // If it's a deleted driver with no record for THIS month/period, we skip them to avoid clutter
        if (drv.isDeleted && !rec) return;

        const drvName = drv.name || (rec?.employee_name || drv.id || '—');

        const orders = rec ? (rec.delivery_orders || 0) : 0;
        const price = rec ? (rec.order_price || 0) : 0;
        const orderPay = orders * price;
        const final = rec ? (rec.final_salary || 0) : 0;
        const savedBase = rec?.base_salary_paid !== undefined ? rec.base_salary_paid : (drv.base_salary || 0);
        if (rec) totalPay += final;

        const shift = rec?.shift_type || drv.default_shift || '—';

        rows.push(`<tr data-drv-id="${drv.id}" data-drv-name="${escHtml(drvName)}" data-drv-shift="${escHtml(shift)}" class="${rec ? 'paid-row' : ''}">
          <td data-label="ت" class="serial-cell fw-600" style="color:var(--c-text-3);"></td>
          <td data-label="اسم السائق" class="fw-600">
            ${escHtml(drvName)}
            ${drv.isDeleted ? ' <span class="text-danger" style="font-size:11px; margin-right:4px;">(محذوف)</span>' : ''}
          </td>
          <td data-label="الراتب الأساسي">${formatCurrency(savedBase)}</td>
          <td data-label="عدد الطلبات">${orders.toLocaleString('en-US')}</td>
          <td data-label="سعر الطلب">${formatCurrency(price)}</td>
          <td data-label="مستحقات الطلبات" class="highlight-cell">${formatCurrency(orderPay)}</td>
          <td data-label="صافي المستحقات" class="highlight-cell fw-600">${rec ? formatCurrency(final) : '<span class="text-muted">—</span>'}</td>
          <td data-label="نوع الشفت">
            ${(shift !== '—')
                ? `<span class="badge ${shift === 'مسائي' ? 'badge-purple' : (shift === 'شفت كامل' ? 'badge-orange' : 'badge-blue')}" style="font-size:11px;">${shift}</span>`
                : '<span style="color:var(--c-text-2);font-size:12px;">—</span>'}
          </td>
          <td style="max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escHtml(rec?.note || '')}">
            <span style="color:var(--c-text-2);font-size:12px;">${escHtml(rec?.note || '—')}</span>
          </td>
          <td>
            <div class="tbl-actions">
              ${canWrite() ? `
              <button class="act-btn edit" title="${rec ? 'تعديل' : 'إضافة'} سجل"
                onclick="openDrvModal('${drv.id}', '${rec ? rec.id : ''}')">
                <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              ${(rec && canDelete()) ? `<button class="act-btn delete" title="حذف" onclick="deleteDrvRecord('${rec.id}')">
                <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              </button>` : ''}
              ${(!drv.isDeleted && canDelete()) ? `<button class="act-btn delete" title="حذف السائق نهائياً" style="opacity:0.6;" onclick="deleteDriverProfile('${drv.id}', '${escHtml(drvName)}')">
                <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
              </button>` : ''}
` : ''}
            </div>
          </td>
        </tr>`);
    });

    rows.push(`<tr class="summary-row">
      <td colspan="6" class="text-right fw-600">إجمالي المدفوعات — ${PERIOD_LABELS[_drvPeriod] || ''}</td>
      <td class="highlight-cell fw-600">${formatCurrency(totalPay)}</td>
      <td colspan="3"></td>
    </tr>`);

    tbody.innerHTML = rows.join('');
}

// ─── Search / Filter ──────────────────────────────────────────────────────────

function filterDrivers() {
    const q = (document.getElementById('drv-search')?.value || '').toLowerCase().trim();
    const shiftFilt = document.getElementById('drv-shift-filter')?.value || '';
    const tbody = document.getElementById('drv-tbody');

    _filteredDriverEmps = _driverEmps.filter(drv => {
        const name = (drv.name || '').toLowerCase();
        // Since we filter by shift in the UI, we should extract the shift for this driver/period
        // matching the logic in renderDriverTable:
        const rec = _driverRecords.find(r => r.employee_id === drv.id);
        const shift = rec?.shift_type || drv.default_shift || '—';

        const nameMatch = !q || name.includes(q);
        const shiftMatch = !shiftFilt || shift === shiftFilt;
        return nameMatch && shiftMatch;
    });

    if (!tbody) return;
    tbody.querySelectorAll('tr[data-drv-id]').forEach(row => {
        const name = (row.dataset.drvName || '').toLowerCase();
        const shift = row.dataset.drvShift || '';

        const nameMatch = !q || name.includes(q);
        const shiftMatch = !shiftFilt || shift === shiftFilt;

        row.style.display = (nameMatch && shiftMatch) ? '' : 'none';
    });
}

// ─── Record Modal (add/edit payment record) ───────────────────────────────────

function openDrvModal(driverId, recordId = '') {
    _editDrvId = recordId || null;
    const titleEl = document.getElementById('drv-modal-title');
    document.getElementById('drv-form').reset();

    const sel = document.getElementById('drv-emp-select');
    sel.value = driverId;
    sel.disabled = true;

    // Pre-fill salary and shift from driver profile
    loadDriverBaseSalary();

    // Set period label in modal
    const periodLabelEl = document.getElementById('drv-modal-period-label');
    if (periodLabelEl) periodLabelEl.textContent = PERIOD_LABELS[_drvPeriod] || 'الشهر كامل';

    ['drv-price', 'drv-bonus', 'drv-deduct', 'drv-base-salary'].forEach(i => attachCurrencyInput(document.getElementById(i)));

    // Enforce English digits for orders
    const ordersInp = document.getElementById('drv-orders');
    if (ordersInp) {
        ordersInp.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^\d]/g, ''); // Numeric only
            updateDrvPreview();
        });
    }

    if (recordId) {
        const rec = _driverRecords.find(r => r.id === recordId);
        if (rec) {
            titleEl.textContent = 'تعديل سجل الدليفري';
            document.getElementById('drv-orders').value = rec.delivery_orders || 0;
            document.getElementById('drv-price').value = (rec.order_price || 0).toLocaleString('en-US');
            document.getElementById('drv-bonus').value = (rec.bonus || 0).toLocaleString('en-US');
            document.getElementById('drv-deduct').value = (rec.deduction || 0).toLocaleString('en-US');
            const shiftSel = document.getElementById('drv-shift');
            if (shiftSel) shiftSel.value = rec.shift_type || '';
            const noteInp = document.getElementById('drv-note');
            if (noteInp) noteInp.value = rec.note || '';

            const emp = _driverEmps.find(e => e.id === rec.employee_id);
            const savedBase = rec.base_salary_paid !== undefined ? rec.base_salary_paid : (emp ? emp.base_salary : 0);
            document.getElementById('drv-base-salary').value = Number(savedBase).toLocaleString('en-US');

            updateDrvPreview();
        }
    } else {
        titleEl.textContent = 'إضافة سجل دليفري';
        document.getElementById('drv-orders').value = '';
        document.getElementById('drv-price').value = '0';
        document.getElementById('drv-bonus').value = '0';
        document.getElementById('drv-deduct').value = '0';
        const noteInp = document.getElementById('drv-note');
        if (noteInp) noteInp.value = '';

        // Auto-load base salary if an employee is pre-selected (though usually it's empty initially)
        document.getElementById('drv-base-salary').value = '0';
    }

    document.getElementById('drv-modal').classList.add('show');
}

function closeDrvModal() {
    const sel = document.getElementById('drv-emp-select');
    if (sel) sel.disabled = false;
    document.getElementById('drv-modal').classList.remove('show');
}

function loadDriverBaseSalary() {
    const empId = document.getElementById('drv-emp-select').value;
    const emp = _driverEmps.find(e => e.id === empId);
    if (emp) {
        if (document.getElementById('drv-base-salary')) {
            document.getElementById('drv-base-salary').value = Number(emp.base_salary || 0).toLocaleString('en-US');
        }
        if (document.getElementById('drv-shift') && emp.default_shift) {
            document.getElementById('drv-shift').value = emp.default_shift;
        }
    } else {
        if (document.getElementById('drv-base-salary')) {
            document.getElementById('drv-base-salary').value = '0';
        }
        if (document.getElementById('drv-shift')) {
            document.getElementById('drv-shift').value = '';
        }
    }
}

function updateDrvPreview() {
    const ordersStr = document.getElementById('drv-orders').value;
    const orders = parseFloat(ordersStr) || 0;
    const price = getNumVal('drv-price');
    const bonus = getNumVal('drv-bonus');
    const deduct = getNumVal('drv-deduct');
    const base = getNumVal('drv-base-salary');

    const final = Math.max(0, base + (orders * price) + bonus - deduct);
    const el = document.getElementById('drv-preview');
    if (el) el.textContent = `الراتب النهائي: ${formatCurrency(final)}  (أساسي: ${formatCurrency(base)} + طلبات: ${formatCurrency(orders * price)})`;
}

// ─── Save Payment Record ───────────────────────────────────────────────────────

async function saveDrvRecord() {
    const empId = document.getElementById('drv-emp-select').value;
    const ordersStr = document.getElementById('drv-orders').value;
    const orders = parseFloat(ordersStr) || 0;
    const price = getNumVal('drv-price');
    const bonus = getNumVal('drv-bonus');
    const deduct = getNumVal('drv-deduct');

    if (!empId) { showToast('لم يتم اختيار سائق.', 'error'); return; }
    if (orders < 0 || price < 0) { showToast('يجب أن تكون الطلبات والسعر أرقاماً موجبة.', 'error'); return; }

    const base = getNumVal('drv-base-salary');
    const emp = _driverEmps.find(e => e.id === empId);
    const final = Math.max(0, base + (orders * price) + bonus - deduct);

    const saveBtn = document.getElementById('drv-save-btn');
    saveBtn.disabled = true;

    const data = {
        employee_id: empId,
        employee_name: emp?.name || '',
        month: _drvMonth,
        pay_period: _drvPeriod,
        shift_type: document.getElementById('drv-shift')?.value || '',
        note: document.getElementById('drv-note')?.value.trim() || '',
        base_salary_paid: base,
        delivery_orders: orders,
        order_price: price,
        bonus,
        deduction: deduct,
        final_salary: final
    };

    try {
        if (_editDrvId) {
            await db.collection('salaries').doc(_editDrvId).update(data);
            invalidateCache('salaries');
            showToast('تم تحديث سجل الدليفري بنجاح.');
            logAudit('تعديل', 'دليفري', emp?.name || empId, `الشهر: ${getMonthLabel(_drvMonth)} | طلبات: ${orders} | السعر: ${price} | وردية: ${data.shift_type}`);
        } else {
            // Duplicate check: same driver + month + period
            const dup = await db.collection('salaries')
                .where('employee_id', '==', empId)
                .where('month', '==', _drvMonth)
                .where('pay_period', '==', _drvPeriod)
                .limit(1).get();

            if (!dup.empty) {
                showToast(`يوجد سجل لهذا السائق في ${PERIOD_LABELS[_drvPeriod]} لهذا الشهر مسبقاً.`, 'warning');
                saveBtn.disabled = false;
                return;
            }
            data.created_at = firebase.firestore.FieldValue.serverTimestamp();
            await db.collection('salaries').add(data);
            invalidateCache('salaries');
            showToast('تم إضافة سجل الدليفري بنجاح.');
            logAudit('إضافة', 'دليفري', emp?.name || empId, `الشهر: ${getMonthLabel(_drvMonth)} | طلبات: ${orders} | السعر: ${price} | وردية: ${data.shift_type}`);
        }
        closeDrvModal();
    } catch (err) {
        console.error('[drivers] save error:', err);
        showToast('فشل حفظ السجل.', 'error');
    } finally {
        saveBtn.disabled = false;
    }
}

// ─── Delete Payment Record ────────────────────────────────────────────────────

async function deleteDrvRecord(id) {
    if (!canDelete()) {
        showToast('ليس لديك صلاحية الحذف.', 'error');
        return;
    }
    const ok = await showConfirm('هل تريد حذف سجل الدفع هذا نهائياً؟', 'حذف السجل');
    if (!ok) return;
    try {
        await db.collection('salaries').doc(id).delete();
        invalidateCache('salaries');
        const rec = _driverRecords.find(r => r.id === id);
        const drv = _driverEmps.find(e => e.id === rec?.employee_id);
        logAudit('حذف', 'دليفري', drv?.name || id, `الشهر: ${getMonthLabel(rec?.month || '')}`);
        showToast('تم حذف السجل بنجاح.');
    } catch (err) {
        showToast('فشل حذف السجل.', 'error');
    }
}

// ─── Delete Driver Profile ────────────────────────────────────────────────────

async function deleteDriverProfile(driverId, driverName) {
    const ok = await showConfirm(
        `سيتم حذف السائق "${driverName}" من قاعدة البيانات نهائياً. سجلات الدفع السابقة لن تُحذف.\nهل تريد المتابعة؟`,
        'حذف السائق'
    );
    if (!ok) return;
    try {
        await db.collection('drivers').doc(driverId).delete();
        invalidateCache('drivers');
        logAudit('حذف', 'سائق دليفري', driverName, `تم حذف الملف الشخصي للسائق`);
        showToast(`تم حذف السائق "${driverName}" بنجاح.`);
    } catch (err) {
        showToast('فشل حذف السائق.', 'error');
    }
}

// ─── Add Driver Modal ─────────────────────────────────────────────────────────

function openAddDriverModal() {
    document.getElementById('add-driver-form').reset();
    document.getElementById('add-driver-modal').classList.add('show');
    document.getElementById('add-drv-name').focus();
}

function closeAddDriverModal() {
    document.getElementById('add-driver-modal').classList.remove('show');
}

async function saveNewDriver() {
    const name = document.getElementById('add-drv-name').value.trim();
    const salaryRaw = document.getElementById('add-drv-salary').value.replace(/,/g, '').trim();
    const defaultShift = document.getElementById('add-drv-shift')?.value || '';
    const salary = parseFloat(salaryRaw) || 0;

    if (!name) { showToast('يرجى إدخال اسم السائق.', 'error'); return; }

    const duplicate = _driverEmps.find(d => d.name.trim().toLowerCase() === name.toLowerCase());
    if (duplicate) {
        showToast(`السائق "${name}" موجود مسبقاً.`, 'warning');
        return;
    }

    const saveBtn = document.getElementById('add-drv-save-btn');
    saveBtn.disabled = true;

    try {
        db.collection('drivers').add({
            name,
            base_salary: salary,
            default_shift: defaultShift,
            created_at: firebase.firestore.FieldValue.serverTimestamp(),
        });

        invalidateCache('drivers');
        logAudit('إضافة', 'سائق دليفري', name, `الراتب الأساسي: ${salary} | الوردية: ${defaultShift}`);
        showToast(`تم إضافة السائق "${name}" بنجاح.`);
        closeAddDriverModal();
    } catch (err) {
        console.error('[drivers] add driver error:', err);
        showToast('فشل في بدء إضافة السائق.', 'error');
    } finally {
        setTimeout(() => { saveBtn.disabled = false; }, 500);
    }
}

// ─── Edit Driver Profile ──────────────────────────────────────────────────────

function openEditDriverModal(driverId) {
    const drv = _driverEmps.find(e => e.id === driverId);
    if (!drv) return;

    // Reuse the add-driver modal for editing
    document.getElementById('add-driver-form').reset();
    document.getElementById('add-driver-modal-title').textContent = 'تعديل بيانات السائق';
    document.getElementById('add-drv-name').value = drv.name;
    document.getElementById('add-drv-salary').value = drv.base_salary;
    const shiftSel = document.getElementById('add-drv-shift');
    if (shiftSel) shiftSel.value = drv.default_shift || '';

    // Change save button to update
    const saveBtn = document.getElementById('add-drv-save-btn');
    saveBtn.textContent = 'تحديث البيانات';
    saveBtn.onclick = (e) => { e.preventDefault(); updateDriverProfile(driverId); };

    document.getElementById('add-driver-modal').classList.add('show');
}

async function updateDriverProfile(driverId) {
    const name = document.getElementById('add-drv-name').value.trim();
    const salaryRaw = document.getElementById('add-drv-salary').value.replace(/,/g, '').trim();
    const defaultShift = document.getElementById('add-drv-shift')?.value || '';
    const salary = parseFloat(salaryRaw) || 0;

    if (!name) { showToast('يرجى إدخال اسم السائق.', 'error'); return; }

    const duplicate = _driverEmps.find(d => d.name.trim().toLowerCase() === name.toLowerCase() && d.id !== driverId);
    if (duplicate) {
        showToast(`السائق "${name}" موجود مسبقاً.`, 'warning');
        return;
    }

    const saveBtn = document.getElementById('add-drv-save-btn');
    saveBtn.disabled = true;

    try {
        db.collection('drivers').doc(driverId).update({ name, base_salary: salary, default_shift: defaultShift });
        invalidateCache('drivers');
        logAudit('تعديل', 'سائق دليفري', name, `تحديث بيانات: الراتب=${salary}، الوردية=${defaultShift}`);
        showToast(`تم تحديث بيانات السائق "${name}".`);
        closeAddDriverModal();
        // Reset button
        saveBtn.textContent = 'حفظ السائق';
        saveBtn.onclick = null;
    } catch (err) {
        showToast('فشل في بدء تحديث بيانات السائق.', 'error');
    } finally {
        setTimeout(() => { saveBtn.disabled = false; }, 500);
    }
}

function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
