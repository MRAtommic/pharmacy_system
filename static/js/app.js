/**
 * 🏥 Pharmacy Stock Management System - Frontend App
 * Dynamic reactive UI with Light/Dark Mode, QR Scanner, CRUD, and Dispensing Flow.
 */

let allDrugs = [];
let currentTab = 'inventory';
let html5QrScanner = null;
let selectedDrugForDispense = null;

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    loadDashboardStats();
    loadDrugs();
    loadDispensingLogs();
    setupEventListeners();

    // Check if opened via scanned URL query param: ?scan=MED-0001 or ?dispense=MED-0001
    const urlParams = new URLSearchParams(window.location.search);
    const codeParam = urlParams.get('scan') || urlParams.get('code') || urlParams.get('dispense');
    if (codeParam) {
        setTimeout(() => handleScannedCode(codeParam), 600);
    }

    // Check Google OAuth redirect result
    const googleConnected = urlParams.get('google_connected');
    const googleEmail = urlParams.get('email');
    const googleError = urlParams.get('google_error');

    if (googleConnected) {
        setTimeout(() => {
            showToast(`🎉 เชื่อมต่อ Google สำเร็จแล้ว! สร้างชีตและโฟลเดอร์เรียบร้อย (${googleEmail || 'Google Account'})`, 'success');
            openGoogleSettingsModal();
        }, 500);
        window.history.replaceState({}, document.title, window.location.pathname);
    } else if (googleError) {
        setTimeout(() => {
            showToast(`⚠️ เกิดข้อผิดพลาดในการเชื่อมต่อ Google: ${googleError}`, 'error');
            openGoogleSettingsModal();
        }, 500);
        window.history.replaceState({}, document.title, window.location.pathname);
    }
});

// ─────────────────────────────────────────────────────────────
// Theme Switcher (Dark / Light Mode)
// ─────────────────────────────────────────────────────────────

function initTheme() {
    const savedTheme = localStorage.getItem('pharmacy_theme') || 'light';
    setTheme(savedTheme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    setTheme(next);
}

function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pharmacy_theme', theme);
    
    const themeIcon = document.getElementById('themeIcon');
    const themeText = document.getElementById('themeText');
    if (themeIcon) {
        themeIcon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    }
    if (themeText) {
        themeText.innerText = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
    }
}

// ─────────────────────────────────────────────────────────────
// Navigation & Tab Switching
// ─────────────────────────────────────────────────────────────

function switchTab(tabName) {
    currentTab = tabName;
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    document.querySelectorAll('.mobile-nav-item').forEach(item => {
        if (item.dataset.tab) {
            item.classList.toggle('active', item.dataset.tab === tabName);
        }
    });

    const vInventory = document.getElementById('view-inventory');
    const vLogs = document.getElementById('view-logs');
    const vScanner = document.getElementById('view-scanner');
    const vAnalytics = document.getElementById('view-analytics');
    const vStockIn = document.getElementById('view-stockin');

    if (vInventory) vInventory.style.display = tabName === 'inventory' ? 'block' : 'none';
    if (vLogs) vLogs.style.display = tabName === 'logs' ? 'block' : 'none';
    if (vScanner) vScanner.style.display = tabName === 'scanner' ? 'block' : 'none';
    if (vAnalytics) vAnalytics.style.display = tabName === 'analytics' ? 'block' : 'none';
    if (vStockIn) vStockIn.style.display = tabName === 'stockin' ? 'block' : 'none';

    if (tabName === 'scanner') {
        startScanner();
    } else {
        stopScanner();
    }

    if (tabName === 'logs') {
        loadDispensingLogs();
    } else if (tabName === 'analytics') {
        loadAnalytics();
    } else if (tabName === 'stockin') {
        loadStockInLogs();
    }
}

function updateMobileNav(tabName) {
    document.querySelectorAll('.mobile-nav-item').forEach(item => {
        if (item.dataset.tab) {
            item.classList.toggle('active', item.dataset.tab === tabName);
        }
    });
}

// ─────────────────────────────────────────────────────────────
// Dashboard Statistics
// ─────────────────────────────────────────────────────────────

async function loadDashboardStats() {
    try {
        const res = await fetch('/api/dashboard/stats');
        const data = await res.json();
        if (data.ok) {
            const s = data.stats;
            document.getElementById('statTotalDrugs').innerText = s.total_drugs || 0;
            document.getElementById('statTotalUnits').innerText = (s.total_units || 0).toLocaleString();
            document.getElementById('statLowStock').innerText = s.low_stock_count || 0;
            document.getElementById('statTodayDispensed').innerText = s.today_units_dispensed || 0;

            const expSoonEl = document.getElementById('statExpiringSoon');
            if (expSoonEl) {
                expSoonEl.innerText = s.expiring_soon_count || 0;
            }

            const lowCard = document.getElementById('kpiCardLowStock');
            if (lowCard) {
                lowCard.classList.toggle('has-alerts', (s.low_stock_count || 0) > 0);
            }

            const expCard = document.getElementById('kpiCardExpiring');
            if (expCard) {
                expCard.classList.toggle('has-alerts', (s.expiring_soon_count || 0) > 0);
            }

            const dot = document.getElementById('sheetStatusDot');
            const text = document.getElementById('sheetStatusText');
            if (dot && text) {
                if (s.google_sheet_connected) {
                    dot.className = 'status-dot active';
                    text.innerText = 'Google Sync';
                } else {
                    dot.className = 'status-dot warning';
                    text.innerText = 'Local Cache';
                }
            }

            // LINE Bot Status Pill update
            const lineDot = document.getElementById('lineStatusDot');
            const lineText = document.getElementById('lineStatusText');
            const lineBadge = document.getElementById('lineAlertBadge');
            const linePill = document.getElementById('lineStatusBadge');
            if (lineDot && lineText) {
                lineText.innerText = 'LINE Bot';
                const expCount = Number(s.expiring_soon_count || 0);
                if (expCount > 0) {
                    lineDot.className = 'status-dot warning';
                    if (lineBadge) {
                        lineBadge.style.display = 'inline-flex';
                        lineBadge.innerText = expCount > 99 ? '99+' : expCount;
                    }
                    if (linePill) {
                        linePill.title = `LINE Bot (@905gsngi) — มี ${expCount} รายการยาใกล้หมด/สต็อกต่ำ (คลิกดูการตั้งค่า)`;
                    }
                } else {
                    lineDot.className = 'status-dot active';
                    if (lineBadge) {
                        lineBadge.style.display = 'none';
                    }
                    if (linePill) {
                        linePill.title = `LINE Bot (@905gsngi) — ระบบเชื่อมต่อพร้อมทำงาน`;
                    }
                }
            }
        }
    } catch (e) {
        console.error('Error loading stats:', e);
    }
}

// ─────────────────────────────────────────────────────────────
// Drug Catalog & Inventory Management (CRUD)
// ─────────────────────────────────────────────────────────────

async function loadDrugs() {
    const search = document.getElementById('drugSearchInput')?.value || '';
    const category = document.getElementById('categoryFilter')?.value || 'all';
    const lowStockOnly = document.getElementById('lowStockCheckbox')?.checked ? '1' : '0';
    const expiringOnly = document.getElementById('expiringCheckbox')?.checked ? '1' : '0';

    const url = `/api/drugs?q=${encodeURIComponent(search)}&category=${encodeURIComponent(category)}&low_stock=${lowStockOnly}&expiring=${expiringOnly}`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        if (data.ok) {
            allDrugs = data.drugs;
            renderDrugsTable(allDrugs);
        }
    } catch (e) {
        console.error('Error loading drugs:', e);
    }
}

