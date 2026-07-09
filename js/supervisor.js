/**
 * supervisor.js
 * مراقب الحضور - واجهة الخصومات والمتابعة اليومية
 */

let _supEmps = [];
let _supEditEmpId = null;
let _supImageBase64 = null;
let _supImageFile = null; // Stores raw File object for Supabase Storage uploads
let _supCurrentMonth = getCurrentMonth();

async function initSupervisor() {
    const monthSel = document.getElementById('sup-month-sel');
    if (monthSel) {
        monthSel.innerHTML = buildMonthOptions(_supCurrentMonth);
        monthSel.onchange = () => { _supCurrentMonth = monthSel.value; };
    }
    await loadSupervisorEmployees();
}

async function loadSupervisorEmployees() {
    const grid = document.getElementById('sup-emp-grid');
    if (!grid) return;
    grid.innerHTML = '<div class="sup-loading"><span class="spinner"></span> جاري التحميل...</div>';
    try {
        const { data, error } = await supabase.from('employees').select('*').order('name', { ascending: true });
        if (error) throw error;
        _supEmps = (data || []).filter(e => !isDriver(e.role));
        populateSupRoleFilter();
        renderSupervisorEmployees(_supEmps);
    } catch (err) {
        console.error('[supervisor] load error:', err);
        grid.innerHTML = '<div class="sup-error">فشل تحميل الموظفين</div>';
    }
}

function populateSupRoleFilter() {
    const filter = document.getElementById('sup-role-filter');
    if (!filter) return;
    const roles = [...new Set(_supEmps.map(e => e.role).filter(Boolean))].sort();
    filter.innerHTML = '<option value="">الكل</option>' + roles.map(r => '<option value="' + escHtml(r) + '">' + escHtml(r) + '</option>').join('');
}

function filterSupEmployees() {
    const q = (document.getElementById('sup-search') ? document.getElementById('sup-search').value : '').toLowerCase().trim();
    const role = document.getElementById('sup-role-filter') ? document.getElementById('sup-role-filter').value : '';
    const filtered = _supEmps.filter(e => {
        const matchQ = !q || e.name.toLowerCase().includes(q) || (e.role || '').toLowerCase().includes(q);
        const matchRole = !role || e.role === role;
        return matchQ && matchRole;
    });
    renderSupervisorEmployees(filtered);
}

function supGetBadgeColor(role) {
    if (!role) return '#64748b';
    if (role.includes('مدير') || role.includes('إدارة')) return '#7c3aed';
    if (role.includes('شيف') || role.includes('طباخ')) return '#ea580c';
    if (role.includes('مقدم') || role.includes('ويتر') || role.includes('كابتن')) return '#2563eb';
    if (role.includes('كاشير') || role.includes('حسابات')) return '#059669';
    return '#475569';
}

function renderSupervisorEmployees(list) {
    const grid = document.getElementById('sup-emp-grid');
    if (!grid) return;
    if (!list.length) { grid.innerHTML = '<div class="sup-empty">لا يوجد موظفون مطابقون.</div>'; return; }
    grid.innerHTML = list.map(emp => {
        const initials = emp.name ? emp.name.trim()[0] : '?';
        const color = supGetBadgeColor(emp.role);
        return '<div class="sup-emp-card" onclick="openSupModal(\'' + emp.id + '\')">' +
            '<div class="sup-emp-avatar" style="background:' + color + ';">' + escHtml(initials) + '</div>' +
            '<div class="sup-emp-info">' +
                '<div class="sup-emp-name">' + escHtml(emp.name) + '</div>' +
                '<span class="sup-emp-role-badge" style="background:' + color + '20;color:' + color + ';border:1px solid ' + color + '30;">' + escHtml(emp.role || '-') + '</span>' +
            '</div>' +
            '<div class="sup-emp-action">' +
                '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>إضافة' +
            '</div>' +
        '</div>';
    }).join('');
}

async function openSupModal(empId) {
    _supEditEmpId = empId;
    _supImageBase64 = null;
    const emp = _supEmps.find(e => e.id === empId);
    if (!emp) return;
    const nameEl = document.getElementById('sup-modal-emp-name');
    const roleEl = document.getElementById('sup-modal-emp-role');
    if (nameEl) nameEl.textContent = emp.name;
    if (roleEl) roleEl.textContent = emp.role || '';
    const form = document.getElementById('sup-deduction-form');
    if (form) form.reset();
    const preview = document.getElementById('sup-img-preview');
    if (preview) { preview.src = ''; preview.style.display = 'none'; }
    const imgLabel = document.getElementById('sup-img-label');
    if (imgLabel) imgLabel.textContent = 'اختر صورة (اختياري)';
    const amountEl = document.getElementById('sup-amount');
    if (amountEl) { amountEl._currencyAttached = false; attachCurrencyInput(amountEl); }
    const histLabel = document.getElementById('sup-hist-month-label');
    if (histLabel) histLabel.textContent = getMonthLabel(_supCurrentMonth);
    await renderDeductionHistory(empId, _supCurrentMonth);
    document.getElementById('sup-modal').classList.add('show');
}

