/**
 * analytics.js
 * Chart.js charts — monthly salary expenses and salary distribution by role.
 */

let _barChart = null;
let _donutChart = null;

async function initAnalytics() {
    setBreadcrumb('التحليلات', 'اتجاهات الرواتب وتوزيعها');
    await loadAnalyticsData();
}

async function loadAnalyticsData() {
    const loadingEl = document.getElementById('analytics-loading');
    const chartsEl = document.getElementById('analytics-charts');
    if (loadingEl) loadingEl.style.display = 'flex';
    if (chartsEl) chartsEl.style.display = 'none';

    try {
        const [empSnap, drvSnap, salSnap] = await Promise.all([
            db.collection('employees').get(),
            db.collection('drivers').get(),
            db.collection('salaries').get()
        ]);

        const employees = empSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const driverEmps = drvSnap.docs.map(d => ({ id: d.id, role: 'سائق دليفري', ...d.data() }));
        const allPersonnel = [...employees, ...driverEmps];
        const salaries = salSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const cm = getCurrentMonth();
        const pm = getPreviousMonthKey(cm);

        buildMonthlyChart(salaries);
        buildRoleChart(salaries, allPersonnel);
        renderAnalyticsSummary(allPersonnel, salaries, cm, pm);
        renderTopDrivers(driverEmps, salaries, cm);

        if (loadingEl) loadingEl.style.display = 'none';
        if (chartsEl) chartsEl.style.display = 'grid';
    } catch (err) {
        console.error('[analytics] error:', err);
        showToast('فشل تحميل بيانات التحليلات.', 'error');
    }
}