function renderDrugsTable(drugs) {
    const tbody = document.getElementById('drugsTableBody');
    const cardsContainer = document.getElementById('drugsMobileCards');

    if (!drugs || drugs.length === 0) {
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
                        <i class="fas fa-prescription-bottle" style="font-size: 2rem; color: var(--text-subtle); margin-bottom: 0.5rem; display: block;"></i>
                        ไม่พบรายการยาตามเงื่อนไขที่ค้นหา
                    </td>
                </tr>
            `;
        }
        if (cardsContainer) {
            cardsContainer.innerHTML = `
                <div style="text-align: center; padding: 2.5rem 1rem; color: var(--text-muted); background: var(--bg-surface); border-radius: var(--radius-md); border: 1px dashed var(--border-default);">
                    <i class="fas fa-prescription-bottle" style="font-size: 2rem; color: var(--text-subtle); margin-bottom: 0.5rem; display: block;"></i>
                    ไม่พบรายการยาตามเงื่อนไข
                </div>
            `;
        }
        return;
    }

    if (tbody) {
        tbody.innerHTML = drugs.map(d => {
            const isLow = d.stock_qty <= d.min_threshold;
            const isExpiringSoon = d.is_expiring_soon || (d.days_left !== null && d.days_left !== undefined && d.days_left <= 60);
            const isExpired = d.is_expired;

            let rowClass = '';
            if (isExpired) rowClass = 'class="row-low-stock" style="background-color: rgba(239, 68, 68, 0.05);"';
            else if (isLow) rowClass = 'class="row-low-stock"';
            else if (isExpiringSoon) rowClass = 'style="background-color: rgba(245, 158, 11, 0.04);"';

            const stockBadge = isLow
                ? `<span class="badge badge-danger" style="font-weight: 700; padding: 0.25rem 0.65rem;"><i class="fas fa-circle-exclamation"></i> ใกล้หมด (${d.stock_qty} ${d.unit})</span>`
                : `<span class="badge badge-success" style="font-weight: 700; padding: 0.25rem 0.65rem;"><i class="fas fa-check-circle"></i> ${d.stock_qty} ${d.unit}</span>`;

            let expiryBadge = `<span style="font-size: 0.85rem; color: var(--text-muted);">-</span>`;
            if (isExpired) {
                expiryBadge = `<span class="badge badge-danger" style="font-weight: 700; padding: 0.25rem 0.55rem; font-size: 0.775rem;" title="หมดอายุแล้ว"><i class="fas fa-triangle-exclamation"></i> หมดอายุ (${escapeHtml(d.expiry_date)})</span>`;
            } else if (isExpiringSoon) {
                expiryBadge = `<span class="badge badge-warning" style="font-weight: 700; padding: 0.25rem 0.55rem; font-size: 0.775rem; background: #FEF3C7; color: #D97706; border: 1px solid #FDE68A;" title="ใกล้หมดอายุใน 60 วัน"><i class="fas fa-hourglass-half"></i> อีก ${d.days_left} วัน (${escapeHtml(d.expiry_date)})</span>`;
            } else if (d.expiry_date) {
                expiryBadge = `<span style="font-size: 0.85rem; color: var(--text-secondary);"><i class="far fa-calendar-check" style="color: var(--text-muted); margin-right: 4px;"></i>${escapeHtml(d.expiry_date)}</span>`;
            }

            const thumbHtml = d.image_url
                ? `<div class="drug-table-thumb" onclick="openImageLightbox('${escapeHtml(d.image_url)}', '${escapeHtml(d.name)}', '${escapeHtml(d.code)}')" title="คลิกดูภาพขยาย" style="width: 42px; height: 42px; min-width: 42px; max-width: 42px; min-height: 42px; max-height: 42px; border-radius: 8px; overflow: hidden; display: inline-flex; align-items: center; justify-content: center; background: var(--bg-subtle); border: 1px solid var(--border-default); cursor: pointer; margin: 0 auto;">
                     <img src="${escapeHtml(d.image_url)}" alt="${escapeHtml(d.name)}" loading="lazy" style="width: 42px; height: 42px; max-width: 42px; max-height: 42px; object-fit: cover; display: block; border-radius: 7px;" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'drug-table-thumb-fallback\\' style=\\'width:42px;height:42px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;background:var(--bg-subtle);border:1px solid var(--border-subtle);color:var(--text-subtle);\\'><i class=\\'fas fa-pills\\'></i></div>';">
                   </div>`
                : `<div class="drug-table-thumb-fallback" title="ยังไม่มีภาพยา" style="width: 42px; height: 42px; min-width: 42px; max-width: 42px; min-height: 42px; max-height: 42px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; background: var(--bg-subtle); border: 1px solid var(--border-subtle); color: var(--text-subtle); margin: 0 auto;">
                     <i class="fas fa-pills"></i>
                   </div>`;

            return `
                <tr ${rowClass}>
                    <td class="col-thumb" style="width: 56px; min-width: 56px; max-width: 56px; text-align: center; vertical-align: middle; padding: 6px 4px; box-sizing: border-box;">
                        ${thumbHtml}
                    </td>
                    <td>
                        <span class="code-pill">${escapeHtml(d.code)}</span>
                    </td>
                    <td>
                        <div style="font-weight: 600; color: var(--text-primary); font-size: 0.95rem; line-height: 1.4;">${escapeHtml(d.name)}</div>
                        ${d.generic_name ? `<div style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.35; margin-top: 0.2rem;">${escapeHtml(d.generic_name)}</div>` : ''}
                    </td>
                    <td>
                        <span class="badge badge-teal">${escapeHtml(d.category)}</span>
                    </td>
                    <td>
                        ${stockBadge}
                    </td>
                    <td>
                        ${expiryBadge}
                    </td>
                    <td>
                        <span style="font-size: 0.85rem; color: var(--text-muted);">${escapeHtml(d.location || '-')}</span>
                    </td>
                    <td style="text-align: right;">
                        <div style="display: inline-flex; gap: 0.4rem; align-items: center;">
                            <button class="btn btn-outline" title="รับยาเข้าสต็อก (Stock In)" onclick="openStockInModal(${d.id})" style="height: 34px; padding: 0 0.55rem; font-size: 0.8rem; border-radius: 6px; color: #059669; border-color: #6ee7b7; font-weight: 600;">
                                <i class="fas fa-plus"></i> รับเข้า
                            </button>
                            <button class="btn-dispense-action" title="ตัดจ่ายยานี้" onclick="openDispenseModalForDrug(${d.id})">
                                <i class="fas fa-minus-circle"></i> ตัดสต็อก
                            </button>
                            <button class="btn btn-outline btn-icon" title="พิมพ์ QR Code" onclick="openQrModal(${d.id})" style="height: 34px; width: 34px; font-size: 0.85rem; border-radius: 6px;">
                                <i class="fas fa-qrcode"></i>
                            </button>
                            <button class="btn btn-outline btn-icon" title="แก้ไขข้อมูลยา" onclick="openEditDrugModal(${d.id})" style="height: 34px; width: 34px; font-size: 0.85rem; border-radius: 6px;">
                                <i class="fas fa-pen"></i>
                            </button>
                            <button class="btn btn-outline btn-icon" title="ลบยา" onclick="confirmDeleteDrug(${d.id})" style="height: 34px; width: 34px; font-size: 0.85rem; border-radius: 6px; color: var(--text-subtle);">
                                <i class="fas fa-trash-can"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    if (cardsContainer) {
        cardsContainer.innerHTML = drugs.map(d => {
            const isLow = d.stock_qty <= d.min_threshold;
            const isExpiringSoon = d.is_expiring_soon || (d.days_left !== null && d.days_left !== undefined && d.days_left <= 60);
            const isExpired = d.is_expired;

            let cardBorder = '';
            if (isExpired) {
                cardBorder = 'border-color: #FDA4AF; background: linear-gradient(135deg, var(--bg-surface) 0%, rgba(239, 68, 68, 0.06) 100%);';
            } else if (isLow) {
                cardBorder = 'border-color: #FDA4AF; background: linear-gradient(135deg, var(--bg-surface) 0%, rgba(225, 29, 72, 0.04) 100%);';
            } else if (isExpiringSoon) {
                cardBorder = 'border-color: #FDE68A; background: linear-gradient(135deg, var(--bg-surface) 0%, rgba(245, 158, 11, 0.04) 100%);';
            }

            const stockBadge = isLow
                ? `<span class="badge badge-danger" style="font-weight: 600; padding: 0.3rem 0.65rem; font-size: 0.775rem;"><i class="fas fa-triangle-exclamation"></i> ใกล้หมด (${d.stock_qty} ${d.unit})</span>`
                : `<span class="badge badge-success" style="font-weight: 600; padding: 0.3rem 0.65rem; font-size: 0.775rem;"><i class="fas fa-circle-check"></i> ${d.stock_qty} ${d.unit}</span>`;

            let expiryTag = '';
            if (isExpired) {
                expiryTag = `<div style="margin-top: 0.35rem;"><span class="badge badge-danger" style="font-size: 0.725rem;"><i class="fas fa-triangle-exclamation"></i> หมดอายุแล้ว (${escapeHtml(d.expiry_date)})</span></div>`;
            } else if (isExpiringSoon) {
                expiryTag = `<div style="margin-top: 0.35rem;"><span class="badge badge-warning" style="font-size: 0.725rem; background: #FEF3C7; color: #D97706; border: 1px solid #FDE68A;"><i class="fas fa-hourglass-half"></i> ใกล้หมดอายุ: อีก ${d.days_left} วัน (${escapeHtml(d.expiry_date)})</span></div>`;
            } else if (d.expiry_date) {
                expiryTag = `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.3rem;"><i class="far fa-calendar"></i> วันหมดอายุ: ${escapeHtml(d.expiry_date)}</div>`;
            }

            const mobileThumbHtml = d.image_url
                ? `<div class="drug-card-thumb" onclick="openImageLightbox('${escapeHtml(d.image_url)}', '${escapeHtml(d.name)}', '${escapeHtml(d.code)}')" title="คลิกดูภาพขยาย" style="width: 44px; height: 44px; min-width: 44px; max-width: 44px; min-height: 44px; max-height: 44px; border-radius: 8px; overflow: hidden; display: flex; align-items: center; justify-content: center; background: var(--bg-subtle); border: 1px solid var(--border-default); cursor: pointer; flex-shrink: 0;">
                     <img src="${escapeHtml(d.image_url)}" alt="${escapeHtml(d.name)}" loading="lazy" style="width: 44px; height: 44px; max-width: 44px; max-height: 44px; object-fit: cover; display: block; border-radius: 7px;" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'drug-card-thumb-fallback\\' style=\\'width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:var(--bg-subtle);border:1px solid var(--border-subtle);color:var(--text-subtle);\\'><i class=\\'fas fa-pills\\'></i></div>';">
                   </div>`
                : `<div class="drug-card-thumb-fallback" title="ยังไม่มีภาพยา" style="width: 44px; height: 44px; min-width: 44px; max-width: 44px; min-height: 44px; max-height: 44px; border-radius: 8px; display: flex; align-items: center; justify-content: center; background: var(--bg-subtle); border: 1px solid var(--border-subtle); color: var(--text-subtle); flex-shrink: 0;">
                     <i class="fas fa-pills"></i>
                   </div>`;

            return `
                <div class="drug-mobile-card" style="${cardBorder}">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                        <span class="code-pill" style="font-size: 0.75rem;">${escapeHtml(d.code)}</span>
                        ${stockBadge}
                    </div>

                    <div style="display: flex; gap: 0.75rem; align-items: flex-start; margin-bottom: 0.65rem;">
                        ${mobileThumbHtml}
                        <div style="flex: 1; min-width: 0;">
                            <div style="font-weight: 700; font-size: 1.05rem; line-height: 1.4; color: var(--text-primary);">${escapeHtml(d.name)}</div>
                            ${d.generic_name ? `<div style="font-size: 0.8125rem; color: var(--text-muted); line-height: 1.35; margin-top: 0.2rem;">${escapeHtml(d.generic_name)}</div>` : ''}
                            ${expiryTag}
                        </div>
                    </div>
                    
                    <div style="display: flex; gap: 0.45rem; align-items: center; margin-bottom: 0.85rem; flex-wrap: wrap;">
                        <span class="badge badge-teal" style="font-size: 0.75rem; padding: 0.25rem 0.6rem;">${escapeHtml(d.category)}</span>
                        <span style="font-size: 0.775rem; color: var(--text-secondary); background: var(--bg-subtle); padding: 0.25rem 0.55rem; border-radius: 6px; border: 1px solid var(--border-subtle);">${escapeHtml(d.dosage_form || 'เม็ด')}</span>
                        ${d.location ? `<span style="font-size: 0.775rem; color: var(--text-secondary); background: var(--bg-subtle); padding: 0.25rem 0.55rem; border-radius: 6px; border: 1px solid var(--border-subtle);"><i class="fas fa-location-dot" style="color: var(--text-muted); margin-right: 0.2rem;"></i> ${escapeHtml(d.location)}</span>` : ''}
                        ${d.price ? `<span style="font-size: 0.8125rem; color: var(--brand-600); font-weight: 700; margin-left: auto;">฿${d.price} / ${escapeHtml(d.unit)}</span>` : ''}
                    </div>

                    <div style="display: flex; gap: 0.45rem; padding-top: 0.75rem; border-top: 1px solid var(--border-subtle); align-items: center;">
                        <button class="btn btn-outline" title="รับเข้า" onclick="openStockInModal(${d.id})" style="height: 38px; padding: 0 0.65rem; font-size: 0.8rem; border-radius: 8px; color: #059669; border-color: #6ee7b7; font-weight: 600;">
                            <i class="fas fa-plus"></i> รับเข้า
                        </button>
                        <button class="btn-dispense-action" onclick="openDispenseModalForDrug(${d.id})" style="flex: 1; height: 38px; justify-content: center; font-size: 0.875rem; border-radius: 8px;">
                            <i class="fas fa-minus-circle"></i> ตัดสต็อก
                        </button>
                        <button class="btn btn-outline btn-icon" title="QR Code" onclick="openQrModal(${d.id})" style="height: 38px; width: 38px; border-radius: 8px;">
                            <i class="fas fa-qrcode"></i>
                        </button>
                        <button class="btn btn-outline btn-icon" title="แก้ไข" onclick="openEditDrugModal(${d.id})" style="height: 38px; width: 38px; border-radius: 8px;">
                            <i class="fas fa-pen"></i>
                        </button>
                        <button class="btn btn-outline btn-icon" title="ลบ" onclick="confirmDeleteDrug(${d.id})" style="height: 38px; width: 38px; border-radius: 8px; color: var(--text-subtle);">
                            <i class="fas fa-trash-can"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }
}

// ─────────────────────────────────────────────────────────────
// 📸 Drug Image Handling & Lightbox
// ─────────────────────────────────────────────────────────────

async function handleDrugImageFileSelect(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showToast('กรุณาเลือกไฟล์รูปภาพ (JPG, PNG, WEBP)', 'warning');
        return;
    }

    if (file.size > 8 * 1024 * 1024) {
        showToast('ขนาดไฟล์ภาพต้องไม่เกิน 8 MB', 'warning');
        return;
    }

    // Instant local preview
    const previewEl = document.getElementById('drugImagePreview');
    const placeholderEl = document.getElementById('drugImagePlaceholder');
    const removeBtn = document.getElementById('removeDrugImageBtn');
    const statusEl = document.getElementById('drugImageUploadStatus');

    if (previewEl) {
        previewEl.src = URL.createObjectURL(file);
        previewEl.style.display = 'block';
    }
    if (placeholderEl) placeholderEl.style.display = 'none';
    if (statusEl) statusEl.innerHTML = '<span style="color: var(--brand-600);"><i class="fas fa-spinner fa-spin"></i> กำลังอัปโหลดรูปภาพ...</span>';

    // Upload to server
    const formData = new FormData();
    formData.append('image', file);

    try {
        const res = await fetch('/api/upload/drug-image', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (data.ok && data.image_url) {
            const urlInput = document.getElementById('drugImageUrlInput');
            if (urlInput) urlInput.value = data.image_url;
            if (removeBtn) removeBtn.style.display = 'inline-flex';
            if (statusEl) statusEl.innerHTML = '<span style="color: #059669;"><i class="fas fa-check-circle"></i> อัปโหลดรูปภาพสำเร็จ</span>';
        } else {
            if (statusEl) statusEl.innerHTML = `<span style="color: #EF4444;"><i class="fas fa-circle-exclamation"></i> อัปโหลดไม่สำเร็จ: ${escapeHtml(data.error || 'ผิดพลาด')}</span>`;
        }
    } catch (err) {
        console.error('Image upload failed:', err);
        if (statusEl) statusEl.innerHTML = '<span style="color: #EF4444;"><i class="fas fa-circle-exclamation"></i> เกิดข้อผิดพลาดในการเชื่อมต่อ</span>';
    }
}

function removeDrugImage(silent = false) {
    const urlInput = document.getElementById('drugImageUrlInput');
    const fileInput = document.getElementById('drugImageFileInput');
    const previewEl = document.getElementById('drugImagePreview');
    const placeholderEl = document.getElementById('drugImagePlaceholder');
    const removeBtn = document.getElementById('removeDrugImageBtn');
    const statusEl = document.getElementById('drugImageUploadStatus');

    if (urlInput) urlInput.value = '';
    if (fileInput) fileInput.value = '';
    if (previewEl) {
        previewEl.src = '';
        previewEl.style.display = 'none';
    }
    if (placeholderEl) placeholderEl.style.display = 'flex';
    if (removeBtn) removeBtn.style.display = 'none';
    if (statusEl) {
        statusEl.innerText = silent ? 'รองรับ JPG, PNG, WEBP (คลิกเพื่อเลือกไฟล์หรือถ่ายภาพ)' : 'นำรูปภาพออกแล้ว';
    }
}

function openImageLightbox(url, name, code) {
    if (!url) return;
    const modal = document.getElementById('imageLightboxModal');
    const img = document.getElementById('lightboxImg');
    const nameEl = document.getElementById('lightboxDrugName');
    const codeEl = document.getElementById('lightboxDrugCode');

    if (img) img.src = url;
    if (nameEl) nameEl.innerText = name || 'รูปภาพยา';
    if (codeEl) codeEl.innerText = code ? `รหัส: ${code}` : '';
    if (modal) modal.classList.add('active');
}

function closeImageLightbox(e) {
    if (e && e.target && e.target.id !== 'imageLightboxModal' && !e.target.closest('button')) {
        return;
    }
    const modal = document.getElementById('imageLightboxModal');
    if (modal) modal.classList.remove('active');
}

// ─────────────────────────────────────────────────────────────
// Modal Operations (Add / Edit Drug)
// ─────────────────────────────────────────────────────────────

function openAddDrugModal() {
    const titleEl = document.getElementById('drugModalTitle');
    if (titleEl) titleEl.innerText = '➕ เพิ่มยาใหม่เข้าคลัง';
    const form = document.getElementById('drugForm');
    if (form) form.reset();
    const formId = document.getElementById('drugFormId');
    if (formId) formId.value = '';
    removeDrugImage(true);
    const modal = document.getElementById('drugModal');
    if (modal) modal.classList.add('active');
}

function openEditDrugModal(id) {
    const numId = Number(id);
    const drug = allDrugs.find(d => Number(d.id) === numId || d.id == id);
    if (!drug) {
        console.warn('Drug not found for id:', id, allDrugs);
        showToast('ไม่พบข้อมูลยานี้ในระบบ', 'warning');
        return;
    }

    const setVal = (elId, val) => {
        const el = document.getElementById(elId);
        if (el) el.value = val ?? '';
    };

    const titleEl = document.getElementById('drugModalTitle');
    if (titleEl) titleEl.innerText = '✏️ แก้ไขข้อมูลยา';

    setVal('drugFormId', drug.id);
    setVal('drugCodeInput', drug.code || '');
    setVal('drugNameInput', drug.name || '');
    setVal('drugGenericInput', drug.generic_name || '');
    setVal('drugCategoryInput', drug.category || 'ทั่วไป');
    setVal('drugDosageInput', drug.dosage_form || 'เม็ด (Tablet)');
    setVal('drugStrengthInput', drug.strength || '');
    setVal('drugStockInput', drug.stock_qty || 0);
    setVal('drugUnitInput', drug.unit || 'เม็ด');
    setVal('drugMinInput', drug.min_threshold || 10);
    setVal('drugPriceInput', drug.price || 0);
    setVal('drugCostInput', drug.cost || 0);
    setVal('drugExpiryInput', drug.expiry_date || '');
    setVal('drugLocationInput', drug.location || '');
    setVal('drugInstructionsInput', drug.instructions || '');

    // Image Setup
    const imgUrlInput = document.getElementById('drugImageUrlInput');
    const imgPreview = document.getElementById('drugImagePreview');
    const imgPlaceholder = document.getElementById('drugImagePlaceholder');
    const removeBtn = document.getElementById('removeDrugImageBtn');
    const statusEl = document.getElementById('drugImageUploadStatus');

    if (drug.image_url) {
        if (imgUrlInput) imgUrlInput.value = drug.image_url;
        if (imgPreview) {
            imgPreview.src = drug.image_url;
            imgPreview.style.display = 'block';
        }
        if (imgPlaceholder) imgPlaceholder.style.display = 'none';
        if (removeBtn) removeBtn.style.display = 'inline-flex';
        if (statusEl) statusEl.innerHTML = '<span style="color: #059669;"><i class="fas fa-check"></i> บันทึกรูปภาพไว้แล้ว (คลิกรูปเพื่อเปลี่ยน)</span>';
    } else {
        removeDrugImage(true);
    }

    const modal = document.getElementById('drugModal');
    if (modal) {
        modal.classList.add('active');
    }
}

function closeDrugModal() {
    const modal = document.getElementById('drugModal');
    if (modal) modal.classList.remove('active');
}

async function saveDrug(e) {
    e.preventDefault();
    const id = document.getElementById('drugFormId')?.value;
    const isEdit = Boolean(id);

    const getVal = (elId, defaultVal = '') => {
        const el = document.getElementById(elId);
        return el ? el.value.trim() : defaultVal;
    };

    const payload = {
        code: getVal('drugCodeInput'),
        name: getVal('drugNameInput'),
        generic_name: getVal('drugGenericInput'),
        image_url: getVal('drugImageUrlInput'),
        category: getVal('drugCategoryInput', 'ทั่วไป'),
        dosage_form: getVal('drugDosageInput', 'เม็ด (Tablet)'),
        strength: getVal('drugStrengthInput'),
        stock_qty: parseInt(getVal('drugStockInput', '0')) || 0,
        unit: getVal('drugUnitInput', 'เม็ด'),
        min_threshold: parseInt(getVal('drugMinInput', '10')) || 10,
        price: parseFloat(getVal('drugPriceInput', '0')) || 0,
        cost: parseFloat(getVal('drugCostInput', '0')) || 0,
        expiry_date: getVal('drugExpiryInput'),
        location: getVal('drugLocationInput'),
        instructions: getVal('drugInstructionsInput')
    };

    if (!payload.name) {
        alert('กรุณากรอกชื่อยา');
        return;
    }

    try {
        const url = isEdit ? `/api/drugs/${id}` : '/api/drugs';
        const method = isEdit ? 'PUT' : 'POST';
        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.ok) {
            closeDrugModal();
            loadDrugs();
            loadDashboardStats();
            showToast(isEdit ? 'แก้ไขข้อมูลยาและรูปภาพสำเร็จ' : 'เพิ่มยาใหม่และบันทึกรูปภาพเรียบร้อย!', 'success');
        } else {
            alert('เกิดข้อผิดพลาด: ' + (data.error || 'Unknown error'));
        }
    } catch (e) {
        console.error('Save drug error:', e);
        alert('ไม่สามารถบันทึกข้อมูลได้');
    }
}

async function confirmDeleteDrug(id) {
    const numId = Number(id);
    const drug = allDrugs.find(d => Number(d.id) === numId || d.id == id);
    const name = drug ? drug.name : 'ยานี้';
    if (!confirm(`คุณต้องการลบยา '${name}' ออกจากคลังยาใช่หรือไม่?\n(ระบบจะอัปเดตลง Google Sheet อัตโนมัติ)`)) {
        return;
    }
    try {
        const res = await fetch(`/api/drugs/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.ok) {
            loadDrugs();
            loadDashboardStats();
            showToast(`ลบยา '${name}' เรียบร้อยแล้ว`, 'info');
        }
    } catch (e) {
        console.error('Delete error:', e);
    }
}

// ─────────────────────────────────────────────────────────────
// Stock Dispensing Modal (Stock Deduction)
// ─────────────────────────────────────────────────────────────

let currentDispenseChannel = 'WEB_MANUAL';

function openDispenseModalForDrug(drugOrId, channel = 'WEB_MANUAL') {
    let drug = null;
    if (typeof drugOrId === 'object' && drugOrId !== null) {
        drug = drugOrId;
    } else {
        const numId = Number(drugOrId);
        drug = allDrugs.find(d => Number(d.id) === numId || d.id == drugOrId);
    }
    if (!drug) return;

    currentDispenseChannel = channel || 'WEB_MANUAL';
    selectedDrugForDispense = drug;
    document.getElementById('dispenseDrugName').innerText = drug.name;
    document.getElementById('dispenseDrugCode').innerText = `รหัส: ${drug.code} • คงเหลือ: ${drug.stock_qty} ${drug.unit}`;
    document.getElementById('dispenseQtyInput').value = 1;
    document.getElementById('dispenseQtyInput').max = drug.stock_qty;
    document.getElementById('dispenseUnitLabel').innerText = drug.unit;
    document.getElementById('dispensePatientInput').value = '';
    document.getElementById('dispenseNoteInput').value = '';

    // Show image or fallback icon
    const imgEl = document.getElementById('dispenseDrugImg');
    const iconEl = document.getElementById('dispenseDrugIcon');
    if (drug.image_url) {
        if (imgEl) {
            imgEl.src = drug.image_url;
            imgEl.style.display = 'block';
        }
        if (iconEl) iconEl.style.display = 'none';
    } else {
        if (imgEl) {
            imgEl.src = '';
            imgEl.style.display = 'none';
        }
        if (iconEl) iconEl.style.display = 'block';
    }

    document.getElementById('dispenseModal').classList.add('active');
}

function closeDispenseModal() {
    document.getElementById('dispenseModal').classList.remove('active');
    selectedDrugForDispense = null;
    currentDispenseChannel = 'WEB_MANUAL';
}

async function submitDispense(e) {
    e.preventDefault();
    if (!selectedDrugForDispense) return;

    const qty = parseInt(document.getElementById('dispenseQtyInput').value) || 1;
    const patient = document.getElementById('dispensePatientInput').value.trim();
    const notes = document.getElementById('dispenseNoteInput').value.trim();
    const dispenser = document.getElementById('dispenserNameInput')?.value || 'เภสัชกร/เจ้าหน้าที่';

    try {
        const res = await fetch('/api/dispense', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                drug_id: selectedDrugForDispense.id,
                quantity: qty,
                channel: currentDispenseChannel || 'WEB_MANUAL',
                dispensed_by: dispenser,
                patient_name: patient,
                notes: notes
            })
        });
        const data = await res.json();
        if (data.ok) {
            closeDispenseModal();
            loadDrugs();
            loadDashboardStats();
            loadDispensingLogs();
            showToast(`✅ ${data.message}`, 'success');
        } else {
            alert('ไม่สามารถตัดสต็อกได้: ' + (data.error || 'Unknown error'));
        }
    } catch (e) {
        console.error('Dispense error:', e);
        alert('เกิดข้อผิดพลาดในการตัดสต็อก');
    }
}

