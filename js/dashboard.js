/**
 * dashboard.js
 * Dashboard stats + role breakdown chart.
 */

async function initDashboard() {
  setBreadcrumb('لوحة التحكم', 'نظرة عامة على إحصائيات الرواتب');

  const monthEl = document.getElementById('dash-month');
  if (monthEl) {
    monthEl.innerHTML = buildMonthOptions(getCurrentMonth());
    monthEl.onchange = () => loadDashboardStats(monthEl.value);
  }

  await loadDashboardStats(getCurrentMonth());
}

async function loadDashboardStats(month) {
  if (window._dashUnsubStat) { supabase.removeChannel(window._dashUnsubStat); window._dashUnsubStat = null; }
  if (window._dashUnsubDeduct) { supabase.removeChannel(window._dashUnsubDeduct); window._dashUnsubDeduct = null; }

  try {
      const { data: salaries, error } = await supabase.from('salaries').select('*').eq('month', month);
      if (error) throw error;
      
      const processSalaries = async (salariesData) => {
          const totalSal = salariesData.reduce((s, r) => s + (r.final_salary || 0), 0);
          setText('stat-salary', formatCurrency(totalSal));
          
          // Calculate new metrics
          const totalBonus = salariesData.reduce((s, r) => s + (r.bonus || 0), 0);
          const totalDeduct = salariesData.reduce((s, r) => s + (r.deduction || 0), 0);
          const totalOrders = salariesData.reduce((s, r) => s + (r.delivery_orders || 0), 0);
          
          setText('stat-bonuses', formatCurrency(totalBonus));
          setText('stat-deductions-total', formatCurrency(totalDeduct));
          setText('stat-orders', totalOrders.toLocaleString('en-US'));

          const labelEl = document.getElementById('dash-month-label');
          if (labelEl) labelEl.textContent = getMonthLabel(month);

          try {
            const employees = await cachedGet('employees');
            setText('stat-employees', employees.length);
            renderRecentSalaries(salariesData, employees);
            renderRoleBreakdown(employees);

            // Load supervisor deductions
            await loadDashboardDeductions(month);

            const drivers = await cachedGet('drivers');
            setText('stat-drivers', drivers.length);
          } catch (err) {
            console.error('[dashboard] Data fetch failed:', err);
          }

          if (window.updateUsageStats) {
            window.updateUsageStats(salariesData.length, 0);
          }
      };

      await processSalaries(salaries || []);

      window._dashUnsubStat = supabase
          .channel('public:salaries_dash')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'salaries', filter: `month=eq.${month}` }, async () => {
              const { data } = await supabase.from('salaries').select('*').eq('month', month);
              await processSalaries(data || []);
          })
          .subscribe();

      window._dashUnsubDeduct = supabase
          .channel('public:deduction_logs_dash')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'deduction_logs', filter: `month=eq.${month}` }, async () => {
              await loadDashboardDeductions(month);
          })
          .subscribe();
          
  } catch (err) {
      console.error('[dashboard] load error:', err);
  }
}

async function loadDashboardDeductions(month) {
    const listEl = document.getElementById('dash-deductions-list');
    const countEl = document.getElementById('dash-deductions-count');
    if (!listEl) return;

    try {
        const { data: logs, error } = await supabase
            .from('deduction_logs')
            .select('*')
            .eq('month', month);

        if (error) throw error;

        const sortedLogs = (logs || []).sort((a, b) => new Date(b.added_at) - new Date(a.added_at));

        if (countEl) {
            countEl.textContent = `${sortedLogs.length} سجل`;
        }

        if (sortedLogs.length === 0) {
            listEl.innerHTML = `
              <div class="empty-state" style="padding: 24px; border: 1.5px dashed var(--c-border); border-radius:10px; width: 100%; text-align: center;">
                <strong>لا توجد خصومات أو ملاحظات مسجلة من قبل المراقبين هذا الشهر.</strong>
              </div>`;
            return;
        }

        listEl.innerHTML = sortedLogs.map(log => {
            const dt = new Date(log.added_at);
            const dateStr = dt.toLocaleDateString('ar-SA', { day: 'numeric', month: 'short' });
            const timeStr = dt.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
            
            return `
            <div class="dash-deduction-item">
              <div class="dash-deduction-main">
                <div class="dash-deduction-emp">${escHtml(log.employee_name || 'موظف')}</div>
                <div class="dash-deduction-meta">
                  <span>بواسطة: <strong class="dash-deduction-by">${escHtml(log.added_by)}</strong></span>
                  <span>•</span>
                  <span>${escHtml(dateStr)} - ${escHtml(timeStr)}</span>
                </div>
                ${log.note ? `<div class="dash-deduction-note">${escHtml(log.note)}</div>` : ''}
              </div>
              <div class="dash-deduction-side">
                ${log.amount > 0 ? `<span class="dash-deduction-amt">−${formatCurrency(log.amount)}</span>` : '<span class="badge badge-gray" style="font-size:10px;">ملاحظة فقط</span>'}
                ${log.image_data ? `
                  <img src="${log.image_data}" class="dash-deduction-img-thumb" alt="صورة توضيحية" 
                    onclick="viewGlobalImage(this.src)" title="اضغط لتكبير الصورة">
                ` : ''}
              </div>
            </div>`;
        }).join('');

    } catch (err) {
        console.error('[dashboard] failed to load deduction logs:', err);
        listEl.innerHTML = `<div style="color:var(--c-error); text-align:center; padding:16px;">فشل تحميل خصومات المراقبين</div>`;
    }
}


