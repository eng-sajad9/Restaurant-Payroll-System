/**
 * analytics.js
 * Comprehensive analytics dashboard with month filtering and modern visualizations.
 */

let _barChart = null;
let _donutChart = null;
let _selectedAnalyticsMonth = getCurrentMonth();

/**
 * Initialize the analytics page.
 */
async function initAnalytics() {
    if (!canViewAnalytics()) {
        showToast('ليس لديك صلاحية عرض التحليلات.', 'error');
        navigateTo('dashboard');
        return;
    }
    setBreadcrumb('التحليلات والمؤشرات', 'مراقبة الأداء المالي والإنتاجي');

    // Setup month selector
    const monthSelect = document.getElementById('an-month-select');
    if (monthSelect) {
        monthSelect.innerHTML = buildMonthOptions(_selectedAnalyticsMonth);
        monthSelect.onchange = (e) => {
            _selectedAnalyticsMonth = e.target.value;
            loadAnalyticsData();
        };
    }

    await loadAnalyticsData();
}

/**
 * Load and render all analytics data for the selected month.
 */
async function loadAnalyticsData() {
    const loadingEl = document.getElementById('analytics-loading');
    const chartsEl = document.getElementById('analytics-charts');

    if (loadingEl) loadingEl.style.display = 'flex';
    if (chartsEl) chartsEl.style.display = 'none';

    try {
        // Use CACHED data for static/large collections
        const [employees, drivers] = await Promise.all([
            cachedGet('employees'),
            cachedGet('drivers')
        ]);

        const driversFlat = drivers.map(d => ({ ...d, role: 'سائق دليفري' }));
        const allStaff = [...employees, ...driversFlat];

        // For salaries, we fetch all for now because the 6-month chart needs it. 
        // Optimization: In a real app, we'd fetch only last 6 months.
        // For now, let's at least use the cache for salaries IF acceptable, 
        // but salaries change often, so maybe just a standard fetch but only once per analytics view.
        // However, user wants to save reads. Let's fetch all salaries once and cache them until an update.
        const allSalaries = await cachedGet('salaries');

        const cm = _selectedAnalyticsMonth;
        const pm = getPreviousMonthKey(cm);

        // Core Rendering Tasks
        renderAnalyticsSummary(allStaff, allSalaries, cm, pm);
        buildGrowthChart(allSalaries);
        buildDistributionChart(allSalaries, allStaff, cm);
        renderTopDriversList(driversFlat, allSalaries, cm);
        renderExpenseBreakdown(allStaff, allSalaries, cm);

        if (loadingEl) loadingEl.style.display = 'none';
        if (chartsEl) chartsEl.style.display = 'grid';
    } catch (err) {
        console.error('[analytics] load failed:', err);
        showToast('حدث خطأ أثناء تحميل البيانات التحليلية', 'error');
    }
}

/**
 * Helper to get previous month YYYY-MM
 */