function getPreviousMonthKey(currentKey) {
    const [y, m] = currentKey.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function renderAnalyticsSummary(employees, salaries, cm, pm) {
    const thisSalaries = salaries.filter(s => s.month === cm);
    const lastSalaries = salaries.filter(s => s.month === pm);

    // 1. Total Expenses
    const totalThis = thisSalaries.reduce((sum, s) => sum + (s.final_salary || 0), 0);
    const totalLast = lastSalaries.reduce((sum, s) => sum + (s.final_salary || 0), 0);
    setVal('an-total', formatCurrency(totalThis));
    renderDiff('an-total-diff', totalThis, totalLast, true);

    // 2. Average Salary
    const avgThis = thisSalaries.length ? totalThis / thisSalaries.length : 0;
    const avgLast = lastSalaries.length ? totalLast / lastSalaries.length : 0;
    setVal('an-avg', formatCurrency(avgThis));
    renderDiff('an-avg-diff', avgThis, avgLast, true);

    // 3. Delivery Orders
    const ordersThis = thisSalaries.reduce((sum, s) => sum + (s.delivery_orders || 0), 0);
    const ordersLast = lastSalaries.reduce((sum, s) => sum + (s.delivery_orders || 0), 0);
    setVal('an-orders', ordersThis.toLocaleString('en-US'));
    renderDiff('an-orders-diff', ordersThis, ordersLast, false, 'طلب');

    // 4. Average Delivery Cost
    const deliveryCost = thisSalaries.filter(s => s.delivery_orders > 0)
        .reduce((sum, s) => sum + (s.delivery_orders * (s.order_price || 0)), 0);
    const avgOrderCost = ordersThis ? deliveryCost / ordersThis : 0;
    setVal('an-order-avg', formatCurrency(avgOrderCost));
}

function renderDiff(id, current, last, isCurrency, unit = '') {
    const el = document.getElementById(id);
    if (!el) return;

    if (!last || last === 0) {
        el.innerHTML = `<span class="text-muted">بيانات أولية</span>`;
        return;
    }

    const diff = current - last;
    const percent = Math.abs((diff / last) * 100).toFixed(1);
    const isUp = diff > 0;
    const icon = isUp ? '↑' : '↓';
    const colorClass = isUp ? 'growth-up' : 'growth-down';

    el.innerHTML = `<span class="${colorClass}">${icon} ${percent}%</span> عن الشهر الماضي`;
}

function renderTopDrivers(drivers, salaries, month) {
    const tbody = document.getElementById('an-top-drivers-tbody');
    if (!tbody) return;

    const monthSalaries = salaries.filter(s => s.month === month && s.delivery_orders > 0);
    const driverStats = monthSalaries.map(s => {
        const d = drivers.find(drv => drv.id === s.employee_id);
        return {
            name: d ? d.name : 'سائق محذوف',
            orders: s.delivery_orders || 0,
            commission: (s.delivery_orders || 0) * (s.order_price || 0)
        };
    }).sort((a, b) => b.orders - a.orders).slice(0, 5);

    if (!driverStats.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">لا يوجد نشاط توصيل مسجل هذا الشهر.</td></tr>`;
        return;
    }

    tbody.innerHTML = driverStats.map((d, i) => `
        <tr>
            <td><span class="rank-badge ${i < 3 ? 'top-' + (i + 1) : ''}">${i + 1}</span></td>
            <td class="fw-600">${escHtml(d.name)}</td>
            <td><span class="badge blue">${d.orders} طلب</span></td>
            <td class="highlight-cell">${formatCurrency(d.commission)}</td>
            <td>${getDriverLevel(d.orders)}</td>
        </tr>
    `).join('');
}

function getDriverLevel(orders) {
    if (orders >= 150) return '<span class="badge purple">برق ⚡</span>';
    if (orders >= 100) return '<span class="badge green">نشط جداً</span>';
    if (orders >= 50) return '<span class="badge blue">نشط</span>';
    return '<span class="badge gray">مبتدئ</span>';
}

function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function buildMonthlyChart(salaries) {
    const months = [];
    const labels = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = d.toLocaleDateString('ar-SA', { month: 'short', year: '2-digit' });
        months.push(key);
        labels.push(label);
    }

    const totals = months.map(m =>
        salaries.filter(s => s.month === m).reduce((sum, s) => sum + (s.final_salary || 0), 0)
    );

    const ctx = document.getElementById('monthly-chart');
    if (!ctx) return;
    if (_barChart) _barChart.destroy();

    _barChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'إجمالي الرواتب',
                data: totals,
                backgroundColor: 'rgba(37, 99, 235, 0.12)',
                borderColor: 'rgba(37, 99, 235, 0.8)',
                borderWidth: 2,
                borderRadius: 8,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    padding: 12,
                    callbacks: {
                        label: ctx => '  ' + new Intl.NumberFormat('ar-IQ').format(ctx.parsed.y) + ' د.ع'
                    }
                }
            },
            scales: {
                x: { grid: { display: false }, ticks: { font: { family: 'IBM Plex Sans Arabic', size: 12 } } },
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(0,0,0,.04)', drawBorder: false },
                    ticks: {
                        font: { size: 11 },
                        callback: v => new Intl.NumberFormat('ar-IQ', { notation: 'compact' }).format(v)
                    }
                }
            }
        }
    });
}

function buildRoleChart(salaries, employees) {
    const empMap = Object.fromEntries(employees.map(e => [e.id, e]));
    const roleMap = {};

    const cm = getCurrentMonth();
    salaries.filter(s => s.month === cm).forEach(sal => {
        const emp = empMap[sal.employee_id];
        const role = emp ? (emp.role || 'غير محدد') : 'غير محدد';
        roleMap[role] = (roleMap[role] || 0) + (sal.final_salary || 0);
    });

    const labels = Object.keys(roleMap);
    const data = Object.values(roleMap);
    const palette = ['#2563eb', '#7c3aed', '#059669', '#ea580c', '#d97706', '#dc2626', '#0891b2', '#4f46e5'];

    const ctx = document.getElementById('role-chart');
    if (!ctx) return;
    if (_donutChart) _donutChart.destroy();

    _donutChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: palette.slice(0, labels.length),
                borderWidth: 0,
                hoverOffset: 12
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '72%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        font: { family: 'IBM Plex Sans Arabic', size: 11 },
                        padding: 20,
                        usePointStyle: true
                    }
                },
                tooltip: {
                    padding: 12,
                    callbacks: {
                        label: ctx => '  ' + new Intl.NumberFormat('ar-IQ').format(ctx.parsed) + ' د.ع'
                    }
                }
            }
        }
    });
}