// ─────────────────────────────────────────────────────────────
// Dispensing Logs (Audit History)
// ─────────────────────────────────────────────────────────────

async function loadDispensingLogs() {
    const date = document.getElementById('logDateFilter')?.value || '';
    const channel = document.getElementById('logChannelFilter')?.value || 'all';

    const url = `/api/dispense/logs?date=${encodeURIComponent(date)}&channel=${encodeURIComponent(channel)}`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        if (data.ok) {
            renderLogsTable(data.logs);
        }
    } catch (e) {
        console.error('Error loading logs:', e);
    }
}

function renderLogsTable(logs) {
    const tbody = document.getElementById('logsTableBody');
    const cardsContainer = document.getElementById('logsMobileCards');

    if (!logs || logs.length === 0) {
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 3rem; color: var(--text-muted);">
                        <i class="fas fa-clipboard-list" style="font-size: 2.5rem; color: var(--text-subtle); margin-bottom: 0.75rem; display: block;"></i>
                        ยังไม่มีประวัติการตัดสต็อกในเงื่อนไขที่เลือก
                    </td>
                </tr>
            `;
        }
        if (cardsContainer) {
            cardsContainer.innerHTML = `
                <div style="text-align: center; padding: 2.5rem 1rem; color: var(--text-muted); background: var(--bg-surface); border-radius: 18px; border: 1px dashed var(--border-color);">
                    <i class="fas fa-clipboard-list" style="font-size: 2.5rem; color: var(--text-subtle); margin-bottom: 0.75rem; display: block;"></i>
                    ยังไม่มีประวัติการตัดสต็อก
                </div>
            `;
        }
        return;
    }

    if (tbody) {
        tbody.innerHTML = logs.map(l => {
            let channelBadge = '<span class="badge badge-teal">Web Counter</span>';
            if (l.channel.includes('LINE')) {
                channelBadge = '<span class="badge badge-success"><i class="fab fa-line"></i> LINE Bot</span>';
            } else if (l.channel.includes('QR')) {
                channelBadge = '<span class="badge badge-warning"><i class="fas fa-barcode"></i> Scanner</span>';
            }

            const driveBtn = l.drive_file_link
                ? `<a href="${l.drive_file_link}" target="_blank" class="btn btn-outline" style="padding: 0.2rem 0.55rem; font-size: 0.725rem; height: 26px; color: var(--brand-600);"><i class="fab fa-google-drive"></i> ดูรูปสลิป</a>`
                : '<span style="color: var(--text-subtle); font-size: 0.75rem;">-</span>';

            const drugImg = l.image_url || (typeof allDrugs !== 'undefined' && allDrugs.find(d => Number(d.id) === Number(l.drug_id) || (d.code && l.drug_code && d.code.trim().toUpperCase() === l.drug_code.trim().toUpperCase()))?.image_url);
            const thumbHtml = drugImg
                ? `<div class="drug-table-thumb" onclick="openImageLightbox('${escapeHtml(drugImg)}', '${escapeHtml(l.drug_name)}', '${escapeHtml(l.drug_code || '')}')" title="คลิกดูภาพขยาย">
                     <img src="${escapeHtml(drugImg)}" alt="${escapeHtml(l.drug_name)}" loading="lazy" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'drug-table-thumb-fallback\\'><i class=\\'fas fa-pills\\'></i></div>';">
                   </div>`
                : `<div class="drug-table-thumb-fallback" title="ยังไม่มีภาพยา"><i class="fas fa-pills"></i></div>`;

            return `
                <tr>
                    <td class="col-thumb">
                        ${thumbHtml}
                    </td>
                    <td class="col-datetime">
                        <i class="far fa-clock" style="color: var(--text-muted); margin-right: 6px;"></i>${escapeHtml(l.created_at || '-')}
                    </td>
                    <td>
                        <div style="font-weight: 700; color: var(--text-primary); font-size: 0.925rem; line-height: 1.35;">${escapeHtml(l.drug_name)}</div>
                        <div style="display: flex; gap: 0.35rem; align-items: center; margin-top: 3px; flex-wrap: wrap;">
                            ${l.drug_code ? `<span class="code-pill">${escapeHtml(l.drug_code)}</span>` : ''}
                            ${l.generic_name ? `<span style="font-size: 0.775rem; color: var(--text-muted);">(${escapeHtml(l.generic_name)})</span>` : ''}
                        </div>
                    </td>
                    <td>
                        <span style="font-weight: 700; color: var(--rose-600); font-family: var(--font-mono); font-size: 0.875rem; background: var(--rose-50); border: 1px solid var(--rose-100); padding: 0.2rem 0.55rem; border-radius: 6px;">-${l.quantity}</span>
                    </td>
                    <td style="font-size: 0.85rem; color: var(--text-secondary); white-space: nowrap;">
                        ${l.balance_before} <i class="fas fa-arrow-right" style="font-size: 0.7rem; color: var(--text-muted); margin: 0 3px;"></i> <strong style="color: var(--emerald-600); font-family: var(--font-mono); font-weight: 700;">${l.balance_after}</strong>
                    </td>
                    <td>${channelBadge}</td>
                    <td>
                        <span style="font-size: 0.8125rem; color: var(--text-secondary); font-weight: 600;">${escapeHtml(l.dispensed_by || '-')}</span>
                        ${l.patient_name ? `<div style="font-size: 0.725rem; color: var(--text-muted); margin-top: 2px;"><i class="fas fa-user" style="font-size: 0.65rem; color: var(--brand-500);"></i> ${escapeHtml(l.patient_name)}</div>` : ''}
                        ${l.notes ? `<div style="font-size: 0.725rem; color: var(--text-muted); margin-top: 2px;"><i class="fas fa-note-sticky" style="font-size: 0.65rem;"></i> ${escapeHtml(l.notes)}</div>` : ''}
                    </td>
                    <td style="text-align: right;">${driveBtn}</td>
                </tr>
            `;
        }).join('');
    }

    if (cardsContainer) {
        cardsContainer.innerHTML = logs.map(l => {
            let channelBadge = '<span class="badge badge-teal" style="font-size: 0.7rem;">Web</span>';
            if (l.channel.includes('LINE')) {
                channelBadge = '<span class="badge badge-success" style="font-size: 0.7rem;"><i class="fab fa-line"></i> LINE</span>';
            } else if (l.channel.includes('QR')) {
                channelBadge = '<span class="badge badge-warning" style="font-size: 0.7rem;"><i class="fas fa-barcode"></i> Barcode</span>';
            }

            const driveBtn = l.drive_file_link
                ? `<a href="${l.drive_file_link}" target="_blank" class="btn btn-outline" style="padding: 0.15rem 0.45rem; font-size: 0.7rem; height: 26px; color: var(--brand-600);"><i class="fab fa-google-drive"></i> รูป</a>`
                : '';

            const drugImg = l.image_url || (typeof allDrugs !== 'undefined' && allDrugs.find(d => Number(d.id) === Number(l.drug_id) || (d.code && l.drug_code && d.code.trim().toUpperCase() === l.drug_code.trim().toUpperCase()))?.image_url);
            const mobileThumbHtml = drugImg
                ? `<div class="drug-card-thumb" onclick="openImageLightbox('${escapeHtml(drugImg)}', '${escapeHtml(l.drug_name)}', '${escapeHtml(l.drug_code || '')}')" title="คลิกดูภาพขยาย" style="width: 44px; height: 44px; min-width: 44px; max-width: 44px; min-height: 44px; max-height: 44px; border-radius: 8px; overflow: hidden; display: flex; align-items: center; justify-content: center; background: var(--bg-subtle); border: 1px solid var(--border-default); cursor: pointer; flex-shrink: 0;">
                     <img src="${escapeHtml(drugImg)}" alt="${escapeHtml(l.drug_name)}" loading="lazy" style="width: 44px; height: 44px; object-fit: cover; border-radius: 7px;" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'drug-card-thumb-fallback\\' style=\\'width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:var(--bg-subtle);border:1px solid var(--border-subtle);color:var(--text-subtle);\\'><i class=\\'fas fa-pills\\'></i></div>';">
                   </div>`
                : `<div class="drug-card-thumb-fallback" title="ยังไม่มีภาพยา" style="width: 44px; height: 44px; min-width: 44px; max-width: 44px; min-height: 44px; max-height: 44px; border-radius: 8px; display: flex; align-items: center; justify-content: center; background: var(--bg-subtle); border: 1px solid var(--border-subtle); color: var(--text-subtle); flex-shrink: 0;">
                     <i class="fas fa-pills"></i>
                   </div>`;

            return `
                <div class="log-mobile-card">
                    <div style="display: flex; gap: 0.75rem; align-items: flex-start; margin-bottom: 0.5rem;">
                        ${mobileThumbHtml}
                        <div style="flex: 1; min-width: 0;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
                                <span class="code-pill">${escapeHtml(l.drug_code || '')}</span>
                                <span style="font-weight: 700; color: var(--rose-600); font-family: var(--font-mono); font-size: 0.95rem; background: var(--rose-50); border: 1px solid var(--rose-100); padding: 0.2rem 0.55rem; border-radius: 6px;">-${l.quantity}</span>
                            </div>
                            <div style="font-weight: 700; font-size: 1rem; color: var(--text-primary); line-height: 1.35;">${escapeHtml(l.drug_name)}</div>
                            ${l.generic_name ? `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">${escapeHtml(l.generic_name)}</div>` : ''}
                        </div>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8125rem; color: var(--text-secondary); margin-top: 0.65rem; padding-top: 0.65rem; border-top: 1px solid var(--border-subtle); flex-wrap: wrap; gap: 0.5rem;">
                        <div>
                            <span>คงเหลือ: ${l.balance_before} ➔ </span><strong style="color: var(--emerald-600); font-family: var(--font-mono); font-weight: 700;">${l.balance_after}</strong>
                        </div>
                        <div style="display: flex; gap: 0.4rem; align-items: center;">
                            ${channelBadge}
                            ${driveBtn}
                        </div>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-muted); margin-top: 0.4rem; padding-top: 0.35rem; border-top: 1px dashed var(--border-subtle);">
                        <span><i class="fas fa-user-check"></i> ${escapeHtml(l.dispensed_by || '-')}</span>
                        <span><i class="far fa-clock"></i> ${escapeHtml(l.created_at)}</span>
                    </div>
                </div>
            `;
        }).join('');
    }
}

// ─────────────────────────────────────────────────────────────
// QR Code Generator Modal
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Advanced QR/Barcode Sticker Label Printer (Batch & Grid Layout)
// ─────────────────────────────────────────────────────────────

let currentLabelDrug = null;

function populateLabelDrugDropdown(selectedId = null) {
    const select = document.getElementById('labelDrugSelect');
    if (!select) return;
    
    select.innerHTML = allDrugs.map(d => `
        <option value="${d.id}" ${selectedId && Number(selectedId) === d.id ? 'selected' : ''}>
            ${escapeHtml(d.name)} (${escapeHtml(d.code)}) — คงเหลือ: ${d.stock_qty} ${escapeHtml(d.unit || 'หน่วย')}
        </option>
    `).join('');
}

function openQrModal(id) {
    const drug = allDrugs.find(d => d.id === id) || allDrugs[0];
    if (!drug) return;

    currentLabelDrug = drug;
    populateLabelDrugDropdown(drug.id);
    
    // Set default preset and recommended count
    const presetSelect = document.getElementById('labelLayoutPreset');
    if (presetSelect) presetSelect.value = 'a4-standard';
    
    const countInput = document.getElementById('labelPrintCount');
    if (countInput) countInput.value = '24';

    document.getElementById('qrModal').classList.add('active');
    updateLabelPreview();
}

function openBatchPrintModal() {
    if (!allDrugs || allDrugs.length === 0) {
        showToast('ไม่พบรายการยาในคลัง', 'error');
        return;
    }
    const defaultDrug = currentLabelDrug || allDrugs[0];
    openQrModal(defaultDrug.id);
}

function closeQrModal() {
    const modal = document.getElementById('qrModal');
    if (modal) modal.classList.remove('active');
}

function onLabelDrugChange() {
    const select = document.getElementById('labelDrugSelect');
    if (!select) return;
    const drugId = Number(select.value);
    const drug = allDrugs.find(d => d.id === drugId);
    if (drug) {
        currentLabelDrug = drug;
        updateLabelPreview();
    }
}

function generateQrDataUrl(text, size = 120) {
    return new Promise((resolve) => {
        const tempDiv = document.createElement('div');
        tempDiv.style.display = 'none';
        document.body.appendChild(tempDiv);
        
        new QRCode(tempDiv, {
            text: text,
            width: size,
            height: size,
            colorDark: "#000000",
            colorLight: "#FFFFFF",
            correctLevel: QRCode.CorrectLevel.M
        });

        // QRCode library needs a brief moment to render to canvas/img
        setTimeout(() => {
            const canvas = tempDiv.querySelector('canvas');
            const img = tempDiv.querySelector('img');
            let dataUrl = '';
            if (canvas) {
                dataUrl = canvas.toDataURL('image/png');
            } else if (img && img.src) {
                dataUrl = img.src;
            }
            document.body.removeChild(tempDiv);
            resolve(dataUrl);
        }, 50);
    });
}

function updateLabelPresetChange() {
    const preset = document.getElementById('labelLayoutPreset')?.value || 'a4-standard';
    const countInput = document.getElementById('labelPrintCount');
    const customBox = document.getElementById('customDimensionBox');

    // Toggle custom dimension input box
    if (customBox) {
        customBox.style.display = (preset === 'custom') ? 'block' : 'none';
    }
    
    // Auto adjust count to match standard sheet capacity
    if (countInput) {
        if (preset === 'a4-micro') countInput.value = '96';
        else if (preset === 'a4-mini') countInput.value = '65';
        else if (preset === 'a4-compact') countInput.value = '40';
        else if (preset === 'a4-standard') countInput.value = '24';
        else if (preset === 'a4-large') countInput.value = '12';
        else if (preset.startsWith('thermal')) countInput.value = '10';
        else if (preset === 'single-label') countInput.value = '1';
        else if (preset === 'custom') countInput.value = '24';
    }
    updateLabelPreview();
}

async function updateLabelPreview() {
    if (!currentLabelDrug) return;

    const drug = currentLabelDrug;
    const preset = document.getElementById('labelLayoutPreset')?.value || 'a4-standard';
    let count = parseInt(document.getElementById('labelPrintCount')?.value || 24, 10);
    if (isNaN(count) || count < 1) count = 1;

    const gridColsOpt = document.getElementById('labelGridCols')?.value || 'auto';
    const showTradeName = document.getElementById('showOptTradeName')?.checked;
    const showCode = document.getElementById('showOptCode')?.checked;
    const showExpiry = document.getElementById('showOptExpiry')?.checked;
    const showLocation = document.getElementById('showOptLocation')?.checked;
    const showBorder = document.getElementById('showOptBorder')?.checked;

    const origin = window.location.origin;
    const qrPayload = `${origin}/?scan=${encodeURIComponent(drug.code)}`;
    const qrDataUrl = await generateQrDataUrl(qrPayload, 120);

    // Layout configuration rules
    let config = {
        cols: 3,
        cardWidth: '60mm',
        cardHeight: '34mm',
        qrSize: '70px',
        nameSize: '9pt',
        descSize: '7pt',
        perPage: 24,
        paperDesc: 'A4 ขนาดกลาง (~24 ดวง/แผ่น)'
    };

    if (preset === 'custom') {
        let customW = parseFloat(document.getElementById('customCardWidth')?.value || 30);
        let customH = parseFloat(document.getElementById('customCardHeight')?.value || 20);
        if (isNaN(customW) || customW < 10) customW = 30;
        if (isNaN(customH) || customH < 8) customH = 20;

        // Auto calculate optimal columns on A4 width (~195mm printable width)
        const autoCols = Math.max(1, Math.floor(195 / (customW + 2)));
        const autoRows = Math.max(1, Math.floor(280 / (customH + 2)));
        const calculatedPerPage = autoCols * autoRows;

        // Auto scale QR and typography proportionally
        const qrPx = Math.max(28, Math.min(100, Math.round(customH * 2.3)));
        const namePt = Math.max(6, Math.min(14, (customH * 0.35).toFixed(1)));
        const descPt = Math.max(5, Math.min(10, (customH * 0.26).toFixed(1)));

        config = {
            cols: gridColsOpt === 'auto' ? autoCols : parseInt(gridColsOpt),
            cardWidth: `${customW}mm`,
            cardHeight: `${customH}mm`,
            qrSize: `${qrPx}px`,
            nameSize: `${namePt}pt`,
            descSize: `${descPt}pt`,
            perPage: calculatedPerPage,
            paperDesc: `กำหนดเอง ${customW}x${customH} mm (~${calculatedPerPage} ดวง/แผ่น)`
        };
    } else if (preset === 'a4-micro') {
        config = {
            cols: gridColsOpt === 'auto' ? 6 : parseInt(gridColsOpt),
            cardWidth: '31mm',
            cardHeight: '17mm',
            qrSize: '40px',
            nameSize: '6.5pt',
            descSize: '5.5pt',
            perPage: 96,
            paperDesc: 'A4 จิ๋วพิเศษ (~96-100+ ดวง/แผ่น)'
        };
    } else if (preset === 'a4-mini') {
        config = {
            cols: gridColsOpt === 'auto' ? 5 : parseInt(gridColsOpt),
            cardWidth: '37mm',
            cardHeight: '21mm',
            qrSize: '48px',
            nameSize: '7.5pt',
            descSize: '6pt',
            perPage: 65,
            paperDesc: 'A4 ไซส์มินิ (~65 ดวง/แผ่น)'
        };
    } else if (preset === 'a4-compact') {
        config = {
            cols: gridColsOpt === 'auto' ? 4 : parseInt(gridColsOpt),
            cardWidth: '46mm',
            cardHeight: '26mm',
            qrSize: '56px',
            nameSize: '8pt',
            descSize: '6.5pt',
            perPage: 40,
            paperDesc: 'A4 ขนาดเล็ก (~40 ดวง/แผ่น)'
        };
    } else if (preset === 'a4-standard') {
        config = {
            cols: gridColsOpt === 'auto' ? 3 : parseInt(gridColsOpt),
            cardWidth: '60mm',
            cardHeight: '34mm',
            qrSize: '70px',
            nameSize: '9pt',
            descSize: '7.5pt',
            perPage: 24,
            paperDesc: 'A4 ขนาดกลาง (~24 ดวง/แผ่น)'
        };
    } else if (preset === 'a4-large') {
        config = {
            cols: gridColsOpt === 'auto' ? 2 : parseInt(gridColsOpt),
            cardWidth: '90mm',
            cardHeight: '46mm',
            qrSize: '95px',
            nameSize: '11pt',
            descSize: '8.5pt',
            perPage: 12,
            paperDesc: 'A4 ขนาดใหญ่ (~12 ดวง/แผ่น)'
        };
    } else if (preset === 'thermal-25x15') {
        config = {
            cols: 1,
            cardWidth: '24mm',
            cardHeight: '14mm',
            qrSize: '36px',
            nameSize: '6.5pt',
            descSize: '5pt',
            perPage: 1,
            paperDesc: 'ม้วนสติกเกอร์ความร้อน 25x15 mm (จิ๋ว)'
        };
    } else if (preset === 'thermal-30x20') {
        config = {
            cols: 1,
            cardWidth: '29mm',
            cardHeight: '19mm',
            qrSize: '46px',
            nameSize: '7.5pt',
            descSize: '6pt',
            perPage: 1,
            paperDesc: 'ม้วนสติกเกอร์ความร้อน 30x20 mm (เล็ก)'
        };
    } else if (preset === 'thermal-40x30') {
        config = {
            cols: 1,
            cardWidth: '38mm',
            cardHeight: '28mm',
            qrSize: '58px',
            nameSize: '8pt',
            descSize: '6.5pt',
            perPage: 1,
            paperDesc: 'ม้วนสติกเกอร์ความร้อน 40x30 mm'
        };
    } else if (preset === 'thermal-50x30') {
        config = {
            cols: 1,
            cardWidth: '48mm',
            cardHeight: '28mm',
            qrSize: '65px',
            nameSize: '8.5pt',
            descSize: '7pt',
            perPage: 1,
            paperDesc: 'ม้วนสติกเกอร์ความร้อน 50x30 mm'
        };
    } else if (preset === 'single-label') {
        config = {
            cols: 1,
            cardWidth: '70mm',
            cardHeight: '40mm',
            qrSize: '90px',
            nameSize: '11pt',
            descSize: '8.5pt',
            perPage: 1,
            paperDesc: 'พิมพ์เดี่ยว 1 ดวง'
        };
    }

    if (gridColsOpt !== 'auto') {
        config.cols = parseInt(gridColsOpt);
    }

    // Update sheet summary note
    const pagesNeeded = Math.ceil(count / (config.perPage || 1));
    const summaryEl = document.getElementById('labelSheetSummary');
    if (summaryEl) {
        summaryEl.innerText = `${config.paperDesc} • ทั้งหมด ${count} ดวง (ประมาณ ${pagesNeeded} แผ่น)`;
    }

    const hasAnyText = showTradeName || showCode || showExpiry || showLocation;

    // Build sample sticker card HTML
    const createCardHtml = () => `
        <div class="print-label-item" style="
            width: ${hasAnyText ? config.cardWidth : (preset === 'custom' ? config.cardWidth : 'auto')};
            min-width: ${hasAnyText ? 'auto' : config.cardHeight};
            height: ${config.cardHeight};
            min-height: ${config.cardHeight};
            border: ${showBorder ? '1px dashed #475569' : '1px solid transparent'};
            border-radius: 3px;
            padding: ${hasAnyText ? '2px 4px' : '2px'};
            background: #FFFFFF;
            color: #000000;
            display: flex;
            align-items: center;
            justify-content: ${hasAnyText ? 'flex-start' : 'center'};
            gap: ${hasAnyText ? '4px' : '0'};
            box-sizing: border-box;
            text-align: ${hasAnyText ? 'left' : 'center'};
            box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        ">
            <img src="${qrDataUrl}" style="
                width: ${hasAnyText ? config.qrSize : 'calc(' + config.cardHeight + ' - 4px)'}; 
                height: ${hasAnyText ? config.qrSize : 'calc(' + config.cardHeight + ' - 4px)'}; 
                max-width: 100%; 
                max-height: 100%; 
                flex-shrink: 0; 
                object-fit: contain; 
                display: block; 
                margin: ${hasAnyText ? '0' : 'auto'};
            " alt="QR">
            ${hasAnyText ? `
            <div style="flex: 1; min-width: 0; overflow: hidden; line-height: 1.18;">
                ${showTradeName ? `<div style="font-size: ${config.nameSize}; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #0f172a; margin-bottom: 1px;">${escapeHtml(drug.name)}</div>` : ''}
                ${showCode ? `<div style="font-size: ${config.descSize}; color: #334155; font-weight: 600;">รหัส: ${escapeHtml(drug.code)}</div>` : ''}
                ${showExpiry ? `<div style="font-size: ${config.descSize}; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">EXP: ${escapeHtml(drug.expiry_date || '-')}</div>` : ''}
                ${showLocation && drug.location ? `<div style="font-size: ${config.descSize}; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">ตู้: ${escapeHtml(drug.location)}</div>` : ''}
            </div>` : ''}
        </div>
    `;

    // Render Preview Grid (Show max 24 in preview box to maintain UI responsiveness)
    const previewCount = Math.min(count, 24);
    let previewHtml = `<div style="
        display: grid;
        grid-template-columns: repeat(${config.cols}, auto);
        gap: 5px;
        justify-content: center;
        width: 100%;
    ">`;

    for (let i = 0; i < previewCount; i++) {
        previewHtml += createCardHtml();
    }
    previewHtml += `</div>`;

    if (count > 24) {
        previewHtml += `<div style="text-align: center; margin-top: 8px; font-size: 0.75rem; color: #64748b;">(แสดงตัวอย่าง 24 จากทั้งหมด ${count} ดวง)</div>`;
    }

    const container = document.getElementById('labelPreviewContainer');
    if (container) {
        container.innerHTML = previewHtml;
    }
}