function getPreviousMonthKey(currentKey) {
    const [y, m] = currentKey.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Render the top 4 status cards.
 */
function renderAnalyticsSummary(staff, salaries, cm, pm) {
    const thisMonthSalaries = salaries.filter(s => s.month === cm);
    const lastMonthSalaries = salaries.filter(s => s.month === pm);

    // 1. Total Expenses (Final Salaries)
    const totalThis = thisMonthSalaries.reduce((sum, s) => sum + (s.final_salary || 0), 0);
    const totalLast = lastMonthSalaries.reduce((sum, s) => sum + (s.final_salary || 0), 0);
    setAnVal('an-total', formatCurrency(totalThis));
    renderDiffBadge('an-total-diff', totalThis, totalLast);

    // 2. Average Salary
    const avgThis = thisMonthSalaries.length ? totalThis / thisMonthSalaries.length : 0;
    const avgLast = lastMonthSalaries.length ? totalLast / lastMonthSalaries.length : 0;
    setAnVal('an-avg', formatCurrency(avgThis));
    renderDiffBadge('an-avg-diff', avgThis, avgLast);

    // 3. Delivery Orders Count
    const ordersThis = thisMonthSalaries.reduce((sum, s) => sum + (s.delivery_orders || 0), 0);
    const ordersLast = lastMonthSalaries.reduce((sum, s) => sum + (s.delivery_orders || 0), 0);
    setAnVal('an-orders', ordersThis.toLocaleString('en-US'));
    renderDiffBadge('an-orders-diff', ordersThis, ordersLast, false);

    // 4. Avg Delivery Cost
    const totalOrderPay = thisMonthSalaries.reduce((sum, s) => sum + ((s.delivery_orders || 0) * (s.order_price || 0)), 0);
    const avgOrderCost = ordersThis ? totalOrderPay / ordersThis : 0;
    setAnVal('an-order-avg', formatCurrency(avgOrderCost));
}

/**
 * Render comparison badge for cards.
 */
function renderDiffBadge(id, current, last, isCurrency = true) {
    const el = document.getElementById(id);
    if (!el) return;

    if (!last || last === 0) {
        el.innerHTML = '<span style="color:var(--c-text-3); font-size:11px;">بداية البيانات</span>';
        return;
    }

    const diff = current - last;
    const percent = ((diff / last) * 100).toFixed(1);
    const isUp = diff > 0;
    const color = isUp ? 'var(--c-error)' : 'var(--c-success)'; // Expense up is bad (red), down is good (green)

    // For non-currency (like orders), up is usually good
    const finalColor = isCurrency ? color : (isUp ? 'var(--c-success)' : 'var(--c-error)');

    el.innerHTML = `<span style="color:${finalColor}; font-weight:700;">${isUp ? '↑' : '↓'} ${Math.abs(percent)}%</span> عن السابق`;
}

/**
 * Render the Top 5 Drivers list.
 */
function renderTopDriversList(drivers, salaries, month) {
    const tbody = document.getElementById('an-top-drivers-tbody');
    if (!tbody) return;

    const stats = salaries.filter(s => s.month === month && s.delivery_orders > 0)
        .map(s => {
            const d = drivers.find(drv => drv.id === s.employee_id);
            return {
                name: d ? d.name : 'سائق محذوف',
                orders: s.delivery_orders || 0
            };
        })
        .sort((a, b) => b.orders - a.orders)
        .slice(0, 5);

    if (!stats.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted" style="padding:20px;">لا توجد بيانات لهذا الشهر</td></tr>';
        return;
    }

    tbody.innerHTML = stats.map((d, i) => `
        <tr>
            <td><span class="rank-badge ${i < 3 ? 'top-' + (i + 1) : ''}">${i + 1}</span></td>
            <td class="fw-600">${escHtml(d.name)}</td>
            <td><span class="badge badge-blue">${d.orders} طلب</span></td>
            <td>${getDriverRank(d.orders)}</td>
        </tr>
    `).join('');
}

function getDriverRank(orders) {
    if (orders >= 150) return '<span class="badge badge-purple">برق ⚡</span>';
    if (orders >= 100) return '<span class="badge badge-green">نشط جداً</span>';
    return '<span class="badge badge-gray">عادي</span>';
}

/**
 * Render administrative expense breakdown table.
 */
function renderExpenseBreakdown(staff, salaries, month) {
    const tbody = document.getElementById('an-expense-summary-tbody');
    if (!tbody) return;

    const thisSalaries = salaries.filter(s => s.month === month);
    const totalFinal = thisSalaries.reduce((sum, s) => sum + (s.final_salary || 0), 0);

    // Group by category (Role)
    const empMap = Object.fromEntries(staff.map(e => [e.id, e]));
    const categories = {};

    thisSalaries.forEach(s => {
        const role = empMap[s.employee_id]?.role || 'أخرى';
        if (!categories[role]) categories[role] = 0;
        categories[role] += s.final_salary || 0;
    });

    const entries = Object.entries(categories).sort((a, b) => b[1] - a[1]);

    if (!entries.length) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">لا بيانات</td></tr>';
        return;
    }

    tbody.innerHTML = entries.map(([role, val]) => {
        const share = totalFinal ? ((val / totalFinal) * 100).toFixed(1) : 0;
        return `
            <tr>
                <td class="fw-600">${role}</td>
                <td>${formatCurrency(val)}</td>
                <td>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <div style="flex:1; height:6px; background:#e2e8f0; border-radius:3px; overflow:hidden;">
                            <div style="width:${share}%; height:100%; background:var(--c-accent);"></div>
                        </div>
                        <span style="font-size:11px; color:var(--c-text-2); min-width:35px;">${share}%</span>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Build the 6-month growth bar chart.
 */
function buildGrowthChart(salaries) {
    const months = [];
    const labels = [];
    const now = new Date();

    // Get last 6 months
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = d.toLocaleDateString('ar-SA', { month: 'short' });
        months.push(key);
        labels.push(label);
    }

    const totals = months.map(m => salaries.filter(s => s.month === m).reduce((a, b) => a + (b.final_salary || 0), 0));

    const ctx = document.getElementById('monthly-chart');
    if (!ctx) return;
    if (_barChart) _barChart.destroy();

    _barChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'إجمالي المصاريف',
                data: totals,
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                borderColor: '#2563eb',
                borderWidth: 2,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { font: { size: 10 }, callback: v => v >= 1000 ? (v / 1000) + 'k' : v } }
            }
        }
    });
}

/**
 * Build the cost distribution doughnut chart.
 */
function buildDistributionChart(salaries, staff, month) {
    const thisSalaries = salaries.filter(s => s.month === month);
    const empMap = Object.fromEntries(staff.map(e => [e.id, e]));

    const roleTotals = {};
    thisSalaries.forEach(s => {
        const role = empMap[s.employee_id]?.role || 'أخرى';
        roleTotals[role] = (roleTotals[role] || 0) + (s.final_salary || 0);
    });

    const labels = Object.keys(roleTotals);
    const data = Object.values(roleTotals);
    const colors = ['#2563eb', '#7c3aed', '#059669', '#ea580c', '#db2777', '#4b5563'];

    const ctx = document.getElementById('role-chart');
    if (!ctx) return;
    if (_donutChart) _donutChart.destroy();

    _donutChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } }
            }
        }
    });
}

/** Utility to set text content safety */
function setAnVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