function closeSupModal() {
    document.getElementById('sup-modal').classList.remove('show');
    _supEditEmpId = null;
    _supImageBase64 = null;
    _supImageFile = null;
}

function handleSupImageUpload(input) {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { showToast('حجم الصورة يجب ان لا يتجاوز 3 ميغابايت.', 'error'); input.value = ''; return; }
    _supImageFile = file; // Cache the raw File object
    const reader = new FileReader();
    reader.onload = (e) => {
        _supImageBase64 = e.target.result;
        const preview = document.getElementById('sup-img-preview');
        if (preview) { preview.src = _supImageBase64; preview.style.display = 'block'; }
        const imgLabel = document.getElementById('sup-img-label');
        if (imgLabel) imgLabel.textContent = file.name;
    };
    reader.readAsDataURL(file);
}

async function saveSupDeduction() {
    if (!_supEditEmpId) return;
    const amount = getNumVal('sup-amount');
    const note = (document.getElementById('sup-note') ? document.getElementById('sup-note').value : '').trim();
    if (amount === 0 && !note && !_supImageFile) { showToast('يرجى ادخال مبلغ الخصم او ملاحظة على الاقل.', 'warning'); return; }
    
    const user = getCurrentUser();
    const supervisorName = user ? user.username : 'Supervisor';
    const saveBtn = document.getElementById('sup-save-btn');
    if (saveBtn) saveBtn.disabled = true;
    const emp = _supEmps.find(e => e.id === _supEditEmpId);
    const now = new Date().toISOString();

    try {
        if (window.realSupabase) {
            // Online Cloud Bridge path: Push to remote queue
            await submitDeduction(_supEditEmpId, amount, note, _supImageFile, supervisorName);
            showToast('تم إرسال الخصم إلى السحابة بنجاح', 'success');
        } else {
            // Offline fallback / Mock adapter path
            const logEntry = {
                employee_id: _supEditEmpId,
                employee_name: emp ? emp.name : '',
                month: _supCurrentMonth,
                amount: amount,
                note: note,
                image_data: _supImageBase64 || null,
                added_by: supervisorName,
                added_at: now
            };
            const { error: logErr } = await supabase.from('deduction_logs').insert([logEntry]);
            if (logErr) throw logErr;

            if (amount > 0) {
                await syncDeductionToSalary(_supEditEmpId, _supCurrentMonth, note, supervisorName, now);
            }
            showToast('تم تسجيل السجل محلياً بنجاح', 'success');
        }

        // Local Audit Logging
        logAudit('اضافة', 'خصم/ملاحظة', emp ? emp.name : _supEditEmpId,
            'المبلغ: ' + amount + ' | الملاحظة: ' + (note || '-') + ' | بواسطة: ' + supervisorName);

        _supImageBase64 = null;
        _supImageFile = null;
        document.getElementById('sup-deduction-form').reset();
        const preview = document.getElementById('sup-img-preview');
        if (preview) { preview.src = ''; preview.style.display = 'none'; }
        const imgLabel = document.getElementById('sup-img-label');
        if (imgLabel) imgLabel.textContent = 'اختر صورة (اختياري)';
        await renderDeductionHistory(_supEditEmpId, _supCurrentMonth);
    } catch (err) {
        console.error('[supervisor] save error:', err);
        showToast('فشل حفظ السجل.', 'error');
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

async function syncDeductionToSalary(empId, month, latestNote, addedBy, addedAt) {
    try {
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

        const { data: sals, error: salErr } = await supabase
            .from('salaries').select('*').eq('employee_id', empId).eq('month', month).limit(1);
        if (salErr) throw salErr;

        if (sals && sals.length > 0) {
            const sal = sals[0];
            const base = sal.base_salary || 0;
            const bonus = sal.bonus || 0;
            const newFinal = Math.max(0, base + bonus - totalDeduction);
            const { error: updErr } = await supabase.from('salaries').update({
                deduction: totalDeduction,
                deduction_note: combinedNote || latestNote,
                final_salary: newFinal,
                deduction_by: addedBy,
                deduction_at: addedAt
            }).eq('id', sal.id);
            if (updErr) throw updErr;
        } else {
            // Automatically generate a draft salary sheet for this employee
            const { data: emps, error: empErr } = await supabase
                .from('employees').select('*').eq('id', empId).limit(1);
            if (empErr) throw empErr;

            if (emps && emps.length > 0) {
                const emp = emps[0];
                const base = emp.base_salary || 0;
                const newFinal = Math.max(0, base - totalDeduction);
                const { error: insertErr } = await supabase.from('salaries').insert([{
                    employee_id: empId,
                    employee_name: emp.name,
                    month: month,
                    bonus: 0,
                    deduction: totalDeduction,
                    final_salary: newFinal,
                    deduction_note: combinedNote || latestNote,
                    deduction_by: addedBy,
                    deduction_at: addedAt,
                    status: 'draft',
                    payment_method: '',
                    paid_at: null,
                    paid_by: null
                }]);
                if (insertErr) throw insertErr;
            }
        }
    } catch (err) {
        console.warn('[supervisor] sync to salary failed:', err);
    }
}

async function renderDeductionHistory(empId, month) {
    const container = document.getElementById('sup-history-list');
    if (!container) return;
    container.innerHTML = '<div class="sup-hist-loading"><span class="spinner"></span></div>';
    try {
        const { data, error } = await supabase
            .from('deduction_logs').select('*').eq('employee_id', empId).eq('month', month);
        if (error) throw error;
        const logs = (data || []).sort((a, b) => new Date(b.added_at) - new Date(a.added_at));
        if (!logs.length) { container.innerHTML = '<div class="sup-hist-empty">لا توجد سجلات لهذا الشهر.</div>'; return; }

        const total = logs.reduce((s, l) => s + (l.amount || 0), 0);
        const totalHtml = total > 0 ? '<div class="sup-hist-total">اجمالي الخصومات: <strong>' + formatCurrency(total) + '</strong></div>' : '';

        container.innerHTML = totalHtml + logs.map(log => {
            const dt = new Date(log.added_at);
            const dateStr = dt.toLocaleDateString('ar-SA', { day: 'numeric', month: 'long', year: 'numeric' });
            const timeStr = dt.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', hour12: true });
            return '<div class="sup-hist-entry">' +
                '<div class="sup-hist-header">' +
                    '<span class="sup-hist-by"><svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' + escHtml(log.added_by) + '</span>' +
                    '<span class="sup-hist-time">' + escHtml(dateStr) + ' - ' + escHtml(timeStr) + '</span>' +
                '</div>' +
                (log.amount > 0 ? '<div class="sup-hist-amount">خصم: <strong>-' + formatCurrency(log.amount) + '</strong></div>' : '') +
                (log.note ? '<div class="sup-hist-note">' + escHtml(log.note) + '</div>' : '') +
                (log.image_data ? '<div class="sup-hist-img-wrap"><img src="' + log.image_data + '" class="sup-hist-img" onclick="viewGlobalImage(this.src)" title="اضغط للتكبير"></div>' : '') +
            '</div>';
        }).join('');
    } catch (err) {
        console.error('[supervisor] history error:', err);
        container.innerHTML = '<div class="sup-hist-empty">فشل تحميل السجل.</div>';
    }
}

/**
 * Uploads deduction receipt to Supabase Storage and inserts the row into pending_deductions queue.
 * Utilizes the real Supabase client for online connections.
 */
async function submitDeduction(employeeId, amount, reason, imageFile, supervisorName) {
    let uploadedPath = null;
    let imageUrl = null;

    try {
        // 1. Upload proof image (if selected)
        if (imageFile) {
            const fileExt = imageFile.name.split('.').pop();
            const uniqueId = typeof crypto.randomUUID === 'function' 
                ? crypto.randomUUID() 
                : Math.random().toString(36).substring(2, 15) + Date.now();
            uploadedPath = `${employeeId}/${uniqueId}.${fileExt}`;

            const { data: uploadData, error: uploadError } = await window.realSupabase.storage
                .from('deductions_images')
                .upload(uploadedPath, imageFile, {
                    cacheControl: '3600',
                    upsert: false
                });

            if (uploadError) {
                throw new Error(`Storage upload error: ${uploadError.message}`);
            }

            const { data: urlData } = window.realSupabase.storage
                .from('deductions_images')
                .getPublicUrl(uploadedPath);

            imageUrl = urlData.publicUrl;
        }

        // 2. Insert deduction record in Supabase with Audit Trail supervisor_name
        const { data: insertData, error: insertError } = await window.realSupabase
            .from('pending_deductions')
            .insert([
                {
                    employee_id: employeeId,
                    amount: parseFloat(amount) || 0,
                    reason: reason || '',
                    image_url: imageUrl,
                    supervisor_name: supervisorName || 'Supervisor'
                }
            ])
            .select();

        if (insertError) {
            throw insertError;
        }

        return insertData ? insertData[0] : null;

    } catch (error) {
        console.error('[Cloud Bridge submitDeduction] Push failed:', error);
        // Rollback uploaded file if DB insertion failed
        if (uploadedPath) {
            await window.realSupabase.storage.from('deductions_images').remove([uploadedPath]);
        }
        throw error;
    }
}
