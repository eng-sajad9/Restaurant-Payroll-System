/**
 * export.js
 * Excel export (SheetJS) and PDF/Print export for employees, salaries, and drivers.
 * Date and time are embedded automatically in every printed document.
 */

// ─── Date/Time Helper ─────────────────────────────────────────────────────────

function getPrintDateTime() {
    const now = new Date();
    const date = now.toLocaleDateString('ar-SA', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    const time = now.toLocaleTimeString('ar-SA', {
        hour: '2-digit', minute: '2-digit', hour12: true
    });
    return `${date}  —  الساعة ${time}`;
}

// ─── Print / PDF Engine ───────────────────────────────────────────────────────

function openPrintWindow(title, subtitle, columns, rows, totalRow, periodBanner) {
    const datetime = getPrintDateTime();

    const tableRows = rows.map(r =>
        `<tr>${r.map(c => `<td>${_esc(String(c ?? '—'))}</td>`).join('')}</tr>`
    ).join('');

    const totalHtml = totalRow
        ? `<tr class="total-row">${totalRow.map(c => `<td>${_esc(String(c ?? ''))}</td>`).join('')}</tr>`
        : '';

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<title>${title}</title>
<style>
* { box-sizing:border-box; margin:0; padding:0; }
body {
  font-family:'IBM Plex Sans Arabic','Segoe UI Arabic','Tahoma',sans-serif;
  font-size:11pt; color:#0f172a; direction:rtl;
  padding:15mm 18mm 20mm;
}
.hdr {
  display:flex; justify-content:space-between; align-items:flex-start;
  border-bottom:3px solid #1e3a5f; padding-bottom:12px; margin-bottom:18px;
}
.brand-name { font-size:16pt; font-weight:700; color:#1e3a5f; }
.brand-sub  { font-size:9pt; color:#64748b; margin-top:3px; }
.meta { text-align:left; }
.meta-title { font-size:12pt; font-weight:700; color:#1e3a5f; margin-bottom:4px; }
.meta-date  { font-size:9pt; color:#475569; }
.subtitle   { font-size:10pt; color:#475569; margin-bottom:18px; }
table { width:100%; border-collapse:collapse; margin-bottom:14px; }
th {
  background:#1e3a5f; color:#fff;
  padding:8px 10px; font-size:9.5pt; font-weight:700;
  text-align:right; border:1px solid #2d4f7f;
}
td {
  padding:7px 10px; font-size:10pt; text-align:right;
  border:1px solid #e2e8f0; vertical-align:middle;
}
tr:nth-child(even) td { background:#f8fafc; }
.total-row td {
  background:#1e3a5f !important; color:#fff !important;
  font-weight:700; border-color:#1e3a5f;
}
.footer {
  font-size:8pt; color:#94a3b8; text-align:center;
  border-top:1px solid #e2e8f0; padding-top:8px;
}
@page { size:A4; margin:0; }
@media print {
  body { padding:8mm 12mm 16mm; }
}
</style>
</head>
<body>
<div class="hdr">
  <div>
    <div class="brand-name">إدارة رواتب المطعم</div>
    <div class="brand-sub">نظام إدارة موظفي المطعم</div>
  </div>
  <div class="meta">
    <div class="meta-title">${title}</div>
    <div class="meta-date">${datetime}</div>
  </div>
</div>
${subtitle ? `<div class="subtitle">${subtitle}</div>` : ''}
${periodBanner || ''}
<table>
  <thead>
    <tr>${columns.map(c => `<th>${c}</th>`).join('')}</tr>
  </thead>
  <tbody>
    ${tableRows}
    ${totalHtml}
  </tbody>
</table>
<div class="footer">طُبع بتاريخ: ${datetime}  —  إدارة رواتب المطعم</div>
</body>
</html>`;

    const w = window.open('', '_blank');
    if (!w) {
        showToast('يرجى السماح للمتصفح بفتح نوافذ جديدة ثم أعد المحاولة.', 'warning');
        return;
    }
    w.document.write(html);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 700);
}

// ─── Excel Helper ─────────────────────────────────────────────────────────────

function downloadExcel(headers, rows, filename) {
    if (typeof XLSX === 'undefined') {
        showToast('مكتبة Excel غير محملة. تحقق من الاتصال بالإنترنت.', 'error');
        return;
    }
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = headers.map(() => ({ wch: 24 }));
    // RTL sheet direction
    if (!ws['!opts']) ws['!opts'] = {};
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'بيانات');
    XLSX.writeFile(wb, filename + '.xlsx');
    showToast('تم تصدير ملف Excel بنجاح.');
}

function _esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ═══════════════════════════════════════════════════════════════
//  EMPLOYEES
// ═══════════════════════════════════════════════════════════════

function exportEmployees(format) {
    const list = (typeof _employees !== 'undefined' ? _employees : [])
        .filter(e => !isDriver(e.role));
    if (!list.length) { showToast('لا توجد بيانات للتصدير.', 'warning'); return; }

    const headers = ['#', 'الاسم', 'الراتب الأساسي (د.ع)', 'الوظيفة', 'الهاتف'];

    if (format === 'excel') {
        const rows = list.map((e, i) => [i + 1, e.name, e.base_salary || 0, e.role, e.phone || '']);
        downloadExcel(headers, rows, 'الموظفون');
    } else {
        const rows = list.map((e, i) => [i + 1, e.name, formatCurrency(e.base_salary), e.role, e.phone || '—']);
        const total = list.reduce((s, e) => s + (e.base_salary || 0), 0);
        const totalRow = ['', 'إجمالي الرواتب الأساسية', formatCurrency(total), '', ''];
        openPrintWindow(
            'كشف الموظفين',
            `إجمالي الموظفين: ${list.length} موظف`,
            headers, rows, totalRow
        );
    }
}

// ═══════════════════════════════════════════════════════════════
//  MONTHLY SALARIES
// ═══════════════════════════════════════════════════════════════

function exportSalaries(format) {
    const sals = typeof _salaries !== 'undefined' ? _salaries : [];
    const emps = typeof _allEmps !== 'undefined' ? _allEmps : [];
    const month = typeof _salMonth !== 'undefined' ? _salMonth : '—';

    if (!sals.length) { showToast('لا توجد سجلات رواتب للتصدير.', 'warning'); return; }

    const empMap = Object.fromEntries(emps.map(e => [e.id, e]));
    const headers = ['#', 'الموظف', 'الوظيفة', 'الراتب الأساسي (د.ع)', 'المكافأة (د.ع)', 'الخصم (د.ع)', 'الراتب النهائي (د.ع)', 'الملاحظات'];

    let totalFinal = 0;

    if (format === 'excel') {
        const rows = sals.map((s, i) => {
            const emp = empMap[s.employee_id];
            const empName = emp ? emp.name : (s.employee_name ? s.employee_name + ' (محذوف)' : s.employee_id || '—');
            totalFinal += s.final_salary || 0;
            return [i + 1, empName, emp?.role || '—',
            emp?.base_salary || 0, s.bonus || 0,
            s.deduction || 0, s.final_salary || 0, s.deduction_note || ''];
        });
        // Add totals row at the bottom in Excel too
        rows.push(['', '', '', '', '', 'المجموع النهائي', totalFinal, '']);
        downloadExcel(headers, rows, `الرواتب_الشهرية_${month}`);
    } else {
        const rows = sals.map((s, i) => {
            const emp = empMap[s.employee_id];
            const empName = emp ? emp.name : (s.employee_name ? s.employee_name + ' (محذوف)' : s.employee_id || '—');
            totalFinal += s.final_salary || 0;
            return [i + 1, empName, emp?.role || '—',
            formatCurrency(emp?.base_salary || 0),
            formatCurrency(s.bonus || 0),
            formatCurrency(s.deduction || 0),
            formatCurrency(s.final_salary || 0),
            s.deduction_note || '—'];
        });
        const totalRow = ['', '', '', '', '', 'المجموع النهائي', formatCurrency(totalFinal), ''];
        openPrintWindow(
            'كشف الرواتب الشهرية',
            `الشهر: ${getMonthLabel(month)}  —  عدد السجلات: ${sals.length}`,
            headers, rows, totalRow
        );
    }
}

// ═══════════════════════════════════════════════════════════════
//  DELIVERY DRIVERS
// ═══════════════════════════════════════════════════════════════

function exportDrivers(format) {
    const drvs = typeof _driverEmps !== 'undefined' ? _driverEmps : [];
    const recs = typeof _driverRecords !== 'undefined' ? _driverRecords : [];
    const month = typeof _drvMonth !== 'undefined' ? _drvMonth : '—';
    const period = typeof _drvPeriod !== 'undefined' ? _drvPeriod : 'full';

    const PLABELS = {
        full: 'الشهر كامل',
        first: 'النصف الأول (1 - 15)',
        second: 'النصف الثاني (16 - نهاية الشهر)',
    };
    const periodLabel = PLABELS[period] || period;
    const isHalf = period === 'first' || period === 'second';

    if (!drvs.length) { showToast('لا يوجد سائقون للتصدير.', 'warning'); return; }

    const recMap = Object.fromEntries(recs.map(r => [r.employee_id, r]));
    const headers = ['#', 'السائق', 'فترة الدفع', 'الوردية', 'الراتب الأساسي (د.ع)', 'عدد الطلبات',
        'سعر الطلب (د.ع)', 'أجر الطلبات (د.ع)', 'مكافأة (د.ع)', 'خصم (د.ع)', 'الراتب النهائي (د.ع)', 'ملاحظات'];

    const shiftLabel = s => s === 'مسائي' ? 'مسائي' : (s === 'صباحي' ? 'صباحي' : '—');

    let totalPay = 0;

    if (format === 'excel') {
        const dataRows = drvs.map((drv, i) => {
            const rec = recMap[drv.id];
            const orders = rec ? (rec.delivery_orders || 0) : 0;
            const price = rec ? (rec.order_price || 0) : 0;
            const final = rec ? (rec.final_salary || 0) : 0;
            const savedBase = rec?.base_salary_paid !== undefined ? rec.base_salary_paid : (drv.base_salary || 0);
            const drvName = drv.id ? drv.name : (rec?.employee_name ? rec.employee_name + ' (محذوف)' : '—');
            totalPay += final;
            return [i + 1, drvName, periodLabel, shiftLabel(rec?.shift_type),
                savedBase, orders, price,
            orders * price, rec ? (rec.bonus || 0) : 0,
            rec ? (rec.deduction || 0) : 0, final, rec ? (rec.note || '') : ''];
        });
        dataRows.push(['', '', '', '', '', '', '', '', '', '', 'إجمالي المدفوعات', totalPay]);

        const colCount = headers.length;

        // Build sheet rows: period info banner + blank + headers + data
        const infoRow1 = [`كشف مدفوعات الدليفري — ${getMonthLabel(month)}`];
        const infoRow2 = [`الفترة: ${periodLabel}`];
        const infoRow3 = [`تاريخ التصدير: ${new Date().toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`];
        const blankRow = [''];

        const allRows = [infoRow1, infoRow2, infoRow3, blankRow, headers, ...dataRows];
        const ws = XLSX.utils.aoa_to_sheet(allRows);
        ws['!cols'] = headers.map(() => ({ wch: 24 }));

        // Style the period info rows (make them bold/wide) via merge
        ws['!merges'] = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } },
            { s: { r: 1, c: 0 }, e: { r: 1, c: colCount - 1 } },
            { s: { r: 2, c: 0 }, e: { r: 2, c: colCount - 1 } },
        ];

        const safePeriod = { full: 'كامل', first: 'اول', second: 'ثاني' }[period] || period;
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'بيانات');
        XLSX.writeFile(wb, `الدليفري_${month}_${safePeriod}.xlsx`);
        showToast('تم تصدير ملف Excel بنجاح.');
    } else {
        const rows = drvs.map((drv, i) => {
            const rec = recMap[drv.id];
            const orders = rec ? (rec.delivery_orders || 0) : 0;
            const price = rec ? (rec.order_price || 0) : 0;
            const final = rec ? (rec.final_salary || 0) : 0;
            const savedBase = rec?.base_salary_paid !== undefined ? rec.base_salary_paid : (drv.base_salary || 0);
            const drvName = drv.id ? drv.name : (rec?.employee_name ? rec.employee_name + ' (محذوف)' : '—');
            totalPay += final;
            return [
                i + 1,
                drvName,
                periodLabel,
                shiftLabel(rec?.shift_type),
                formatCurrency(savedBase),
                orders.toLocaleString('en-US'),
                formatCurrency(price),
                formatCurrency(orders * price),
                formatCurrency(rec ? (rec.bonus || 0) : 0),
                formatCurrency(rec ? (rec.deduction || 0) : 0),
                formatCurrency(final),
                rec ? (rec.note || '') : ''
            ];
        });
        const totalRow = ['', '', '', '', '', '', '', '', '', '', 'إجمالي المدفوعات', formatCurrency(totalPay)];

        // Build a period banner for PDF — only shown when half-month
        const periodBanner = isHalf
            ? `<div style="display:inline-block; background:${period === 'first' ? '#dcfce7' : '#fffbeb'}; border:1px solid ${period === 'first' ? '#4ade80' : '#fcd34d'}; border-radius:6px; padding:6px 12px; margin-bottom:14px; font-size:10.5pt; font-weight:700; color:${period === 'first' ? '#166534' : '#92400e'}; box-shadow:0 1px 2px rgba(0,0,0,0.05);">
               ⚠️ كشف مخصص لـ (${periodLabel}) وليس الشهر بأكمله
             </div>`
            : '';

        openPrintWindow(
            `كشف مدفوعات الدليفري — ${periodLabel}`,
            `الشهر: ${getMonthLabel(month)}  ●  الفترة: ${periodLabel}  ●  عدد السائقين: ${drvs.length}`,
            headers, rows, totalRow,
            periodBanner
        );
    }
}