async function executeBatchPrint() {
    if (!currentLabelDrug) return;

    const drug = currentLabelDrug;
    const preset = document.getElementById('labelLayoutPreset')?.value || 'a4-standard';
    let count = parseInt(document.getElementById('labelPrintCount')?.value || 24, 10);
    if (isNaN(count) || count < 1) count = 1;

    const gridColsOpt = document.getElementById('labelGridCols')?.value || 'auto';
    const showTradeName = document.getElementById('showOptTradeName')?.checked;
    const showCode = document.getElementById('showOptCode')?.checked;
    const showExpiry = document.getElementById('showOptExpiry')?.checked;
    const showLocation = document.getElementById('showOptLocation')?.checked;
    const showBorder = document.getElementById('showOptBorder')?.checked;

    const origin = window.location.origin;
    const qrPayload = `${origin}/?scan=${encodeURIComponent(drug.code)}`;
    const qrDataUrl = await generateQrDataUrl(qrPayload, 140);

    let config = {
        cols: 3,
        cardWidth: '60mm',
        cardHeight: '33mm',
        qrSize: '22mm',
        nameSize: '10pt',
        descSize: '7.5pt',
        pageSize: 'A4 portrait',
        margin: '6mm 6mm'
    };

    if (preset === 'custom') {
        let customW = parseFloat(document.getElementById('customCardWidth')?.value || 30);
        let customH = parseFloat(document.getElementById('customCardHeight')?.value || 20);
        if (isNaN(customW) || customW < 10) customW = 30;
        if (isNaN(customH) || customH < 8) customH = 20;

        const autoCols = Math.max(1, Math.floor(195 / (customW + 2)));
        const qrMm = Math.max(9, Math.min(customH * 0.75, 30)).toFixed(1);
        const namePt = Math.max(6, Math.min(14, (customH * 0.35).toFixed(1)));
        const descPt = Math.max(5, Math.min(10, (customH * 0.26).toFixed(1)));

        config = {
            cols: gridColsOpt === 'auto' ? autoCols : parseInt(gridColsOpt),
            cardWidth: `${customW}mm`,
            cardHeight: `${customH}mm`,
            qrSize: `${qrMm}mm`,
            nameSize: `${namePt}pt`,
            descSize: `${descPt}pt`,
            pageSize: 'A4 portrait',
            margin: '5mm 5mm'
        };
    } else if (preset === 'a4-micro') {
        config = {
            cols: gridColsOpt === 'auto' ? 6 : parseInt(gridColsOpt),
            cardWidth: '31mm',
            cardHeight: '17mm',
            qrSize: '13mm',
            nameSize: '7pt',
            descSize: '5.5pt',
            pageSize: 'A4 portrait',
            margin: '4mm 4mm'
        };
    } else if (preset === 'a4-mini') {
        config = {
            cols: gridColsOpt === 'auto' ? 5 : parseInt(gridColsOpt),
            cardWidth: '38mm',
            cardHeight: '21mm',
            qrSize: '16mm',
            nameSize: '8pt',
            descSize: '6pt',
            pageSize: 'A4 portrait',
            margin: '4mm 4mm'
        };
    } else if (preset === 'a4-compact') {
        config = {
            cols: gridColsOpt === 'auto' ? 4 : parseInt(gridColsOpt),
            cardWidth: '46mm',
            cardHeight: '26mm',
            qrSize: '18mm',
            nameSize: '8.5pt',
            descSize: '6.5pt',
            pageSize: 'A4 portrait',
            margin: '5mm 5mm'
        };
    } else if (preset === 'a4-standard') {
        config = {
            cols: gridColsOpt === 'auto' ? 3 : parseInt(gridColsOpt),
            cardWidth: '62mm',
            cardHeight: '33mm',
            qrSize: '22mm',
            nameSize: '10pt',
            descSize: '7.5pt',
            pageSize: 'A4 portrait',
            margin: '6mm 6mm'
        };
    } else if (preset === 'a4-large') {
        config = {
            cols: gridColsOpt === 'auto' ? 2 : parseInt(gridColsOpt),
            cardWidth: '92mm',
            cardHeight: '44mm',
            qrSize: '30mm',
            nameSize: '12pt',
            descSize: '9pt',
            pageSize: 'A4 portrait',
            margin: '8mm 8mm'
        };
    } else if (preset === 'thermal-25x15') {
        config = {
            cols: 1,
            cardWidth: '24mm',
            cardHeight: '14mm',
            qrSize: '11mm',
            nameSize: '6.5pt',
            descSize: '4.8pt',
            pageSize: '25mm 15mm',
            margin: '0.5mm 0.5mm'
        };
    } else if (preset === 'thermal-30x20') {
        config = {
            cols: 1,
            cardWidth: '29mm',
            cardHeight: '19mm',
            qrSize: '14mm',
            nameSize: '7.5pt',
            descSize: '5.5pt',
            pageSize: '30mm 20mm',
            margin: '0.8mm 0.8mm'
        };
    } else if (preset === 'thermal-40x30') {
        config = {
            cols: 1,
            cardWidth: '38mm',
            cardHeight: '28mm',
            qrSize: '18mm',
            nameSize: '8pt',
            descSize: '6.5pt',
            pageSize: '40mm 30mm',
            margin: '1mm 1mm'
        };
    } else if (preset === 'thermal-50x30') {
        config = {
            cols: 1,
            cardWidth: '48mm',
            cardHeight: '28mm',
            qrSize: '20mm',
            nameSize: '9pt',
            descSize: '7pt',
            pageSize: '50mm 30mm',
            margin: '1mm 1mm'
        };
    } else if (preset === 'single-label') {
        config = {
            cols: 1,
            cardWidth: '70mm',
            cardHeight: '40mm',
            qrSize: '28mm',
            nameSize: '12pt',
            descSize: '9pt',
            pageSize: 'auto',
            margin: '5mm'
        };
    }

    if (gridColsOpt !== 'auto') {
        config.cols = parseInt(gridColsOpt);
    }

    const hasAnyTextPrint = showTradeName || showCode || showExpiry || showLocation;
    
    // Auto-tighten dimensions if QR Only
    const finalCardWidth = hasAnyTextPrint ? config.cardWidth : (preset === 'custom' ? config.cardWidth : config.cardHeight);
    const finalQrSize = hasAnyTextPrint ? config.qrSize : `calc(${config.cardHeight} - 2mm)`;

    // If QR only and not custom preset, we can fit even more columns on A4!
    if (!hasAnyTextPrint && gridColsOpt === 'auto' && preset !== 'custom' && !preset.startsWith('thermal')) {
        config.cols = Math.max(config.cols, 6);
    }

    // Build print HTML content
    let cardsHtml = '';
    for (let i = 0; i < count; i++) {
        cardsHtml += `
            <div class="label-card ${!hasAnyTextPrint ? 'qr-only-card' : ''}">
                <img src="${qrDataUrl}" class="qr-img" alt="QR">
                ${hasAnyTextPrint ? `
                <div class="label-info">
                    ${showTradeName ? `<div class="drug-name">${escapeHtml(drug.name)}</div>` : ''}
                    ${showCode ? `<div class="drug-code">รหัส: ${escapeHtml(drug.code)}</div>` : ''}
                    ${showExpiry ? `<div class="drug-exp">EXP: ${escapeHtml(drug.expiry_date || '-')}</div>` : ''}
                    ${showLocation && drug.location ? `<div class="drug-loc">ตู้: ${escapeHtml(drug.location)}</div>` : ''}
                </div>` : ''}
            </div>
        `;
    }

    const printWin = window.open('', '_blank', 'width=900,height=750');
    if (printWin) {
        printWin.document.open();
        printWin.document.write(`<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <title>พิมพ์ฉลากสติกเกอร์ยา - ${escapeHtml(drug.name)} (${count} ดวง)</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Anuphan:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
        @page {
            size: ${config.pageSize};
            margin: ${config.margin};
        }
        * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        body {
            font-family: 'Anuphan', -apple-system, sans-serif;
            margin: 0;
            padding: 0;
            background: #ffffff;
            color: #000000;
        }
        .grid-container {
            display: grid;
            grid-template-columns: repeat(${config.cols}, 1fr);
            gap: 2mm;
            width: 100%;
            justify-content: stretch;
            align-content: flex-start;
            page-break-inside: auto;
        }
        .label-card {
            width: 100%;
            height: ${config.cardHeight};
            max-height: ${config.cardHeight};
            border: ${showBorder ? '1px dashed #94a3b8' : '1px solid transparent'};
            border-radius: 3px;
            padding: ${hasAnyTextPrint ? '1.5mm 2mm' : '1mm'};
            display: flex;
            align-items: center;
            justify-content: ${hasAnyTextPrint ? 'flex-start' : 'center'};
            gap: ${hasAnyTextPrint ? '2mm' : '0'};
            page-break-inside: avoid;
            background: #ffffff;
            overflow: hidden;
            box-sizing: border-box;
        }
        .label-card.qr-only-card {
            justify-content: center !important;
            padding: 1mm !important;
        }
        .qr-img {
            width: ${finalQrSize};
            height: ${finalQrSize};
            max-width: 100%;
            max-height: 100%;
            flex-shrink: 0;
            object-fit: contain;
            display: block;
            margin: ${hasAnyTextPrint ? '0' : 'auto'};
        }
        .label-info {
            flex: 1;
            min-width: 0;
            overflow: hidden;
            line-height: 1.22;
        }
        .drug-name {
            font-size: ${config.nameSize};
            font-weight: 700;
            color: #000000;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            margin-bottom: 0.5mm;
        }
        .drug-code {
            font-size: ${config.descSize};
            font-weight: 600;
            color: #1e293b;
        }
        .drug-exp, .drug-loc {
            font-size: ${config.descSize};
            color: #334155;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        @media print {
            body { padding: 0; }
            .no-print { display: none !important; }
        }
    </style>
</head>
<body>
    <div class="grid-container">
        ${cardsHtml}
    </div>
    <script>
        window.onload = function() {
            window.focus();
            window.print();
            setTimeout(function() { window.close(); }, 800);
        };
    </script>
</body>
</html>`);
        printWin.document.close();
    } else {
        showToast('กรุณาอนุญาตให้เปิดหน้าต่าง Pop-up เพื่อพิมพ์ฉลาก', 'warning');
    }
}