function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// ─── جدول الرواتب الأخيرة ─────────────────────────────────────────────────

function renderRecentSalaries(salaries, employees) {
  const tbody = document.getElementById('dash-salaries-tbody');
  if (!tbody) return;

  if (!salaries.length) {
    tbody.innerHTML = `<tr><td colspan="5">
      <div class="empty-state">
        <svg viewBox="0 0 24 24"><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 0 1 0 10h-2"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
        <strong>لا توجد سجلات رواتب هذا الشهر</strong>
        <span>اذهب إلى صفحة الرواتب الشهرية لإضافة سجلات.</span>
      </div>
    </td></tr>`;
    return;
  }

  const sorted = [...salaries].sort((a, b) => (b.final_salary || 0) - (a.final_salary || 0));
  const empMap = Object.fromEntries(employees.map(e => [e.id, e]));

  window._dashLastSalaries = salaries; // Store for filtering
  window._dashLastEmployees = employees;
  window._dashRenderSalariesParams = { tbody, sorted, empMap };
  _renderDashSalRows(sorted, empMap, tbody);
}

function _renderDashSalRows(sorted, empMap, tbody, filterText = '') {
  const q = filterText.toLowerCase();

  const filtered = sorted.filter(sal => {
    const emp = empMap[sal.employee_id] || {};
    const name = emp.name || '';
    return name.toLowerCase().includes(q);
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--c-text-2);padding:16px;">لا توجد نتائج مطابقة</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.slice(0, 8).map(sal => {
    const emp = empMap[sal.employee_id] || {};
    const role = emp.role || '—';
    return `<tr>
      <td data-label="الموظف" class="fw-600">${escHtml(emp.name || '—')}</td>
      <td data-label="الوظيفة"><span class="badge ${getRoleBadgeClass(role)}">${escHtml(role)}</span></td>
      <td data-label="الراتب الأساسي">${formatCurrency(emp.base_salary || 0)}</td>
      <td data-label="المكافأة" class="text-success fw-600">+${formatCurrency(sal.bonus || 0)}</td>
      <td data-label="الراتب النهائي" class="fw-600">${formatCurrency(sal.final_salary || 0)}</td>
    </tr>`;
  }).join('');
}

function filterDashSalaries() {
  const el = document.getElementById('dash-sal-search');
  if (!el || !window._dashRenderSalariesParams) return;
  const p = window._dashRenderSalariesParams;
  _renderDashSalRows(p.sorted, p.empMap, p.tbody, el.value.trim());
}

// ─── توزيع الوظائف ────────────────────────────────────────────────────────

function renderRoleBreakdown(employees) {
  const container = document.getElementById('dash-role-breakdown');
  if (!container) return;

  if (!employees.length) {
    container.innerHTML = `<div class="empty-state" style="padding:24px">
      <strong>لا توجد بيانات بعد</strong>
    </div>`;
    return;
  }

  // Group by role and count
  const roleMap = {};
  employees.forEach(e => {
    const role = e.role || 'غير محدد';
    if (!roleMap[role]) roleMap[role] = { count: 0, totalSalary: 0 };
    roleMap[role].count++;
    roleMap[role].totalSalary += e.base_salary || 0;
  });

  // Sort by count descending
  const sorted = Object.entries(roleMap).sort((a, b) => b[1].count - a[1].count);
  const max = sorted[0]?.[1].count || 1;

  container.innerHTML = sorted.map(([role, data]) => {
    const pct = Math.round((data.count / employees.length) * 100);
    const barWidth = Math.round((data.count / max) * 100);
    const badgeCls = getRoleBadgeClass(role);
    const icon = getRoleIcon(role);

    return `
      <div class="role-row">
        <div class="role-icon-box">${icon}</div>
        <div class="role-name">${role}</div>
        <div class="role-count-pill">${data.count} موظف</div>
      </div>`;
  }).join('');
}

function getRoleIcon(role) {
  if (role.includes('مدير') || role.includes('إدارة'))
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
  if (role.includes('شيف') || role.includes('طباخ'))
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 13.87A4 4 0 0 1 7.41 6.38 4 4 0 0 1 15.63 8.35 4 4 0 0 1 12 11.53"/><path d="M15.63 8.35 A4 4 0 0 1 12 11.53"/><rect x="8" y="14" width="8" height="7" rx="2"/></svg>';
  if (role.includes('مقدم') || role.includes('ويتر') || role.includes('كابتن'))
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>';
  if (role.includes('كاشير') || role.includes('حسابات'))
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
}

function getRoleBadgeClass(role) {
  if (!role) return 'badge-gray';
  if (role.includes('مدير') || role.includes('إدارة')) return 'badge-purple';
  if (role.includes('شيف') || role.includes('طباخ')) return 'badge-orange';
  if (role.includes('مقدم') || role.includes('ويتر') || role.includes('كابتن')) return 'badge-blue';
  if (role.includes('كاشير') || role.includes('حسابات')) return 'badge-green';
  return 'badge-gray';
}