function printQrLabel() {
    executeBatchPrint();
}

// ─────────────────────────────────────────────────────────────
// Mobile QR & 1D Barcode Camera Scanner Engine
// ─────────────────────────────────────────────────────────────

function playMedicalBeep() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
            const ctx = new AudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            gain.gain.setValueAtTime(0.2, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.15);
        }
    } catch (e) {}
    if (navigator.vibrate) {
        navigator.vibrate([80, 40, 80]);
    }
}

let availableCameras = [];
let selectedCameraId = null;
let currentFacingMode = "environment"; // Always default to back camera with autofocus
let isTorchOn = false;
let pendingNewBarcode = null;

async function updateCameraList() {
    try {
        const devices = await Html5Qrcode.getCameras();
        const selectEl = document.getElementById('cameraSelectDropdown');
        if (devices && devices.length > 0) {
            availableCameras = devices;
            if (selectEl) {
                selectEl.innerHTML = devices.map((d, idx) => `
                    <option value="${d.id}" ${d.id === selectedCameraId ? 'selected' : ''}>${d.label || 'กล้องตัวที่ ' + (idx + 1)}</option>
                `).join('');
                selectEl.style.display = 'inline-block';
            }
        }
    } catch (e) {
        console.warn("Could not list cameras:", e);
    }
}

async function onCameraSelectChange(e) {
    selectedCameraId = e.target.value;
    await stopScanner();
    await startScanner();
}

async function flipCamera() {
    currentFacingMode = (currentFacingMode === "environment") ? "user" : "environment";
    selectedCameraId = null; // reset specific ID so facingMode takes effect
    showToast(`🔄 สลับไปใช้กล้อง${currentFacingMode === 'environment' ? 'หลัง' : 'หน้า'}...`, 'info');
    await stopScanner();
    await startScanner();
}

async function toggleTorch() {
    if (!html5QrScanner) {
        showToast('กรุณาเปิดกล้องก่อนใช้งานไฟฉาย', 'info');
        return;
    }
    try {
        isTorchOn = !isTorchOn;
        await html5QrScanner.applyVideoConstraints({
            advanced: [{ torch: isTorchOn }]
        });
        const btn = document.getElementById('btnToggleTorch');
        if (btn) {
            btn.classList.toggle('btn-primary', isTorchOn);
            btn.classList.toggle('btn-outline', !isTorchOn);
        }
        showToast(isTorchOn ? '💡 เปิดไฟฉายแล้ว' : 'ไฟฉายปิดแล้ว', 'info');
    } catch (e) {
        showToast('อุปกรณ์นี้ไม่รองรับการเปิดไฟฉาย', 'info');
    }
}

async function startScanner() {
    if (html5QrScanner) {
        return;
    }
    const scannerEl = document.getElementById('qr-reader');
    if (!scannerEl) return;

    try {
        // Safe list of formats for both 1D and 2D barcodes
        const formats = (typeof Html5QrcodeSupportedFormats !== 'undefined') ? [
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.DATA_MATRIX,
            Html5QrcodeSupportedFormats.CODABAR
        ] : [0, 9, 10, 5, 3, 14, 15, 6, 2];

        html5QrScanner = new Html5Qrcode("qr-reader", {
            formatsToSupport: formats,
            verbose: false,
            experimentalFeatures: {
                useBarCodeDetectorIfSupported: true
            }
        });

        const config = {
            fps: 15,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
                // Wide rectangular box ideal for both barcodes & QR
                const w = Math.min(Math.floor(viewfinderWidth * 0.9), 360);
                const h = Math.min(Math.floor(viewfinderHeight * 0.65), 240);
                return { width: Math.max(w, 200), height: Math.max(h, 150) };
            }
        };

        const cameraMode = selectedCameraId ? selectedCameraId : { facingMode: currentFacingMode };

        await html5QrScanner.start(
            cameraMode,
            config,
            onScanSuccess,
            (errorMessage) => {
                // scanning frame
            }
        );

        const errorNotice = document.getElementById('scannerErrorNotice');
        if (errorNotice) errorNotice.style.display = 'none';
        const activeNotice = document.getElementById('scannerActiveIndicator');
        if (activeNotice) activeNotice.style.display = 'block';

        // After camera starts and permission granted, populate camera dropdown
        updateCameraList();

    } catch (err) {
        console.warn("Unable to start camera scanner:", err);
        const errorNotice = document.getElementById('scannerErrorNotice');
        if (errorNotice) {
            errorNotice.style.display = 'block';
            errorNotice.innerHTML = `
                <i class="fas fa-exclamation-circle"></i> ไม่สามารถเปิดกล้องได้: ${escapeHtml(err?.message || err || 'กรุณาอนุญาตการเข้าถึงกล้อง')}<br>
                <small>หากใช้ Safari/Chrome กรุณากดอนุญาตให้เข้าถึงกล้อง หรือใช้วิธีพิมพ์รหัส/ถ่ายภาพด้านล่างแทนค่ะ</small>
            `;
        }
        const activeNotice = document.getElementById('scannerActiveIndicator');
        if (activeNotice) activeNotice.style.display = 'none';
    }
}

async function stopScanner() {
    if (html5QrScanner) {
        try {
            await html5QrScanner.stop();
            html5QrScanner.clear();
        } catch (err) {}
        html5QrScanner = null;
        isTorchOn = false;
        const ind = document.getElementById('scannerActiveIndicator');
        if (ind) ind.style.display = 'none';
    }
}

async function onScanSuccess(decodedText, decodedResult) {
    await stopScanner();
    await handleScannedCode(decodedText);
}

async function handleScannedCode(rawCode) {
    if (!rawCode) return;
    
    // Parse URL if the code was a URL (e.g. scanned from regular phone camera or LINE QR)
    let cleanCode = rawCode.trim();
    if (cleanCode.startsWith('http://') || cleanCode.startsWith('https://')) {
        try {
            const url = new URL(cleanCode);
            cleanCode = url.searchParams.get('scan') || url.searchParams.get('code') || url.searchParams.get('dispense') || cleanCode;
            if (cleanCode.includes('/')) {
                const parts = cleanCode.split('/');
                cleanCode = parts[parts.length - 1];
            }
        } catch (e) {}
    }
    cleanCode = cleanCode.replace(/^PHARM:/i, '').trim();

    playMedicalBeep();
    showToast(`🔍 กำลังตรวจสอบรหัส: ${cleanCode}...`, 'info');

    try {
        const res = await fetch(`/api/drugs/scan-lookup?code=${encodeURIComponent(cleanCode)}`);
        const data = await res.json();

        if (data.ok && data.found && data.drug) {
            const drug = data.drug;
            switchTab('inventory');
            openDispenseModalForDrug(drug.id, 'QR_SCAN');
            showToast(`✅ พบยาในคลัง: ${drug.name}`, 'success');
        } else {
            // Open nice modal prompt instead of window.confirm!
            openNewBarcodeModal(cleanCode);
        }
    } catch (e) {
        console.error('Scan lookup error:', e);
        showToast('เกิดข้อผิดพลาดในการค้นหาข้อมูลยา', 'error');
    }
}

// Modal for Unregistered Barcode Prompt
function openNewBarcodeModal(code) {
    pendingNewBarcode = code;
    const disp = document.getElementById('newBarcodeDisplay');
    if (disp) disp.innerText = code;
    const modal = document.getElementById('newBarcodeModal');
    if (modal) modal.classList.add('active');
}

function closeNewBarcodeModal() {
    const modal = document.getElementById('newBarcodeModal');
    if (modal) modal.classList.remove('active');
}

function proceedAddNewDrugWithBarcode() {
    const code = pendingNewBarcode;
    closeNewBarcodeModal();
    switchTab('inventory');
    openAddDrugModal();
    const codeInput = document.getElementById('drugCodeInput');
    if (codeInput && code) {
        codeInput.value = code;
    }
}

// Manual Barcode Input & Quick Test
function submitManualBarcode() {
    const input = document.getElementById('manualBarcodeInput');
    if (!input) return;
    const val = input.value.trim();
    if (!val) {
        showToast('กรุณากรอกรหัสยาหรือบาร์โค้ด', 'warning');
        return;
    }
    handleScannedCode(val);
}

function quickTestScan(code) {
    const input = document.getElementById('manualBarcodeInput');
    if (input) input.value = code;
    handleScannedCode(code);
}

// Client-Side Instant File / Photo Scanning
async function scanLocalImageFile(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    showToast('🔍 กำลังวิเคราะห์รูปภาพ...', 'info');

    await stopScanner();

    try {
        // Try decoding directly in browser first
        const scanner = new Html5Qrcode("qr-reader-file-temp");
        const result = await scanner.scanFile(file, true);
        if (result) {
            handleScannedCode(result);
            input.value = '';
            return;
        }
    } catch (clientErr) {
        console.log("Client file scan failed, falling back to server OCR:", clientErr);
    }

    // Fallback: Upload to server OCR
    uploadPrescriptionForScan(input);
}

// Image upload OCR scan
async function uploadPrescriptionForScan(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const formData = new FormData();
    formData.append('file', file);

    const btn = document.getElementById('btnUploadOcr');
    if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> กำลังวิเคราะห์ภาพ...';

    try {
        const res = await fetch('/api/scan-image', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (data.ok && data.analysis) {
            const an = data.analysis;
            if (an.success && an.drug) {
                switchTab('inventory');
                openDispenseModalForDrug(an.drug.id);
                document.getElementById('dispenseQtyInput').value = an.quantity || 1;
                showToast(`AI OCR ตรวจพบ: ${an.drug.name} (จำนวน ${an.quantity})`, 'success');
            } else {
                alert(an.message || 'ไม่สามารถตรวจพบชื่อยาจากภาพนี้ได้');
            }
        }
    } catch (e) {
        console.error('Scan error:', e);
        alert('เกิดข้อผิดพลาดในการประมวลผลรูปภาพ');
    } finally {
        if (btn) btn.innerHTML = '<i class="fas fa-camera"></i> อัปโหลดรูปใบสั่งยา / ซองยา';
        input.value = '';
    }
}

// ─────────────────────────────────────────────────────────────
// Manual Force Sync to Google Sheet
// ─────────────────────────────────────────────────────────────

async function syncWithGoogleSheet() {
    const btn = document.getElementById('btnSyncSheet');
    if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> กำลังซิงก์...';

    try {
        const res = await fetch('/api/sync-sheet', { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
            showToast('✅ ซิงก์ข้อมูลคลังยาลง Google Sheet สำเร็จแล้ว', 'success');
            loadDashboardStats();
        } else {
            alert('การซิงก์ Sheet: ' + (data.message || 'Error'));
        }
    } catch (e) {
        console.error('Sync error:', e);
    } finally {
        if (btn) btn.innerHTML = '<i class="fas fa-sync-alt"></i> ซิงก์กับ Google Sheet';
    }
}

// ─────────────────────────────────────────────────────────────
// Utilities & Toast Notifications
// ─────────────────────────────────────────────────────────────

function setupEventListeners() {
    const searchInput = document.getElementById('drugSearchInput');
    if (searchInput) {
        let debounceTimer;
        searchInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(loadDrugs, 300);
        });
    }

    const catFilter = document.getElementById('categoryFilter');
    if (catFilter) catFilter.addEventListener('change', loadDrugs);

    const updateFilterChipStates = () => {
        const lowCheck = document.getElementById('lowStockCheckbox');
        const expCheck = document.getElementById('expiringCheckbox');
        const chipLow = document.getElementById('chipLowStock');
        const chipExp = document.getElementById('chipExpiring');
        if (chipLow && lowCheck) chipLow.classList.toggle('active', lowCheck.checked);
        if (chipExp && expCheck) chipExp.classList.toggle('active', expCheck.checked);
    };

    const lowStockCheck = document.getElementById('lowStockCheckbox');
    if (lowStockCheck) {
        lowStockCheck.addEventListener('change', () => {
            updateFilterChipStates();
            loadDrugs();
        });
    }

    const expiringCheck = document.getElementById('expiringCheckbox');
    if (expiringCheck) {
        expiringCheck.addEventListener('change', () => {
            updateFilterChipStates();
            loadDrugs();
        });
    }

    const logDate = document.getElementById('logDateFilter');
    if (logDate) logDate.addEventListener('change', loadDispensingLogs);

    const logChannel = document.getElementById('logChannelFilter');
    if (logChannel) logChannel.addEventListener('change', loadDispensingLogs);

    const stockInSearch = document.getElementById('stockInSearchInput');
    if (stockInSearch) {
        let debounceTimer;
        stockInSearch.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => renderStockInTable(stockInLogsList), 250);
        });
    }

    const stockInDate = document.getElementById('stockInDateFilter');
    if (stockInDate) stockInDate.addEventListener('change', loadStockInLogs);

    // Global Keyboard Shortcuts (Linear-grade Pro UX)
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeDrugModal();
            closeDispenseModal();
            closeStockInModal();
            closeQrModal();
            closeGoogleSettingsModal();
            closeLineSettingsModal();
            closeNewBarcodeModal();
            closeImageLightbox();
            closeApkInstallModal();
        }
        const isEditing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
        if ((e.key === '/' && !isEditing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
            e.preventDefault();
            const s = document.getElementById('drugSearchInput');
            if (s) {
                switchTab('inventory');
                s.focus();
                s.select();
            }
        }
    });
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = 'toast-alert';
    const borderColor = type === 'success' ? 'var(--emerald-600)' : (type === 'error' ? 'var(--rose-600)' : 'var(--brand-500)');
    const iconClass = type === 'success' ? 'fa-check-circle' : (type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-info');
    const iconColor = type === 'success' ? 'var(--emerald-600)' : (type === 'error' ? 'var(--rose-600)' : 'var(--brand-500)');

    toast.style.cssText = `
        position: fixed;
        bottom: 1.75rem;
        right: 1.75rem;
        z-index: 10000;
        background-color: var(--bg-surface);
        border: 1px solid var(--border-default);
        border-left: 4px solid ${borderColor};
        color: var(--text-primary);
        padding: 0.75rem 1.15rem;
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-modal);
        font-family: var(--font-sans);
        font-weight: 600;
        font-size: 0.825rem;
        display: inline-flex;
        align-items: center;
        gap: 0.65rem;
        animation: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        max-width: 90vw;
    `;
    toast.innerHTML = `<i class="fas ${iconClass}" style="color: ${iconColor}; font-size: 1rem;"></i> <span>${escapeHtml(message)}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(8px)';
        toast.style.transition = 'all 0.25s ease';
        setTimeout(() => toast.remove(), 260);
    }, 3200);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ─────────────────────────────────────────────────────────────
// Google Drive & Sheets Connection Settings
// ─────────────────────────────────────────────────────────────

async function openGoogleSettingsModal() {
    document.getElementById('googleSettingsModal').classList.add('active');
    loadGoogleConfig();
}

function closeGoogleSettingsModal() {
    document.getElementById('googleSettingsModal').classList.remove('active');
}

async function loadGoogleConfig() {
    const banner = document.getElementById('googleStatusBanner');
    const statusText = document.getElementById('googleStatusText');
    const emailEl = document.getElementById('googleServiceEmail');
    const linkSheet = document.getElementById('linkOpenSheet');
    const linkDrive = document.getElementById('linkOpenDrive');
    const sheetInput = document.getElementById('inputSpreadsheetId');
    const driveInput = document.getElementById('inputDriveFolderId');
    const oauthCard = document.getElementById('googleOAuthCard');
    const connectedArea = document.getElementById('googleConnectedArea');
    const connectedEmailText = document.getElementById('googleConnectedEmailText');
    const btnGoToSheet = document.getElementById('btnGoToSheet');
    const btnGoToDrive = document.getElementById('btnGoToDrive');

    try {
        const res = await fetch('/api/google/config');
        const data = await res.json();
        if (data.ok && data.config) {
            const c = data.config;
            sheetInput.value = c.spreadsheet_id || '';
            driveInput.value = c.drive_folder_id || '';

            if (c.auth_type === 'oauth' && c.is_connected) {
                // OAuth Connected
                if (oauthCard) oauthCard.style.display = 'none';
                if (connectedArea) {
                    connectedArea.style.display = 'block';
                    if (connectedEmailText) {
                        connectedEmailText.innerHTML = `บัญชี Google: <strong>${escapeHtml(c.connected_email || '-')}</strong><br><span style="font-size: 0.775rem; color: var(--text-muted);">ชีต: ${escapeHtml(c.sheet_title || 'ระบบคลังยา')}</span>`;
                    }
                    if (btnGoToSheet && c.spreadsheet_url) btnGoToSheet.href = c.spreadsheet_url;
                    if (btnGoToDrive && c.drive_folder_url) btnGoToDrive.href = c.drive_folder_url;
                }
                if (emailEl) {
                    emailEl.innerHTML = `<strong>ประเภทการเชื่อมต่อ:</strong> บัญชีส่วนตัว (OAuth 2.0: ${escapeHtml(c.connected_email || '')})`;
                }
            } else {
                // Service Account or Not Connected
                if (oauthCard) oauthCard.style.display = 'block';
                if (connectedArea) connectedArea.style.display = 'none';
                if (c.service_account_email) {
                    if (emailEl) emailEl.innerHTML = `<strong>Service Account:</strong> <code style="color: var(--color-brand); font-size: 0.775rem;">${escapeHtml(c.service_account_email)}</code>`;
                } else {
                    if (emailEl) emailEl.innerText = 'ยังไม่ได้เชื่อมต่อบัญชี Google';
                }
            }

            if (c.is_connected && c.spreadsheet_id) {
                if (banner) {
                    banner.style.background = 'var(--emerald-50)';
                    banner.style.border = '1px solid var(--emerald-600)';
                }
                if (statusText) {
                    statusText.innerHTML = `<span style="color: var(--emerald-600);"><i class="fas fa-check-circle"></i> เชื่อมต่อ Google Drive & Sheets สำเร็จ</span> (${escapeHtml(c.sheet_title || 'พร้อมใช้งาน')})`;
                }
                if (linkSheet && c.spreadsheet_url) {
                    linkSheet.href = c.spreadsheet_url;
                    linkSheet.style.display = 'inline-flex';
                }
                if (linkDrive && c.drive_folder_url) {
                    linkDrive.href = c.drive_folder_url;
                    linkDrive.style.display = 'inline-flex';
                }
            } else {
                if (banner) {
                    banner.style.background = 'var(--amber-50)';
                    banner.style.border = '1px solid var(--amber-600)';
                }
                if (statusText) {
                    statusText.innerHTML = `<span style="color: var(--amber-600);"><i class="fas fa-exclamation-triangle"></i> กำลังใช้งานในโหมด Local Cache (ยังไม่ได้เชื่อมต่อ Google Sheet)</span>`;
                    if (c.connection_error) {
                        statusText.innerHTML += `<div style="font-size: 0.75rem; color: var(--rose-600); margin-top: 0.25rem;">ข้อผิดพลาด: ${escapeHtml(c.connection_error)}</div>`;
                    }
                }
                if (linkSheet) linkSheet.style.display = 'none';
                if (linkDrive) linkDrive.style.display = 'none';
            }
        }
    } catch (e) {
        console.error('Error loading google config:', e);
    }
}

async function disconnectGoogleAccount() {
    if (!confirm('คุณต้องการยกเลิกการเชื่อมต่อกับบัญชี Google นี้ใช่หรือไม่?\n(ข้อมูลในคลังยายังคงอยู่ในเครื่องตามปกติ)')) {
        return;
    }
    try {
        const res = await fetch('/api/google/disconnect', { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
            showToast('ตัดการเชื่อมต่อ Google เรียบร้อยแล้ว', 'info');
            loadGoogleConfig();
            loadDashboardStats();
        } else {
            alert('ไม่สามารถตัดการเชื่อมต่อได้: ' + (data.error || 'Error'));
        }
    } catch (e) {
        console.error('Disconnect error:', e);
        alert('เกิดข้อผิดพลาดในการตัดการเชื่อมต่อ');
    }
}

async function saveGoogleConfig(e) {
    e.preventDefault();
    const btn = document.getElementById('btnSaveGoogleConfig');
    if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> กำลังทดสอบและบันทึก...';

    const sheetInput = document.getElementById('inputSpreadsheetId').value.trim();
    const driveInput = document.getElementById('inputDriveFolderId').value.trim();

    try {
        const res = await fetch('/api/google/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                spreadsheet_id: sheetInput,
                drive_folder_id: driveInput
            })
        });
        const data = await res.json();
        if (data.ok) {
            showToast('✅ บันทึกและเชื่อมต่อ Google Drive & Sheets เรียบร้อยแล้ว', 'success');
            loadGoogleConfig();
            loadDashboardStats();
        } else {
            alert('ไม่สามารถบันทึกได้: ' + (data.error || 'Error'));
        }
    } catch (e) {
        console.error('Save google config error:', e);
        alert('เกิดข้อผิดพลาดในการบันทึก');
    } finally {
        if (btn) btn.innerHTML = '<i class="fas fa-save"></i> บันทึกและทดสอบเชื่อมต่อ';
    }
}

async function autoCreateSheet() {
    const btn = document.getElementById('btnAutoCreateSheet');
    if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> กำลังสร้าง...';

    try {
        const res = await fetch('/api/google/auto-create-sheet', { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
            showToast('🎉 สร้าง Google Sheet คลังยาสำเร็จแล้ว!', 'success');
            loadGoogleConfig();
            loadDashboardStats();
        } else {
            alert('ไม่สามารถสร้าง Sheet อัตโนมัติได้: ' + (data.error || 'กรุณาตรวจสอบสิทธิ์ของ Service Account'));
        }
    } catch (e) {
        console.error('Auto create sheet error:', e);
        alert('เกิดข้อผิดพลาดในการสร้าง Sheet');
    } finally {
        if (btn) btn.innerHTML = '✨ สร้าง Sheet ใหม่อัตโนมัติ';
    }
}

// ─────────────────────────────────────────────────────────────
// Excel Export Helpers
// ─────────────────────────────────────────────────────────────

function exportInventoryExcel() {
    const btn = document.getElementById('btnExportInventory');
    if (btn) {
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> กำลังสร้าง...';
        btn.disabled = true;
        setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 3000);
    }
    // Simple anchor-download — browser handles the file
    const link = document.createElement('a');
    link.href = '/api/export/inventory';
    link.download = '';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('📥 กำลังดาวน์โหลด Excel คลังยา…', 'success');
}

function exportLogsExcel() {
    // Pick up active filters from UI
    const dateVal    = document.getElementById('logDateFilter')?.value || '';
    const channelVal = document.getElementById('logChannelFilter')?.value || 'all';
    const params = new URLSearchParams();
    if (dateVal)              params.set('date',    dateVal);
    if (channelVal && channelVal !== 'all') params.set('channel', channelVal);

    const link = document.createElement('a');
    link.href = `/api/export/logs?${params.toString()}`;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('📥 กำลังดาวน์โหลด Excel ประวัติการตัดสต็อก…', 'success');
}

// ─────────────────────────────────────────────────────────────
// LINE Notification & Expiry Alert Functions
// ─────────────────────────────────────────────────────────────

function toggleExpiringFilter() {
    const check = document.getElementById('expiringCheckbox');
    if (check) {
        check.checked = !check.checked;
        const chipExp = document.getElementById('chipExpiring');
        if (chipExp) chipExp.classList.toggle('active', check.checked);
        switchTab('inventory');
        loadDrugs();
        const table = document.querySelector('.desktop-table-wrapper') || document.getElementById('view-inventory');
        if (table) table.scrollIntoView({ behavior: 'smooth' });
    }
}

async function openLineSettingsModal() {
    const modal = document.getElementById('lineSettingsModal');
    if (!modal) return;
    modal.classList.add('active');
    await loadLineConfig();
}

function closeLineSettingsModal() {
    const modal = document.getElementById('lineSettingsModal');
    if (modal) modal.classList.remove('active');
}

async function loadLineConfig() {
    try {
        const res = await fetch('/api/line/config');
        const data = await res.json();
        if (data.ok) {
            const botBadge = document.getElementById('lineBotActiveBadge');
            if (botBadge) {
                if (data.is_configured) {
                    botBadge.className = 'badge badge-success';
                    botBadge.innerHTML = '<i class="fas fa-circle-check"></i> พร้อมใช้งาน';
                } else {
                    botBadge.className = 'badge badge-danger';
                    botBadge.innerHTML = '<i class="fas fa-triangle-exclamation"></i> ยังไม่ตั้ง Token';
                }
            }
            const botIdEl = document.getElementById('modalLineBotId');
            if (botIdEl) botIdEl.innerText = data.bot_basic_id || '@905gsngi';

            const daysEl = document.getElementById('modalLineExpiryDays');
            if (daysEl) daysEl.innerText = `ภายใน ${data.expiry_alert_days} วัน`;

            const inputDays = document.getElementById('inputLineExpiryDays');
            if (inputDays) inputDays.value = data.expiry_alert_days || 60;

            const inputTarget = document.getElementById('inputLineTargetId');
            if (inputTarget) inputTarget.value = data.target_id || '';

            const expCountEl = document.getElementById('modalLineExpiringCount');
            if (expCountEl) expCountEl.innerText = `${data.expiring_count} รายการ`;

            const lastAlertEl = document.getElementById('modalLineLastAlert');
            if (lastAlertEl) lastAlertEl.innerText = data.last_alert_sent || 'ยังไม่เคยส่ง';
        }
    } catch (e) {
        console.error('Error loading LINE config:', e);
    }
}

async function saveLineConfig(e) {
    e.preventDefault();
    const days = parseInt(document.getElementById('inputLineExpiryDays')?.value || 60);
    const targetId = document.getElementById('inputLineTargetId')?.value || '';

    try {
        const res = await fetch('/api/line/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                expiry_alert_days: days,
                target_id: targetId
            })
        });
        const data = await res.json();
        if (data.ok) {
            showToast('✅ บันทึกการตั้งค่าแจ้งเตือน LINE เรียบร้อยแล้ว', 'success');
            loadLineConfig();
            loadDashboardStats();
            loadDrugs();
        } else {
            alert('ไม่สามารถบันทึกได้: ' + (data.error || 'Error'));
        }
    } catch (err) {
        console.error('Save LINE config error:', err);
        alert('เกิดข้อผิดพลาดในการบันทึกการตั้งค่า LINE');
    }
}

async function sendLineExpiryAlertNow(force = true) {
    const btnToolbar = document.getElementById('btnLineExpiryAlert');
    const btnModal = document.getElementById('btnModalSendLineAlert');

    const origToolbarText = btnToolbar ? btnToolbar.innerHTML : '';
    const origModalText = btnModal ? btnModal.innerHTML : '';

    if (btnToolbar) {
        btnToolbar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> กำลังส่ง...';
        btnToolbar.disabled = true;
    }
    if (btnModal) {
        btnModal.innerHTML = '<i class="fas fa-spinner fa-spin"></i> กำลังส่ง Flex Message...';
        btnModal.disabled = true;
    }

    try {
        const res = await fetch('/api/line/send-expiry-alert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force: force })
        });
        const data = await res.json();

        if (data.ok && data.sent) {
            showToast(`🎉 ส่งแจ้งเตือนยาใกล้หมดอายุ (${data.expiring_count} รายการ) เข้า LINE สำเร็จแล้ว!`, 'success');
            loadLineConfig();
            loadDashboardStats();
        } else if (data.ok && !data.sent) {
            showToast(`ℹ️ ${data.message}`, 'info');
        } else {
            alert('ไม่สามารถส่งข้อความได้: ' + (data.error || 'Unknown Error'));
        }
    } catch (err) {
        console.error('Send LINE alert error:', err);
        showToast('⚠️ เกิดข้อผิดพลาดในการส่ง LINE Alert', 'error');
    } finally {
        if (btnToolbar) {
            btnToolbar.innerHTML = origToolbarText;
            btnToolbar.disabled = false;
        }
        if (btnModal) {
            btnModal.innerHTML = origModalText;
            btnModal.disabled = false;
        }
    }
}

// ─────────────────────────────────────────────────────────────
// 📥 Stock In / Batch & Lot Management Logic
// ─────────────────────────────────────────────────────────────

let stockInLogsList = [];

function populateStockInDrugSelect(selectedId = null) {
    const select = document.getElementById('stockInDrugSelect');
    if (!select) return;

    select.innerHTML = '<option value="">-- กรุณาเลือกรายการยาในคลัง --</option>' + 
        allDrugs.map(d => `<option value="${d.id}" ${selectedId && Number(d.id) === Number(selectedId) ? 'selected' : ''}>${escapeHtml(d.code)} - ${escapeHtml(d.name)} (คงเหลือ: ${d.stock_qty} ${d.unit})</option>`).join('');

    if (selectedId) {
        onStockInDrugChange();
    }
}

function openStockInModal(drugId = null) {
    populateStockInDrugSelect(drugId);

    const form = document.getElementById('stockInForm');
    if (form) form.reset();

    if (drugId) {
        const select = document.getElementById('stockInDrugSelect');
        if (select) {
            select.value = drugId;
            onStockInDrugChange();
        }
    } else {
        const preview = document.getElementById('stockInDrugPreview');
        if (preview) preview.style.display = 'none';
    }

    const recByInput = document.getElementById('stockInReceivedByInput');
    if (recByInput && !recByInput.value) recByInput.value = 'เภสัชกร/เจ้าหน้าที่';

    const supInput = document.getElementById('stockInSupplierInput');
    if (supInput && !supInput.value) supInput.value = 'องค์การเภสัชกรรม (GPO)';

    calcStockInTotal();

    const modal = document.getElementById('stockInModal');
    if (modal) modal.classList.add('active');
}

function closeStockInModal() {
    const modal = document.getElementById('stockInModal');
    if (modal) modal.classList.remove('active');
}

function onStockInDrugChange(event) {
    const select = document.getElementById('stockInDrugSelect');
    if (!select) return;

    const drugId = select.value;
    const preview = document.getElementById('stockInDrugPreview');
    const drug = allDrugs.find(d => Number(d.id) === Number(drugId));

    if (drug && preview) {
        preview.style.display = 'block';
        const codeEl = document.getElementById('previewDrugCode');
        const nameEl = document.getElementById('previewDrugName');
        const stockEl = document.getElementById('previewCurrentStock');
        const unitEl = document.getElementById('previewUnit');

        if (codeEl) codeEl.innerText = drug.code;
        if (nameEl) nameEl.innerText = drug.name;
        if (stockEl) stockEl.innerText = drug.stock_qty;
        if (unitEl) unitEl.innerText = drug.unit;

        // Auto-fill cost if available
        const costInput = document.getElementById('stockInCostInput');
        if (costInput && (!costInput.value || costInput.value === '0')) {
            costInput.value = drug.cost || '';
        }

        // Auto-fill expiry date if available
        const expiryInput = document.getElementById('stockInExpiryInput');
        if (expiryInput && !expiryInput.value && drug.expiry_date) {
            expiryInput.value = drug.expiry_date;
        }

        // Auto-fill lot if available
        const lotInput = document.getElementById('stockInLotInput');
        if (lotInput && !lotInput.value && drug.lot_number) {
            lotInput.value = drug.lot_number;
        }
    } else if (preview) {
        preview.style.display = 'none';
    }

    calcStockInTotal();
}

function calcStockInTotal() {
    const qty = parseInt(document.getElementById('stockInQtyInput')?.value || 0);
    const cost = parseFloat(document.getElementById('stockInCostInput')?.value || 0);
    const total = qty * cost;

    const totalEl = document.getElementById('stockInTotalCostDisplay');
    if (totalEl) totalEl.innerText = `฿${total.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const select = document.getElementById('stockInDrugSelect');
    const drugId = select ? select.value : null;
    const drug = allDrugs.find(d => Number(d.id) === Number(drugId));

    const newStockEl = document.getElementById('stockInNewStockDisplay');
    if (newStockEl) {
        if (drug && qty > 0) {
            newStockEl.innerText = `${drug.stock_qty + qty} ${drug.unit}`;
        } else {
            newStockEl.innerText = '-';
        }
    }
}

async function submitStockIn(e) {
    e.preventDefault();
    const select = document.getElementById('stockInDrugSelect');
    const drugId = select ? select.value : null;
    if (!drugId) {
        showToast('กรุณาเลือกรายการยาที่ต้องการรับเข้า', 'warning');
        return;
    }

    const qty = parseInt(document.getElementById('stockInQtyInput')?.value || 0);
    if (qty <= 0) {
        showToast('จำนวนรับเข้าต้องมากกว่า 0', 'warning');
        return;
    }

    const lotNumber = (document.getElementById('stockInLotInput')?.value || '').trim();
    const expiryDate = (document.getElementById('stockInExpiryInput')?.value || '').trim();
    const costPerUnit = parseFloat(document.getElementById('stockInCostInput')?.value || 0);
    const supplier = (document.getElementById('stockInSupplierInput')?.value || '').trim();
    const receivedBy = (document.getElementById('stockInReceivedByInput')?.value || '').trim();
    const notes = (document.getElementById('stockInNotesInput')?.value || '').trim();

    const btn = document.getElementById('btnSubmitStockIn');
    const origText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> กำลังบันทึก...';
        btn.disabled = true;
    }

    try {
        const res = await fetch('/api/stock-in', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                drug_id: drugId,
                quantity: qty,
                lot_number: lotNumber,
                expiry_date: expiryDate,
                cost_per_unit: costPerUnit,
                supplier: supplier,
                received_by: receivedBy,
                notes: notes
            })
        });

        const data = await res.json();
        if (data.ok) {
            showToast(`✅ ${data.message}`, 'success');
            closeStockInModal();
            loadDrugs();
            loadDashboardStats();
            if (currentTab === 'stockin') {
                loadStockInLogs();
            } else if (currentTab === 'analytics') {
                loadAnalytics();
            }
        } else {
            alert('ไม่สามารถรับเข้าสต็อกได้: ' + (data.error || 'Unknown error'));
        }
    } catch (err) {
        console.error('Submit Stock In error:', err);
        showToast('เกิดข้อผิดพลาดในการรับเข้าสต็อก', 'error');
    } finally {
        if (btn) {
            btn.innerHTML = origText;
            btn.disabled = false;
        }
    }
}

async function loadStockInLogs() {
    const tbody = document.getElementById('stockInTableBody');
    const cards = document.getElementById('stockInMobileCards');
    const dateFilter = document.getElementById('stockInDateFilter')?.value || '';

    let url = '/api/stock-in/logs?limit=100';
    if (dateFilter) url += `&date=${encodeURIComponent(dateFilter)}`;

    try {
        const res = await fetch(url);
        const data = await res.json();
        if (data.ok) {
            stockInLogsList = data.logs || [];
            renderStockInTable(stockInLogsList);
        }
    } catch (err) {
        console.error('Load Stock In Logs error:', err);
        if (tbody) tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--rose-600); padding: 1.5rem;">เกิดข้อผิดพลาดในการโหลดประวัติรับยา</td></tr>`;
    }
}

function renderStockInTable(logs) {
    const tbody = document.getElementById('stockInTableBody');
    const cards = document.getElementById('stockInMobileCards');
    const searchVal = (document.getElementById('stockInSearchInput')?.value || '').trim().toLowerCase();

    const filtered = logs.filter(l => {
        if (!searchVal) return true;
        return (
            (l.drug_name && l.drug_name.toLowerCase().includes(searchVal)) ||
            (l.drug_code && l.drug_code.toLowerCase().includes(searchVal)) ||
            (l.lot_number && l.lot_number.toLowerCase().includes(searchVal)) ||
            (l.supplier && l.supplier.toLowerCase().includes(searchVal)) ||
            (l.notes && l.notes.toLowerCase().includes(searchVal))
        );
    });

    if (tbody) {
        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: var(--text-muted); padding: 2.5rem;"><i class="fas fa-inbox" style="font-size: 2rem; margin-bottom: 0.5rem; display: block; opacity: 0.4;"></i>ยังไม่มีประวัติการรับยาเข้าสต็อก</td></tr>`;
        } else {
            tbody.innerHTML = filtered.map(l => {
                const drugImg = l.image_url || (typeof allDrugs !== 'undefined' && allDrugs.find(d => Number(d.id) === Number(l.drug_id) || (d.code && l.drug_code && d.code.trim().toUpperCase() === l.drug_code.trim().toUpperCase()))?.image_url);
                const thumbHtml = drugImg
                    ? `<div class="drug-table-thumb" onclick="openImageLightbox('${escapeHtml(drugImg)}', '${escapeHtml(l.drug_name)}', '${escapeHtml(l.drug_code || '')}')" title="คลิกดูภาพขยาย">
                         <img src="${escapeHtml(drugImg)}" alt="${escapeHtml(l.drug_name)}" loading="lazy" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'drug-table-thumb-fallback\\'><i class=\\'fas fa-pills\\'></i></div>';">
                       </div>`
                    : `<div class="drug-table-thumb-fallback" title="ยังไม่มีภาพยา"><i class="fas fa-pills"></i></div>`;

                return `
                    <tr>
                        <td class="col-thumb">
                            ${thumbHtml}
                        </td>
                        <td class="col-datetime">
                            <i class="far fa-clock" style="color: var(--text-muted); margin-right: 6px;"></i>${escapeHtml(l.created_at || '-')}
                        </td>
                        <td>
                            <div style="font-weight: 700; color: var(--text-primary); font-size: 0.925rem; line-height: 1.35;">${escapeHtml(l.drug_name)}</div>
                            <div style="display: flex; gap: 0.35rem; align-items: center; margin-top: 3px; flex-wrap: wrap;">
                                <span class="code-pill">${escapeHtml(l.drug_code || '-')}</span>
                                ${l.generic_name ? `<span style="font-size: 0.775rem; color: var(--text-muted);">(${escapeHtml(l.generic_name)})</span>` : ''}
                            </div>
                        </td>
                        <td>
                            ${l.lot_number ? `<span style="font-family: var(--font-mono); font-size: 0.775rem; background: var(--bg-subtle); padding: 0.2rem 0.5rem; border-radius: 4px; border: 1px solid var(--border-subtle);">${escapeHtml(l.lot_number)}</span>` : '<span style="color: var(--text-muted);">-</span>'}
                        </td>
                        <td>
                            <span class="badge badge-stockin"><i class="fas fa-arrow-down"></i> +${l.quantity}</span>
                        </td>
                        <td style="font-size: 0.85rem; color: var(--text-secondary); white-space: nowrap;">
                            ${l.balance_before} <i class="fas fa-arrow-right" style="font-size: 0.7rem; color: var(--text-muted); margin: 0 3px;"></i> <strong style="color: var(--brand-600);">${l.balance_after}</strong>
                        </td>
                        <td style="font-size: 0.85rem; color: var(--text-secondary);">
                            ${l.cost_per_unit ? `฿${parseFloat(l.cost_per_unit).toFixed(2)}` : '-'}
                        </td>
                        <td style="font-size: 0.875rem; font-weight: 700; color: #059669;">
                            ${l.total_cost ? `฿${parseFloat(l.total_cost).toLocaleString('th-TH', { minimumFractionDigits: 2 })}` : '-'}
                        </td>
                        <td style="font-size: 0.8125rem; color: var(--text-secondary);">
                            ${escapeHtml(l.supplier || '-')}
                        </td>
                        <td style="font-size: 0.8125rem; color: var(--text-muted);">
                            ${escapeHtml(l.expiry_date || '-')}
                        </td>
                        <td style="font-size: 0.8125rem; color: var(--text-secondary);">
                            <span style="font-weight: 600;">${escapeHtml(l.received_by || '-')}</span>
                            ${l.notes ? `<div style="font-size: 0.725rem; color: var(--text-muted); margin-top: 2px;"><i class="fas fa-note-sticky" style="font-size: 0.65rem;"></i> ${escapeHtml(l.notes)}</div>` : ''}
                        </td>
                    </tr>
                `;
            }).join('');
        }
    }

    if (cards) {
        if (filtered.length === 0) {
            cards.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 2rem;">ยังไม่มีรายการรับยาเข้า</div>`;
        } else {
            cards.innerHTML = filtered.map(l => {
                const drugImg = l.image_url || (typeof allDrugs !== 'undefined' && allDrugs.find(d => Number(d.id) === Number(l.drug_id) || (d.code && l.drug_code && d.code.trim().toUpperCase() === l.drug_code.trim().toUpperCase()))?.image_url);
                const mobileThumbHtml = drugImg
                    ? `<div class="drug-card-thumb" onclick="openImageLightbox('${escapeHtml(drugImg)}', '${escapeHtml(l.drug_name)}', '${escapeHtml(l.drug_code || '')}')" title="คลิกดูภาพขยาย" style="width: 44px; height: 44px; min-width: 44px; max-width: 44px; min-height: 44px; max-height: 44px; border-radius: 8px; overflow: hidden; display: flex; align-items: center; justify-content: center; background: var(--bg-subtle); border: 1px solid var(--border-default); cursor: pointer; flex-shrink: 0;">
                         <img src="${escapeHtml(drugImg)}" alt="${escapeHtml(l.drug_name)}" loading="lazy" style="width: 44px; height: 44px; object-fit: cover; border-radius: 7px;" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'drug-card-thumb-fallback\\' style=\\'width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:var(--bg-subtle);border:1px solid var(--border-subtle);color:var(--text-subtle);\\'><i class=\\'fas fa-pills\\'></i></div>';">
                       </div>`
                    : `<div class="drug-card-thumb-fallback" title="ยังไม่มีภาพยา" style="width: 44px; height: 44px; min-width: 44px; max-width: 44px; min-height: 44px; max-height: 44px; border-radius: 8px; display: flex; align-items: center; justify-content: center; background: var(--bg-subtle); border: 1px solid var(--border-subtle); color: var(--text-subtle); flex-shrink: 0;">
                         <i class="fas fa-pills"></i>
                       </div>`;

                return `
                    <div class="log-mobile-card">
                        <div style="display: flex; gap: 0.75rem; align-items: flex-start; margin-bottom: 0.5rem;">
                            ${mobileThumbHtml}
                            <div style="flex: 1; min-width: 0;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
                                    <span class="code-pill">${escapeHtml(l.drug_code || '-')}</span>
                                    <span class="badge badge-stockin">+${l.quantity} หน่วย</span>
                                </div>
                                <div style="font-weight: 700; font-size: 1rem; color: var(--text-primary); line-height: 1.35;">${escapeHtml(l.drug_name)}</div>
                                ${l.generic_name ? `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">${escapeHtml(l.generic_name)}</div>` : ''}
                            </div>
                        </div>
                        <div style="font-size: 0.8125rem; color: var(--text-secondary); margin-bottom: 0.5rem; display: flex; gap: 0.75rem; flex-wrap: wrap;">
                            <span>คงเหลือ: ${l.balance_before} ➔ <strong>${l.balance_after}</strong></span>
                            ${l.lot_number ? `<span>Lot: <code>${escapeHtml(l.lot_number)}</code></span>` : ''}
                            ${l.total_cost ? `<span>มูลค่า: <strong style="color: #059669;">฿${parseFloat(l.total_cost).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</strong></span>` : ''}
                        </div>
                        <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-muted); border-top: 1px solid var(--border-subtle); padding-top: 0.4rem;">
                            <span><i class="fas fa-truck"></i> ${escapeHtml(l.supplier || '-')}</span>
                            <span><i class="far fa-clock"></i> ${escapeHtml(l.created_at)}</span>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }
}

function clearStockInFilters() {
    const dateInput = document.getElementById('stockInDateFilter');
    if (dateInput) dateInput.value = '';
    const searchInput = document.getElementById('stockInSearchInput');
    if (searchInput) searchInput.value = '';
    loadStockInLogs();
}

function exportStockInExcel() {
    const dateVal = document.getElementById('stockInDateFilter')?.value || '';
    const params = new URLSearchParams();
    if (dateVal) params.set('date', dateVal);

    const link = document.createElement('a');
    link.href = `/api/export/stock-in?${params.toString()}`;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('📥 กำลังดาวน์โหลด Excel ประวัติการรับยาเข้า…', 'success');
}

// ─────────────────────────────────────────────────────────────
// 📊 Visual Analytics & Chart.js Data Visualization
// ─────────────────────────────────────────────────────────────

let chartWeeklyTrendInstance = null;
let chartTopDispensedInstance = null;
let chartCategoryInstance = null;
let chartExpiryRiskInstance = null;

async function loadAnalytics() {
    try {
        const res = await fetch('/api/analytics/summary');
        const data = await res.json();
        if (data.ok && data.analytics) {
            renderAnalyticsCharts(data.analytics);
        }
    } catch (err) {
        console.error('Load Analytics Error:', err);
    }
}

function renderAnalyticsCharts(analytics) {
    if (!analytics) return;

    // 1. Valuation KPIs
    const val = analytics.valuation || {};
    const retailValEl = document.getElementById('analyticsRetailVal');
    if (retailValEl) retailValEl.innerText = `฿${(val.retail_value || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const costValEl = document.getElementById('analyticsCostVal');
    if (costValEl) costValEl.innerText = `฿${(val.cost_value || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const marginValEl = document.getElementById('analyticsMarginVal');
    if (marginValEl) marginValEl.innerText = `฿${(val.potential_margin || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const marginPercentEl = document.getElementById('analyticsMarginPercent');
    if (marginPercentEl) {
        const retail = val.retail_value || 0;
        const margin = val.potential_margin || 0;
        const pct = retail > 0 ? ((margin / retail) * 100).toFixed(1) : 0;
        marginPercentEl.innerText = `มาร์จิ้นประมาณการ: ${pct}% (จากมูลค่าขาย)`;
    }

    // 7-day Activity Total
    const weekly = analytics.weekly_trend || { labels: [], dispensed: [], received: [] };
    const totalDisp7d = (weekly.dispensed || []).reduce((a, b) => a + b, 0);
    const totalRec7d = (weekly.received || []).reduce((a, b) => a + b, 0);
    const actEl = document.getElementById('analytics7dActivity');
    if (actEl) actEl.innerText = `+${totalRec7d} / -${totalDisp7d}`;

    if (typeof Chart === 'undefined') {
        console.warn('Chart.js library is not loaded');
        return;
    }

    // Set common font
    Chart.defaults.font.family = "'Anuphan', 'IBM Plex Sans Thai', 'Inter', sans-serif";
    Chart.defaults.color = document.documentElement.getAttribute('data-theme') === 'dark' ? '#94A3B8' : '#64748B';

    // -------------------------------------------------------------
    // Chart 1: 7-Day Trend (In vs Out Grouped Bar)
    // -------------------------------------------------------------
    const ctxWeekly = document.getElementById('chartWeeklyTrendCanvas');
    if (ctxWeekly) {
        if (chartWeeklyTrendInstance) chartWeeklyTrendInstance.destroy();
        chartWeeklyTrendInstance = new Chart(ctxWeekly, {
            type: 'bar',
            data: {
                labels: weekly.labels || [],
                datasets: [
                    {
                        label: 'รับเข้าสต็อก (Stock In)',
                        data: weekly.received || [],
                        backgroundColor: 'rgba(16, 185, 129, 0.85)',
                        borderColor: '#10B981',
                        borderWidth: 1.5,
                        borderRadius: 6,
                        barPercentage: 0.7,
                        categoryPercentage: 0.6
                    },
                    {
                        label: 'ตัดสต็อกจ่าย (Dispensed)',
                        data: weekly.dispensed || [],
                        backgroundColor: 'rgba(239, 68, 68, 0.85)',
                        borderColor: '#EF4444',
                        borderWidth: 1.5,
                        borderRadius: 6,
                        barPercentage: 0.7,
                        categoryPercentage: 0.6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { boxWidth: 12, font: { size: 12, weight: '600' } }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ` ${ctx.dataset.label}: ${ctx.raw} หน่วย`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { precision: 0 }
                    }
                }
            }
        });
    }

    // -------------------------------------------------------------
    // Chart 2: Top Dispensed Drugs (Horizontal Bar)
    // -------------------------------------------------------------
    const ctxTop = document.getElementById('chartTopDispensedCanvas');
    if (ctxTop) {
        if (chartTopDispensedInstance) chartTopDispensedInstance.destroy();
        const topDrugs = analytics.top_dispensed || [];
        chartTopDispensedInstance = new Chart(ctxTop, {
            type: 'bar',
            data: {
                labels: topDrugs.map(d => d.drug_name.length > 22 ? d.drug_name.slice(0, 22) + '...' : d.drug_name),
                datasets: [{
                    label: 'จำนวนหน่วยที่เบิกจ่าย',
                    data: topDrugs.map(d => d.total_qty),
                    backgroundColor: [
                        'rgba(37, 99, 235, 0.85)',
                        'rgba(13, 148, 136, 0.85)',
                        'rgba(16, 185, 129, 0.85)',
                        'rgba(245, 158, 11, 0.85)',
                        'rgba(139, 92, 246, 0.85)',
                        'rgba(244, 63, 94, 0.85)'
                    ],
                    borderRadius: 6
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ` จ่ายไปแล้ว: ${ctx.raw} หน่วย`
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: { precision: 0 }
                    }
                }
            }
        });
    }

    // -------------------------------------------------------------
    // Chart 3: Category Breakdown (Doughnut)
    // -------------------------------------------------------------
    const ctxCat = document.getElementById('chartCategoryCanvas');
    if (ctxCat) {
        if (chartCategoryInstance) chartCategoryInstance.destroy();
        const cats = analytics.categories || [];
        chartCategoryInstance = new Chart(ctxCat, {
            type: 'doughnut',
            data: {
                labels: cats.map(c => c.category || 'ทั่วไป'),
                datasets: [{
                    data: cats.map(c => c.units),
                    backgroundColor: [
                        '#2563EB', '#0D9488', '#10B981', '#F59E0B', 
                        '#8B5CF6', '#EC4899', '#6366F1', '#14B8A6'
                    ],
                    borderWidth: 2,
                    hoverOffset: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: { boxWidth: 12, font: { size: 11 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ` ${ctx.label}: ${ctx.raw} หน่วย`
                        }
                    }
                },
                cutout: '62%'
            }
        });
    }

    // -------------------------------------------------------------
    // Chart 4: Expiry Health Matrix (Doughnut)
    // -------------------------------------------------------------
    const ctxExp = document.getElementById('chartExpiryRiskCanvas');
    if (ctxExp) {
        if (chartExpiryRiskInstance) chartExpiryRiskInstance.destroy();
        const exp = analytics.expiry_distribution || { expired: 0, critical_30d: 0, warning_60d: 0, safe: 0 };
        chartExpiryRiskInstance = new Chart(ctxExp, {
            type: 'doughnut',
            data: {
                labels: [
                    `หมดอายุแล้ว (${exp.expired})`,
                    `วิกฤต <= 30 วัน (${exp.critical_30d})`,
                    `เตือน 31-60 วัน (${exp.warning_60d})`,
                    `ปลอดภัย > 60 วัน (${exp.safe})`
                ],
                datasets: [{
                    data: [exp.expired, exp.critical_30d, exp.warning_60d, exp.safe],
                    backgroundColor: [
                        '#EF4444', // Expired
                        '#F43F5E', // Critical <= 30d
                        '#F59E0B', // Warning <= 60d
                        '#10B981'  // Safe
                    ],
                    borderWidth: 2,
                    hoverOffset: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: { boxWidth: 12, font: { size: 11 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ` ${ctx.label}`
                        }
                    }
                },
                cutout: '62%'
            }
        });
    }
}

// ==========================================================================
// 📱 PWA / APK INSTALLATION LOGIC
// ==========================================================================
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const btn = document.getElementById('btnInstallApk');
    if (btn) {
        btn.classList.add('has-prompt');
    }
    const installActionBtn = document.getElementById('btnTriggerPwaInstall');
    if (installActionBtn) {
        installActionBtn.innerHTML = '<i class="fas fa-download"></i> ติดตั้งแอปลงเครื่องทันที (1-Click Install)';
    }
});

window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    showToast('ติดตั้งแอป PharmaCore สำเร็จเรียบร้อย!', 'success');
    closeApkInstallModal();
});

// Register PWA Service Worker (Clean State)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => {
                reg.update();
                console.log('✅ ServiceWorker active:', reg.scope);
            })
            .catch(err => console.warn('ServiceWorker registration error:', err));
    });
}

function openApkInstallModal() {
    const modal = document.getElementById('apkInstallModal');
    if (!modal) return;

    // Generate QR Code if not already generated
    const qrBox = document.getElementById('apkQrCodeContainer');
    if (qrBox && qrBox.children.length === 0) {
        const publicUrl = window.location.origin;
        try {
            new QRCode(qrBox, {
                text: publicUrl,
                width: 124,
                height: 124,
                colorDark: "#0f172a",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.M
            });
        } catch (e) {
            console.error('QR code generation error:', e);
        }
        const urlInput = document.getElementById('apkShareUrlInput');
        if (urlInput) urlInput.value = publicUrl;
    }

    modal.classList.add('active');
}

function closeApkInstallModal() {
    const modal = document.getElementById('apkInstallModal');
    if (modal) modal.classList.remove('active');
}

function triggerPwaInstall() {
    if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        deferredInstallPrompt.userChoice.then((choice) => {
            if (choice.outcome === 'accepted') {
                showToast('กำลังติดตั้งแอป PharmaCore...', 'success');
            }
            deferredInstallPrompt = null;
        });
    } else {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        if (isIOS) {
            showToast('บน iPhone: แตะปุ่มแชร์ (Share) ➔ เลือก "เพิ่มไปยังหน้าจอโฮม"', 'info');
        } else {
            showToast('บน Android: แตะปุ่มจุดสามจุด (⋮) ➔ เลือก "ติดตั้งแอป" หรือ "เพิ่มลงในหน้าจอหลัก"', 'info');
        }
    }
}

function copyApkShareUrl() {
    const input = document.getElementById('apkShareUrlInput');
    const url = input ? input.value : window.location.origin;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
            showToast('คัดลอกลิงก์ติดตั้งเรียบร้อย!', 'success');
        }).catch(() => {
            showToast('ลิงก์: ' + url, 'info');
        });
    } else {
        showToast('ลิงก์: ' + url, 'info');
    }
}

// Auto open install modal if URL has ?install=apk
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('install') === 'apk') {
        setTimeout(openApkInstallModal, 600);
    }
});


