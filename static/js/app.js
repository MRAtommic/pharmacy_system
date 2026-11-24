/**
 * 🏥 Pharmacy Stock Management System - Frontend App
 * Dynamic reactive UI with Light/Dark Mode, QR Scanner, CRUD, and Dispensing Flow.
 */

// Auto-detect base path if mounted under /pharmacy or custom prefix
const PHARMACY_BASE = (typeof window !== 'undefined' && window.PHARMACY_BASE !== undefined) 
    ? window.PHARMACY_BASE 
    : (typeof window !== 'undefined' && window.location.pathname.startsWith('/pharmacy') ? '/pharmacy' : '');

if (PHARMACY_BASE && typeof window !== 'undefined' && window.fetch) {
    const _originalFetch = window.fetch;
    window.fetch = function(url, options) {
        if (typeof url === 'string' && url.startsWith('/api/')) {
            url = PHARMACY_BASE + url;
        }
        return _originalFetch.call(this, url, options);
    };
}

let allDrugs = [];
let allDispenseLogs = [];
let currentTab = 'inventory';
let html5QrScanner = null;
let selectedDrugForDispense = null;

// Universal Pagination Engine (Tabs 1 2 3... & Controls)
const paginationState = {
    drugs: { currentPage: 1, pageSize: 10 },
    logs: { currentPage: 1, pageSize: 10 },
    stockIn: { currentPage: 1, pageSize: 10 }
};

// Precise Quantity Formatter: Displays exact numbers without unwanted rounding or truncation
// "≈ 10.62 กล่อง" for drugs that have a pack size
function packApprox(d) {
    const ps = Number(d && d.pack_size);
    if (!(ps > 1)) return '';
    const n = Math.round((Number(d.stock_qty) || 0) / ps * 100) / 100;
    return `<span class="stock-qty-unit">≈ ${formatQty(n)} ${escapeHtml(d.pack_unit || 'กล่อง')}</span>`;
}

function formatQty(qty) {
    if (qty === null || qty === undefined || qty === '' || isNaN(qty)) return '0';
    const num = Number(qty);
    if (Number.isInteger(num)) {
        return num.toLocaleString('th-TH');
    }
    return num.toLocaleString('th-TH', { maximumFractionDigits: 6 });
}

function changePage(targetKey, page) {
    if (!paginationState[targetKey]) return;
    paginationState[targetKey].currentPage = page;
    if (targetKey === 'drugs') {
        renderDrugsTable(allDrugs);
    } else if (targetKey === 'logs') {
        renderLogsTable(allDispenseLogs);
    } else if (targetKey === 'stockIn') {
        renderStockInTable(stockInLogsList);
    }

    const isMobile = window.innerWidth <= 768;
    const desktopMap = {
        drugs: '#view-inventory .table-wrapper',
        logs: '#view-logs .table-wrapper',
        stockIn: '#view-stockin .table-wrapper'
    };
    const mobileMap = {
        drugs: '#drugsMobileCards',
        logs: '#logsMobileCards',
        stockIn: '#stockInMobileCards'
    };
    const selector = isMobile ? (mobileMap[targetKey] || '#drugsMobileCards') : (desktopMap[targetKey] || '.table-wrapper');
    const el = document.querySelector(selector);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function changePageSize(targetKey, size) {
    if (!paginationState[targetKey]) return;
    const newSize = parseInt(size, 10) || 10;
    paginationState[targetKey].pageSize = newSize;
    paginationState[targetKey].currentPage = 1;
    if (targetKey === 'drugs') {
        renderDrugsTable(allDrugs);
    } else if (targetKey === 'logs') {
        renderLogsTable(allDispenseLogs);
    } else if (targetKey === 'stockIn') {
        renderStockInTable(stockInLogsList);
    }
}

function renderPaginationBar(containerId, targetKey, totalItems) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!totalItems || totalItems <= 0) {
        container.innerHTML = '';
        return;
    }

    const state = paginationState[targetKey];
    const pageSize = state.pageSize || 10;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

    if (state.currentPage > totalPages) state.currentPage = totalPages;
    if (state.currentPage < 1) state.currentPage = 1;
    const curPage = state.currentPage;

    const startItem = (curPage - 1) * pageSize + 1;
    const endItem = Math.min(totalItems, curPage * pageSize);

    // Smart windowing: 1, 2, 3 ... totalPages
    const pageButtons = [];
    if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) pageButtons.push(i);
    } else {
        pageButtons.push(1);
        if (curPage > 3) {
            pageButtons.push('...');
        }
        const startMid = Math.max(2, curPage - 1);
        const endMid = Math.min(totalPages - 1, curPage + 1);
        for (let i = startMid; i <= endMid; i++) {
            if (!pageButtons.includes(i)) pageButtons.push(i);
        }
        if (curPage < totalPages - 2) {
            pageButtons.push('...');
        }
        if (!pageButtons.includes(totalPages)) {
            pageButtons.push(totalPages);
        }
    }

    const buttonsHtml = pageButtons.map(p => {
        if (p === '...') {
            return `<span class="page-dots">…</span>`;
        }
        const isActive = p === curPage ? 'active' : '';
        return `<button type="button" class="page-btn ${isActive}" onclick="changePage('${targetKey}', ${p})">${p}</button>`;
    }).join('');

    container.innerHTML = `
        <div class="pharmacy-pagination">
            <div class="pagination-header-row">
                <div class="pagination-status-pill">
                    <span class="pagination-page-pill">หน้า <strong>${curPage}</strong>/${totalPages}</span>
                    <span class="pagination-count-text">แสดง <strong>${startItem} - ${endItem}</strong> จาก <strong>${totalItems}</strong> รายการ</span>
                </div>
                <div class="pagination-size-wrapper">
                    <label class="pagination-size-label">แสดงหน้าละ:</label>
                    <select class="form-select pagination-size-select" onchange="changePageSize('${targetKey}', this.value)" aria-label="จำนวนรายการต่อหน้า">
                        <option value="10" ${pageSize === 10 ? 'selected' : ''}>10</option>
                        <option value="25" ${pageSize === 25 ? 'selected' : ''}>25</option>
                        <option value="50" ${pageSize === 50 ? 'selected' : ''}>50</option>
                        <option value="100" ${pageSize === 100 ? 'selected' : ''}>100</option>
                    </select>
                </div>
            </div>

            <div class="pagination-nav-row">
                <div class="pagination-buttons">
                    <button type="button" class="page-btn page-nav page-nav-edge" title="หน้าแรก" onclick="changePage('${targetKey}', 1)" ${curPage === 1 ? 'disabled' : ''}>
                        <i class="fas fa-angles-left"></i>
                    </button>
                    <button type="button" class="page-btn page-nav" title="หน้าก่อนหน้า" onclick="changePage('${targetKey}', ${curPage - 1})" ${curPage === 1 ? 'disabled' : ''}>
                        <i class="fas fa-chevron-left"></i>
                    </button>
                    ${buttonsHtml}
                    <button type="button" class="page-btn page-nav" title="หน้าถัดไป" onclick="changePage('${targetKey}', ${curPage + 1})" ${curPage === totalPages ? 'disabled' : ''}>
                        <i class="fas fa-chevron-right"></i>
                    </button>
                    <button type="button" class="page-btn page-nav page-nav-edge" title="หน้าสุดท้าย" onclick="changePage('${targetKey}', ${totalPages})" ${curPage === totalPages ? 'disabled' : ''}>
                        <i class="fas fa-angles-right"></i>
                    </button>
                </div>
            </div>
        </div>
    `;
}

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    loadDashboardStats();
    loadCategories();
    loadDrugs();
    loadDispensingLogs();
    setupEventListeners();

    // Check if opened via scanned URL query param: ?scan=MED-0001 or ?dispense=MED-0001
    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get('tab');
    if (tabParam) {
        setTimeout(() => switchTab(tabParam), 300);
    }
    const modalParam = urlParams.get('modal');
    if (modalParam === 'sticker') {
        setTimeout(() => openBatchPrintModal(), 600);
    }
    const codeParam = urlParams.get('scan') || urlParams.get('dispense');
    const lotParam = urlParams.get('lot');
    if (codeParam) {
        setTimeout(() => handleScannedCode(lotParam ? `${codeParam}#${lotParam}` : codeParam), 600);
    }

    // Check Google OAuth redirect result
    const googleConnected = urlParams.get('google_connected');
    const googleEmail = urlParams.get('email');
    const googleError = urlParams.get('google_error');

    if (googleConnected) {
        setTimeout(() => {
            showToast(`เชื่อมต่อ Google สำเร็จแล้ว (${googleEmail || 'Google Account'})`, 'success');
            openGoogleSettingsModal();
        }, 500);
        window.history.replaceState({}, document.title, window.location.pathname);
    } else if (googleError) {
        setTimeout(() => {
            showToast(`เกิดข้อผิดพลาดในการเชื่อมต่อ Google: ${googleError}`, 'error');
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
        themeText.innerText = theme === 'dark' ? 'โหมดสว่าง' : 'โหมดมืด';
    }
    if (typeof currentTab !== 'undefined' && currentTab === 'analytics' && typeof loadAnalytics === 'function') {
        loadAnalytics();
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
            
            const drugsEl = document.getElementById('statTotalDrugs');
            if (drugsEl) {
                drugsEl.innerText = s.total_drugs || 0;
                drugsEl.className = 'stat-tile-num kpi-value';
            }

            const lowCount = Number(s.low_stock_count || 0);
            const lowEl = document.getElementById('statLowStock');
            if (lowEl) {
                lowEl.innerText = lowCount;
                lowEl.className = lowCount > 0 ? 'stat-tile-num kpi-value text-rose' : 'stat-tile-num kpi-value';
            }

            const expCount = Number(s.expiring_soon_count || 0);
            const expSoonEl = document.getElementById('statExpiringSoon');
            if (expSoonEl) {
                expSoonEl.innerText = expCount;
                expSoonEl.className = expCount > 0 ? 'stat-tile-num kpi-value text-amber' : 'stat-tile-num kpi-value';
            }

            const lowCard = document.getElementById('kpiCardLowStock');
            if (lowCard) {
                lowCard.classList.toggle('has-alerts', lowCount > 0);
            }

            const expCard = document.getElementById('kpiCardExpiring');
            if (expCard) {
                expCard.classList.toggle('has-alerts', expCount > 0);
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
    const paginationWrapper = document.getElementById('drugsPaginationWrapper');

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
        if (paginationWrapper) paginationWrapper.innerHTML = '';
        return;
    }

    const state = paginationState.drugs;
    const totalItems = drugs.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / state.pageSize));
    if (state.currentPage > totalPages) state.currentPage = totalPages;
    if (state.currentPage < 1) state.currentPage = 1;

    const startIdx = (state.currentPage - 1) * state.pageSize;
    const pagedDrugs = drugs.slice(startIdx, startIdx + state.pageSize);

    if (tbody) {
        tbody.innerHTML = pagedDrugs.map(d => {
            const isLow = d.stock_qty <= d.min_threshold;
            const isExpiringSoon = d.is_expiring_soon || (d.days_left !== null && d.days_left !== undefined && d.days_left <= 60);
            const isExpired = d.is_expired;

            let rowClass = 'class="clinical-row"';
            if (isExpired) rowClass = 'class="clinical-row row-expired"';
            else if (isLow) rowClass = 'class="clinical-row row-low-stock"';
            else if (isExpiringSoon) rowClass = 'class="clinical-row row-expiring"';

            // Plain wording, no money values / icons: the row should be readable at a glance
            let stockHtml = '';
            if (d.stock_qty <= 0) {
                stockHtml = `<div class="stock-cell is-out"><span class="stock-qty-number">0</span><span class="stock-flag">หมดสต็อก</span></div>`;
            } else if (isLow) {
                stockHtml = `<div class="stock-cell is-low" title="ต่ำกว่าจุดเตือน ${formatQty(d.min_threshold)} ${escapeHtml(d.unit)}"><span class="stock-qty-number">${formatQty(d.stock_qty)}</span><span class="stock-qty-unit">${escapeHtml(d.unit)}</span>${packApprox(d)}<span class="stock-flag">ใกล้หมด</span></div>`;
            } else {
                stockHtml = `<div class="stock-cell"><span class="stock-qty-number">${formatQty(d.stock_qty)}</span><span class="stock-qty-unit">${escapeHtml(d.unit)}</span>${packApprox(d)}</div>`;
            }

            let expiryHtml = `<span class="expiry-empty">-</span>`;
            if (isExpired) {
                expiryHtml = `<span class="expiry-text is-expired" title="${escapeHtml(d.expiry_date)}">หมดอายุแล้ว</span>`;
            } else if (isExpiringSoon) {
                expiryHtml = `<span class="expiry-text is-soon" title="${escapeHtml(d.expiry_date)}">อีก ${d.days_left} วัน</span>`;
            } else if (d.expiry_date) {
                expiryHtml = `<span class="expiry-text">${escapeHtml(d.expiry_date)}</span>`;
            }

            const thumbHtml = d.image_url
                ? `<div class="drug-table-thumb" onclick="openImageLightbox('${escapeHtml(d.image_url)}', '${escapeHtml(d.name)}', '${escapeHtml(d.code)}')" title="คลิกดูภาพขยาย">
                     <img src="${escapeHtml(d.image_url)}" alt="${escapeHtml(d.name)}" loading="lazy" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'drug-table-thumb-fallback\\'><i class=\\'fas fa-pills\\'></i></div>';">
                   </div>`
                : `<div class="drug-table-thumb-fallback" title="ยังไม่มีภาพยา"><i class="fas fa-pills"></i></div>`;

            const lots = d.lots || [];
            const lotCount = d.lot_count !== undefined ? d.lot_count : lots.length;

            const lotBadgeHtml = `
                <div style="margin-top: 3px;">
                    <button type="button" class="btn-lot-badge" id="btn-lot-toggle-${d.id}" onclick="toggleDrugLotsSubrow(${d.id}, event)" title="คลิกเพื่อคลี่ดูและจัดการ ${lotCount} ล็อตย่อย">
                        <span>${lotCount} ล็อต</span> <i class="fas fa-chevron-down lot-chevron" id="lot-chevron-${d.id}"></i>
                    </button>
                </div>
            `;

            const inCart = (typeof isInRxCart === 'function' && isInRxCart(d.id));

            return `
                <tr ${rowClass} id="drug-row-${d.id}">
                    <td class="col-thumb">
                        ${thumbHtml}
                    </td>
                    <td>
                        <div class="drug-name-cell">
                            <span class="drug-trade-name">${escapeHtml(d.name)}</span>
                            <span class="drug-generic-name">${escapeHtml(d.code)}${d.generic_name && d.generic_name !== d.name ? ' · ' + escapeHtml(d.generic_name) : ''}</span>
                        </div>
                    </td>
                    <td>
                        ${stockHtml}
                    </td>
                    <td>
                        ${expiryHtml}
                        ${lotBadgeHtml}
                    </td>
                    <td style="text-align: right;">
                        <div class="table-actions-cluster">
                            <button type="button" class="btn-action-cart ${inCart ? 'in-cart' : ''}" title="${inCart ? 'อยู่ในใบสั่งยาแล้ว' : 'เพิ่มลงในใบสั่งยา'}" onclick="addToRxCart(${d.id}); event.stopPropagation();">
                                <span>${inCart ? '<i class="fas fa-check"></i> ในใบสั่ง' : 'สั่งยา'}</span>
                            </button>
                            <button type="button" class="btn-action-dispense" title="ตัดจ่ายยานี้ทันที" onclick="openDispenseModalForDrug(${d.id})">
                                <span>ตัดสต็อก</span>
                            </button>
                            <div class="row-action-dropdown" id="dropdown-${d.id}">
                                <button type="button" class="dropdown-toggle" title="เมนูอื่น ๆ" onclick="toggleRowDropdown(${d.id}, event)">
                                    <i class="fas fa-ellipsis-vertical"></i>
                                </button>
                                <div class="dropdown-menu" id="dropdown-menu-${d.id}">
                                    <button type="button" class="dropdown-item" onclick="openStockInModal(${d.id}); closeAllDropdowns();">รับยาเข้า</button>
                                    <a href="/stock-card?drug_id=${d.id}${(new URLSearchParams(window.location.search).get('code') ? '&code=' + encodeURIComponent(new URLSearchParams(window.location.search).get('code')) : '')}" target="_blank" class="dropdown-item" onclick="closeAllDropdowns();" style="text-decoration: none; color: inherit; display: flex; align-items: center; gap: 0.5rem; width: 100%; box-sizing: border-box;">สต็อกการ์ด</a>
                                    <button type="button" class="dropdown-item" onclick="openQrModal(${d.id}); closeAllDropdowns();">พิมพ์ QR</button>
                                    <button type="button" class="dropdown-item" onclick="openEditDrugModal(${d.id}); closeAllDropdowns();">แก้ไข</button>
                                    <div class="dropdown-divider"></div>
                                    <button type="button" class="dropdown-item danger" onclick="confirmDeleteDrug(${d.id}); closeAllDropdowns();">ลบ</button>
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>
                <tr id="lots-subrow-${d.id}" class="drug-lots-subrow" style="display: none;">
                    <td colspan="5" style="padding: 0;">
                        <div class="drug-lots-panel">
                            <div class="drug-lots-header">
                                <div class="drug-lots-title">
                                    <span>ล็อตของ <strong>${escapeHtml(d.name)}</strong> (${lots.length} ล็อต)</span>
                                </div>
                                <div>
                                    <button type="button" class="btn-lot-action-sm emerald" onclick="openStockInModal(${d.id});" title="รับยาเข้าและสร้างล็อตใหม่">
                                        เพิ่มล็อต
                                    </button>
                                </div>
                            </div>
                            ${renderLotsSubtable(d, lots)}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    if (cardsContainer) {
        cardsContainer.innerHTML = pagedDrugs.map(d => {
            const isLow = d.stock_qty <= d.min_threshold;
            const isExpiringSoon = d.is_expiring_soon || (d.days_left !== null && d.days_left !== undefined && d.days_left <= 60);
            const isExpired = d.is_expired;

            const mobileThumbHtml = d.image_url
                ? `<div class="drug-card-thumb" onclick="openImageLightbox('${escapeHtml(d.image_url)}', '${escapeHtml(d.name)}', '${escapeHtml(d.code)}')" title="คลิกดูภาพขยาย">
                     <img src="${escapeHtml(d.image_url)}" alt="${escapeHtml(d.name)}" loading="lazy" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'drug-card-thumb-fallback\\'><i class=\\'fas fa-pills\\'></i></div>';">
                   </div>`
                : `<div class="drug-card-thumb-fallback" title="ยังไม่มีภาพยา"><i class="fas fa-pills"></i></div>`;

            const inCart = (typeof isInRxCart === 'function' && isInRxCart(d.id));
            const lots = d.lots || [];
            const lotCount = d.lot_count !== undefined ? d.lot_count : lots.length;

            return `
                <div class="drug-mobile-card ${isExpired ? 'card-expired' : isLow ? 'card-low-stock' : isExpiringSoon ? 'card-expiring' : ''}">
                    <div class="mobile-card-body">
                        ${mobileThumbHtml}
                        <div class="mobile-card-info">
                            <div class="mobile-drug-name">${escapeHtml(d.name)}</div>
                            <div class="mobile-drug-generic">${escapeHtml(d.code)}${d.generic_name && d.generic_name !== d.name ? ' · ' + escapeHtml(d.generic_name) : ''}</div>
                            <div class="stock-cell ${d.stock_qty <= 0 ? 'is-out' : isLow ? 'is-low' : ''}" style="margin-top: 0.35rem;">
                                <span class="stock-qty-number">${formatQty(d.stock_qty)}</span>
                                <span class="stock-qty-unit">${escapeHtml(d.unit)}</span>
                                ${packApprox(d)}
                                ${d.stock_qty <= 0 ? '<span class="stock-flag">หมดสต็อก</span>' : isLow ? '<span class="stock-flag">ใกล้หมด</span>' : ''}
                            </div>
                            <div class="mobile-card-meta" style="margin-top: 0.15rem;">
                                ${isExpired ? '<span class="expiry-text is-expired">หมดอายุแล้ว</span>'
                                  : isExpiringSoon ? `<span class="expiry-text is-soon">อีก ${d.days_left} วัน</span>`
                                  : d.expiry_date ? `<span class="expiry-text">${escapeHtml(d.expiry_date)}</span>` : ''}
                                <button type="button" class="btn-lot-badge" onclick="toggleDrugLotsCard(${d.id}, event)">
                                    <span>${lotCount} ล็อต</span> <i class="fas fa-chevron-down lot-chevron" id="mobile-lot-chevron-${d.id}"></i>
                                </button>
                            </div>
                        </div>
                    </div>

                    <div class="mobile-card-actions">
                        <button type="button" class="btn-action-cart ${inCart ? 'in-cart' : ''}" onclick="addToRxCart(${d.id})">
                            <span>${inCart ? '<i class="fas fa-check"></i> ในใบสั่ง' : 'สั่งยา'}</span>
                        </button>
                        <button type="button" class="btn-action-dispense" onclick="openDispenseModalForDrug(${d.id})">
                            <span>ตัดสต็อก</span>
                        </button>
                        <div class="row-action-dropdown" id="dropdown-m-${d.id}">
                            <button type="button" class="dropdown-toggle" title="เมนูอื่น ๆ" onclick="toggleRowDropdown('m-${d.id}', event)">
                                <i class="fas fa-ellipsis-vertical"></i>
                            </button>
                            <div class="dropdown-menu" id="dropdown-menu-m-${d.id}">
                                <button type="button" class="dropdown-item" onclick="openStockInModal(${d.id}); closeAllDropdowns();">รับยาเข้า</button>
                                <a href="/stock-card?drug_id=${d.id}${(new URLSearchParams(window.location.search).get('code') ? '&code=' + encodeURIComponent(new URLSearchParams(window.location.search).get('code')) : '')}" target="_blank" class="dropdown-item" onclick="closeAllDropdowns();" style="text-decoration: none; color: inherit; display: flex; align-items: center; gap: 0.5rem; width: 100%; box-sizing: border-box;">สต็อกการ์ด</a>
                                <button type="button" class="dropdown-item" onclick="openQrModal(${d.id}); closeAllDropdowns();">พิมพ์ QR</button>
                                <button type="button" class="dropdown-item" onclick="openEditDrugModal(${d.id}); closeAllDropdowns();">แก้ไข</button>
                                <div class="dropdown-divider"></div>
                                <button type="button" class="dropdown-item danger" onclick="confirmDeleteDrug(${d.id}); closeAllDropdowns();">ลบ</button>
                            </div>
                        </div>
                    </div>

                    <div id="mobile-lots-panel-${d.id}" class="drug-lots-card-panel" style="display: none;">
                        <div style="font-size: 0.8rem; font-weight: 700; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center;">
                            <span><i class="fas fa-layer-group" style="color: var(--teal-600);"></i> ล็อตย่อย (${lots.length})</span>
                            <button type="button" class="btn-lot-action-sm emerald" onclick="openStockInModal(${d.id});" style="font-size: 0.7rem; padding: 2px 6px;">
                                <i class="fas fa-plus"></i> เพิ่มล็อต
                            </button>
                        </div>
                        ${lots.length === 0 ? `<div style="text-align: center; color: var(--text-muted); font-size: 0.75rem; padding: 0.5rem;">ยังไม่มีข้อมูลล็อต</div>` :
                          lots.map((lot, idx) => `
                            <div class="lot-mobile-item">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.3rem;">
                                    <span class="lot-code-pill">${escapeHtml(lot.lot_number)}</span>
                                    <span style="font-size: 0.8rem; font-weight: 700; color: ${lot.stock_qty <= 0 ? 'var(--rose-600)' : 'var(--text-primary)'};">
                                        ${formatQty(lot.stock_qty)} ${escapeHtml(d.unit)}
                                    </span>
                                </div>
                                <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.4rem; display: flex; gap: 0.35rem; align-items: center; flex-wrap: wrap;">
                                    <span>EXP: ${escapeHtml(lot.expiry_date || '-')}</span>
                                    ${idx === 0 && lot.stock_qty > 0 ? `<span class="lot-fefo-pill"><i class="fas fa-shield-halved"></i> FEFO</span>` : ''}
                                </div>
                                <div style="display: flex; gap: 0.35rem; justify-content: flex-end; flex-wrap: wrap;">
                                    <button type="button" class="btn-lot-action-sm primary" onclick="openLotQrModal(${d.id}, ${lot.id})">
                                        <i class="fas fa-qrcode"></i> QR
                                    </button>
                                    <button type="button" class="btn-lot-action-sm" onclick="openLotStickerModal(${d.id}, ${lot.id})">
                                        <i class="fas fa-print"></i> ฉลาก
                                    </button>
                                    <button type="button" class="btn-lot-action-sm amber" onclick="openEditLotModal(${d.id}, ${lot.id}, event)">
                                        <i class="fas fa-sliders"></i> ตั้งค่าล็อต
                                    </button>
                                    <button type="button" class="btn-lot-action-sm danger" onclick="openDispenseModalForDrug(${d.id}, 'WEB_MANUAL', ${lot.id})" ${lot.stock_qty <= 0 ? 'disabled style="opacity:0.5;"' : ''}>
                                        <i class="fas fa-minus"></i> ตัดล็อตนี้
                                    </button>
                                </div>
                            </div>
                          `).join('')}
                    </div>
                </div>
            `;
        }).join('');
    }

    renderPaginationBar('drugsPaginationWrapper', 'drugs', totalItems);
}

function renderLotsSubtable(drug, lots) {
    if (!lots || lots.length === 0) {
        return `
            <div style="padding: 1.25rem; text-align: center; color: var(--text-muted); font-size: 0.85rem; background: var(--bg-surface); border-radius: var(--radius-md); border: 1px dashed var(--border-default);">
                <i class="fas fa-inbox" style="font-size: 1.4rem; color: var(--text-subtle); display: block; margin-bottom: 0.35rem;"></i>
                ยังไม่มีข้อมูลล็อตย่อยสำหรับยานี้
                <div style="margin-top: 0.4rem;">
                    <button type="button" class="btn-lot-action-sm emerald" onclick="openStockInModal(${drug.id});">
                        <i class="fas fa-plus"></i> รับยาเข้าและบันทึกล็อตแรก
                    </button>
                </div>
            </div>
        `;
    }

    return `
        <table class="lot-subtable">
            <thead>
                <tr>
                    <th style="width: 25%; min-width: 160px;">เลขล็อต (Lot / Batch)</th>
                    <th style="width: 25%; min-width: 170px;">วันหมดอายุ / สถานะ</th>
                    <th style="width: 14%; min-width: 100px;">คงเหลือ</th>
                    <th style="width: 12%; min-width: 90px;">ทุน/หน่วย</th>
                    <th style="text-align: right; width: 24%; min-width: 260px;">จัดการเฉพาะล็อต</th>
                </tr>
            </thead>
            <tbody>
                ${lots.map((lot, idx) => {
                    const isFefoEarliest = (idx === 0 && lot.stock_qty > 0);
                    return `
                    <tr>
                        <td>
                            <span class="lot-code-pill">${escapeHtml(lot.lot_number)}</span>
                            ${lot.notes ? `<div style="font-size: 0.72rem; color: var(--text-subtle); margin-top: 3px;">${escapeHtml(lot.notes)}</div>` : ''}
                        </td>
                        <td>
                            <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
                                <span style="font-weight: 600;">${escapeHtml(lot.expiry_date || '-')}</span>
                                ${isFefoEarliest ? `<span class="lot-fefo-pill" title="ล็อตแนะนำจ่ายก่อนตามระบบ FEFO (หมดอายุก่อน)"><i class="fas fa-shield-halved"></i> FEFO แนะนำ</span>` : ''}
                                ${lot.urgency_text && lot.urgency !== 'normal' && lot.urgency !== 'unknown' ? `<span class="expiry-alert-pill ${lot.urgency}" style="font-size: 0.65rem; padding: 1px 6px;">${escapeHtml(lot.urgency_text)}</span>` : ''}
                            </div>
                        </td>
                        <td>
                            <strong style="color: ${lot.stock_qty <= 0 ? 'var(--rose-600)' : 'var(--text-primary)'}; font-size: 0.9rem;">${formatQty(lot.stock_qty)}</strong> 
                            <small style="color: var(--text-muted);">${escapeHtml(drug.unit)}</small>
                        </td>
                        <td>
                            ${lot.cost_per_unit ? `฿${Number(lot.cost_per_unit).toFixed(2)}` : '-'}
                        </td>
                        <td style="text-align: right;">
                            <div style="display: inline-flex; gap: 0.35rem; justify-content: flex-end; flex-wrap: wrap;">
                                <button type="button" class="btn-lot-action-sm primary" onclick="openLotQrModal(${drug.id}, ${lot.id})" title="ดูและดาวน์โหลด QR Code ประจำล็อตนี้">
                                    <i class="fas fa-qrcode"></i> QR
                                </button>
                                <button type="button" class="btn-lot-action-sm" onclick="openLotStickerModal(${drug.id}, ${lot.id})" title="พิมพ์ฉลากสติกเกอร์ล็อตนี้">
                                    <i class="fas fa-print"></i> พิมพ์
                                </button>
                                <button type="button" class="btn-lot-action-sm amber" onclick="openEditLotModal(${drug.id}, ${lot.id}, event)" title="ตั้งค่า/แก้ไขข้อมูลล็อตนี้">
                                    <i class="fas fa-sliders"></i> ตั้งค่าล็อต
                                </button>
                                <button type="button" class="btn-lot-action-sm danger" onclick="openDispenseModalForDrug(${drug.id}, 'WEB_MANUAL', ${lot.id})" ${lot.stock_qty <= 0 ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''} title="ตัดจ่ายยาจากล็อตนี้โดยตรง">
                                    <i class="fas fa-minus"></i> ตัดสต็อก
                                </button>
                            </div>
                        </td>
                    </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

function toggleDrugLotsSubrow(drugId, event) {
    if (event) event.stopPropagation();
    const subrow = document.getElementById(`lots-subrow-${drugId}`);
    const chevron = document.getElementById(`lot-chevron-${drugId}`);
    const badge = document.getElementById(`btn-lot-toggle-${drugId}`);
    if (!subrow) return;

    const isHidden = subrow.style.display === 'none' || subrow.style.display === '';
    if (isHidden) {
        subrow.style.display = 'table-row';
        if (chevron) chevron.classList.add('open');
        if (badge) badge.classList.add('active');
    } else {
        subrow.style.display = 'none';
        if (chevron) chevron.classList.remove('open');
        if (badge) badge.classList.remove('active');
    }
}

function toggleDrugLotsCard(drugId, event) {
    if (event) event.stopPropagation();
    const panel = document.getElementById(`mobile-lots-panel-${drugId}`);
    const chevron = document.getElementById(`mobile-lot-chevron-${drugId}`);
    if (!panel) return;
    const isHidden = panel.style.display === 'none' || panel.style.display === '';
    panel.style.display = isHidden ? 'block' : 'none';
    if (chevron) {
        if (isHidden) chevron.classList.add('open');
        else chevron.classList.remove('open');
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
    if (titleEl) titleEl.innerText = 'เพิ่มยาใหม่';
    const form = document.getElementById('drugForm');
    if (form) form.reset();
    const stockInp = document.getElementById('drugStockInput');
    if (stockInp) stockInp.value = '0';
    renderDrugCategoryInputOptions();
    const formId = document.getElementById('drugFormId');
    if (formId) formId.value = '';
    const lotInput = document.getElementById('drugLotInput');
    if (lotInput) lotInput.value = '';
    const fySelect = document.getElementById('drugOpeningFiscalYearInput');
    if (fySelect) fySelect.value = '2569';
    const customFyInput = document.getElementById('drugCustomOpeningFiscalYearInput');
    if (customFyInput) {
        customFyInput.value = '';
        customFyInput.style.display = 'none';
    }
    setDrugStockFieldMode(false);
    onDrugPackSizeChange();
    removeDrugImage(true);
    const modal = document.getElementById('drugModal');
    if (modal) modal.classList.add('active');
}

// Stock is only typed in when a drug is first created. Afterwards the balance is the sum of its lots and must be
// changed through "รับยาเข้าคลัง" (receive), dispensing, or editing a lot, so lots and stock-card history stay in sync.
function setDrugStockFieldMode(isEdit) {
    const input = document.getElementById('drugStockInput');
    if (!input) return;
    input.readOnly = isEdit;
    input.style.background = isEdit ? 'var(--bg-subtle)' : '';
    input.style.cursor = isEdit ? 'not-allowed' : '';
    input.title = isEdit ? 'แก้ยอดคงเหลือผ่านปุ่ม "รับยาเข้าคลัง" หรือแก้ไขล็อตยา เพื่อให้ประวัติสต็อกถูกต้อง' : '';
    const label = input.closest('.form-group')?.querySelector('.form-label');
    if (label) label.textContent = isEdit ? 'จำนวนคงเหลือ (แก้ผ่านรับยาเข้า/แก้ไขล็อต)' : 'จำนวนสต็อกเริ่มต้น *';
    const unitSel = document.getElementById('drugStockUnitSelect');
    if (unitSel) unitSel.dataset.edit = isEdit ? '1' : '';   // the stock can only be typed when a drug is created
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
    if (titleEl) titleEl.innerText = 'แก้ไขข้อมูลยา';

    renderDrugCategoryInputOptions(drug.category || 'ทั่วไป');
    setVal('drugFormId', drug.id);
    setVal('drugCodeInput', drug.code || '');
    setVal('drugNameInput', drug.name || '');
    setVal('drugGenericInput', drug.generic_name || '');
    setVal('drugCategoryInput', drug.category || 'ทั่วไป');
    setVal('drugDosageInput', drug.dosage_form || 'เม็ด (Tablet)');
    setVal('drugStrengthInput', drug.strength || '');
    setVal('drugPackagingInput', drug.packaging || '');
    setVal('drugPackSizeInput', drug.pack_size || '');
    setVal('drugStockInput', drug.stock_qty || 0);
    setDrugStockFieldMode(true);
    setVal('drugUnitInput', drug.unit || 'เม็ด');
    setVal('drugMinInput', drug.min_threshold || 10);
    setVal('drugPriceInput', drug.price || 0);
    setVal('drugCostInput', drug.cost || 0);
    setVal('drugLotInput', drug.lot_number || '');
    setVal('drugExpiryInput', drug.expiry_date || '');
    setVal('drugLocationInput', drug.location || '');
    setVal('drugInstructionsInput', drug.instructions || '');

    // Opening Fiscal Year (ยอดยกมาจากปีงบประมาณ)
    const fySelect = document.getElementById('drugOpeningFiscalYearInput');
    const customFyInput = document.getElementById('drugCustomOpeningFiscalYearInput');
    const recordedFy = (drug.opening_fiscal_year || '').trim();
    if (fySelect) {
        const standardYears = ['2570', '2569', '2568', '2567'];
        if (!recordedFy) {
            fySelect.value = '2569';
            if (customFyInput) { customFyInput.value = ''; customFyInput.style.display = 'none'; }
        } else if (standardYears.includes(recordedFy)) {
            fySelect.value = recordedFy;
            if (customFyInput) { customFyInput.value = ''; customFyInput.style.display = 'none'; }
        } else {
            fySelect.value = 'CUSTOM';
            if (customFyInput) { customFyInput.value = recordedFy; customFyInput.style.display = 'block'; }
        }
    }

    onDrugPackSizeChange();

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

function onDrugOpeningFiscalYearSelectChange(val) {
    const customInp = document.getElementById('drugCustomOpeningFiscalYearInput');
    if (customInp) {
        customInp.style.display = (val === 'CUSTOM') ? 'block' : 'none';
        if (val === 'CUSTOM') customInp.focus();
    }
}

function onCustomOpeningFiscalYearInput(val) {
    // Keeps value ready for saveDrug
}

// ── Packaging: units per box, prices per box, stock typed in boxes ─────────────────────────
function drugPackSize() {
    const v = parseFloat(document.getElementById('drugPackSizeInput')?.value);
    return v > 1 ? v : 0;
}

function onDrugPackSizeChange() {
    const ps = drugPackSize();
    const unit = (document.getElementById('drugUnitInput')?.value || 'หน่วย').trim() || 'หน่วย';
    document.querySelectorAll('.drug-unit-name').forEach(el => { el.textContent = unit; });
    document.querySelectorAll('.pack-price-field').forEach(el => { el.style.display = ps ? '' : 'none'; });
    const sel = document.getElementById('drugStockUnitSelect');
    if (sel) {
        sel.options[0].text = unit;
        sel.options[1].text = 'กล่อง';
        const show = ps && !sel.dataset.edit;
        sel.style.display = show ? '' : 'none';
        if (!show) sel.value = 'unit';
    }
    if (ps) {
        onDrugUnitPriceInput('price');
        onDrugUnitPriceInput('cost');
    }
}

function onDrugUnitPriceInput(which) {      // typed per unit -> show per box
    const ps = drugPackSize();
    if (!ps) return;
    const unitVal = parseFloat(document.getElementById(which === 'price' ? 'drugPriceInput' : 'drugCostInput')?.value);
    const packEl = document.getElementById(which === 'price' ? 'drugPackPriceInput' : 'drugPackCostInput');
    if (packEl) packEl.value = isNaN(unitVal) ? '' : Math.round(unitVal * ps * 100) / 100;
}

function onDrugPackPriceInput(which) {      // typed per box -> store per unit
    const ps = drugPackSize();
    if (!ps) return;
    const packVal = parseFloat(document.getElementById(which === 'price' ? 'drugPackPriceInput' : 'drugPackCostInput')?.value);
    const unitEl = document.getElementById(which === 'price' ? 'drugPriceInput' : 'drugCostInput');
    if (unitEl) unitEl.value = isNaN(packVal) ? '' : Math.round(packVal / ps * 1000000) / 1000000;
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
        packaging: getVal('drugPackagingInput'),
        pack_size: parseFloat(getVal('drugPackSizeInput', '')) > 1 ? parseFloat(getVal('drugPackSizeInput', '')) : null,
        pack_unit: 'กล่อง',
        stock_qty: parseFloat(getVal('drugStockInput', '0')) || 0,
        opening_fiscal_year: getVal('drugOpeningFiscalYearInput') === 'CUSTOM' ? getVal('drugCustomOpeningFiscalYearInput') : getVal('drugOpeningFiscalYearInput', '2567'),
        unit: getVal('drugUnitInput', 'เม็ด'),
        min_threshold: parseFloat(getVal('drugMinInput', '10')) || 10,
        price: parseFloat(getVal('drugPriceInput', '0')) || 0,
        cost: parseFloat(getVal('drugCostInput', '0')) || 0,
        lot_number: getVal('drugLotInput'),
        expiry_date: getVal('drugExpiryInput'),
        location: getVal('drugLocationInput'),
        instructions: getVal('drugInstructionsInput')
    };

    if (!payload.name) {
        showToast('กรุณากรอกชื่อยา', 'warning');
        return;
    }
    if (isEdit) {
        delete payload.stock_qty;   // balance is managed through lots / receiving, never overwritten here
    } else if (payload.pack_size) {
        payload.stock_input_unit = document.getElementById('drugStockUnitSelect')?.value || 'unit';
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
            showToast('เกิดข้อผิดพลาด: ' + (data.error || 'ไม่สามารถบันทึกได้'), 'error');
        }
    } catch (e) {
        console.error('Save drug error:', e);
        showToast('ไม่สามารถบันทึกข้อมูลได้', 'error');
    }
}

async function confirmDeleteDrug(id) {
    const numId = Number(id);
    const drug = allDrugs.find(d => Number(d.id) === numId || d.id == id);
    const name = drug ? drug.name : 'ยานี้';
    const ok = await showConfirmDialog(
        `คุณต้องการลบยา '${name}' ออกจากคลังยาใช่หรือไม่?\n(ระบบจะอัปเดตลง Google Sheet อัตโนมัติ)`,
        { title: 'ยืนยันการลบรายการยา', confirmText: 'ลบรายการยา', danger: true }
    );
    if (!ok) return;
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
let isDispensing = false;
let pendingDispensePayload = null;
let dispenseModalOpenedAt = 0;
let isCameraScanLocked = false;

function onDispenseQtyChange() {
    if (!selectedDrugForDispense) return;
    const drug = selectedDrugForDispense;
    const qty = parseFloat(document.getElementById('dispenseQtyInput')?.value) || 0;
    const currentStock = Number(drug.stock_qty) || 0;
    const alertEl = document.getElementById('dispenseHighQtyAlert');
    const alertText = document.getElementById('dispenseHighQtyAlertText');
    const submitBtn = document.getElementById('btnSubmitDispense');

    if (qty > currentStock) {
        if (alertEl) alertEl.style.display = 'block';
        if (alertText) {
            alertText.innerHTML = `<strong style="color: #E11D48;"><i class="fas fa-ban"></i> จำนวนเกินสต็อก:</strong> ในคลังมียาเพียง <strong>${currentStock} ${drug.unit}</strong>`;
        }
        if (submitBtn) submitBtn.disabled = true;
        return;
    }

    if (submitBtn) submitBtn.disabled = false;

    // High quantity threshold: >= 100 units OR >= 50% of current stock
    const isHigh = (qty >= 100) || (currentStock > 0 && qty >= currentStock * 0.5);
    if (isHigh && qty > 0) {
        const percent = currentStock > 0 ? Math.round((qty / currentStock) * 100) : 0;
        let reasons = [];
        if (qty >= 100) reasons.push(`ตัดจ่ายตั้งแต่ 100 ${drug.unit} ขึ้นไป`);
        if (currentStock > 0 && qty >= currentStock * 0.5) reasons.push(`คิดเป็น ${percent}% ของยาทั้งคลัง`);

        if (alertEl) alertEl.style.display = 'block';
        if (alertText) {
            alertText.innerHTML = `<strong>ตรวจสอบจำนวน:</strong> ${reasons.join(' และ ')} โปรดระวังการพิมพ์เลข 0 เกิน`;
        }
    } else {
        if (alertEl) alertEl.style.display = 'none';
    }
}

function setDispenseDateNow() {
    const inp = document.getElementById('dispenseCreatedAtInput');
    if (inp) {
        const now = new Date();
        const offset = now.getTimezoneOffset() * 60000;
        inp.value = (new Date(now.getTime() - offset)).toISOString().slice(0, 16);
    }
}

function openDispenseModalForDrug(drugOrId, channel = 'WEB_MANUAL', preselectLotId = null) {
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
    document.getElementById('dispenseDrugCode').innerText = `รหัส: ${drug.code} • คงเหลือรวม: ${drug.stock_qty} ${drug.unit}`;
    setDispenseDateNow();
    
    // Populate Lot selector dropdown
    const lotGroup = document.getElementById('dispenseLotGroup');
    const lotSelect = document.getElementById('dispenseLotSelect');
    const lots = drug.lots || [];

    if (lotSelect) {
        let lotOptionsHtml = `<option value="">อัตโนมัติ (ล็อตหมดอายุก่อน)</option>`;
        if (lots.length > 0) {
            const firstActiveLot = lots.find(l => Number(l.stock_qty || 0) > 0 && l.is_active !== 0);
            lots.forEach(lot => {
                const isOutOfStock = Number(lot.stock_qty || 0) <= 0;
                const daysLeft = lot.days_left ?? lot.days_until_expiry ?? null;
                const isFefo = Boolean(lot.is_fefo_recommended) || (firstActiveLot && firstActiveLot.id === lot.id);
                let tag = '';
                if (lot.is_expired) tag = ' [หมดอายุ]';
                else if (isFefo) tag = ' [แนะนำ: หมดอายุก่อน]';
                else if (daysLeft !== null && daysLeft <= 60) tag = ` [ใกล้หมดอายุ ${daysLeft} วัน]`;

                const isSelected = preselectLotId && (lot.id === Number(preselectLotId) || lot.id == preselectLotId);
                lotOptionsHtml += `
                    <option value="${lot.id}" data-stock="${lot.stock_qty}" data-lot="${escapeHtml(lot.lot_number)}" ${isOutOfStock ? 'disabled' : ''} ${isSelected ? 'selected' : ''}>
                        ล็อต: ${escapeHtml(lot.lot_number)} — คงเหลือ: ${lot.stock_qty} ${drug.unit} | EXP: ${lot.expiry_date || '-'}${tag}
                    </option>
                `;
            });
            if (lotGroup) lotGroup.style.display = 'block';
        } else {
            lotOptionsHtml = `<option value="">(ตัดสต็อกโดยตรงจากคลังหลัก)</option>`;
            if (lotGroup) lotGroup.style.display = 'block';
        }
        lotSelect.innerHTML = lotOptionsHtml;
    }

    onDispenseLotSelectChange();

    const qtyInput = document.getElementById('dispenseQtyInput');
    if (qtyInput) {
        qtyInput.value = 1;
    }
    document.getElementById('dispenseUnitLabel').innerText = drug.unit;
    document.getElementById('dispensePatientInput').value = '';
    document.getElementById('dispenseNoteInput').value = '';

    const dispInput = document.getElementById('dispenserNameInput');
    if (dispInput && (!dispInput.value || dispInput.value === 'เภสัชกร/เจ้าหน้าที่' || dispInput.value === 'เจ้าหน้าที่')) {
        dispInput.value = window.CURRENT_USER_NAME || 'ผู้ดูแลระบบคลังยา (Admin)';
    }

    // Hide any previous high quantity alert
    const alertEl = document.getElementById('dispenseHighQtyAlert');
    if (alertEl) alertEl.style.display = 'none';

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

    // Unfocus any element to swallow trailing scanner Enter keystrokes
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
    }
    dispenseModalOpenedAt = Date.now();
    isDispensing = false;

    // Safety guard: Temporarily disable submit button for 450ms to prevent ghost clicks or scanner trailing Enters
    const submitBtn = document.getElementById('btnSubmitDispense');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = 'ยืนยันตัดสต็อก';
        setTimeout(() => {
            const btn = document.getElementById('btnSubmitDispense');
            if (btn && !isDispensing) btn.disabled = false;
        }, 450);
    }

    document.getElementById('dispenseModal').classList.add('active');
}

function onDispenseLotSelectChange() {
    if (!selectedDrugForDispense) return;
    const drug = selectedDrugForDispense;
    const lotSelect = document.getElementById('dispenseLotSelect');
    const hintEl = document.getElementById('dispenseLotHint');
    const qtyInput = document.getElementById('dispenseQtyInput');
    const lotId = lotSelect ? lotSelect.value : '';

    if (lotId) {
        const lot = (drug.lots || []).find(l => l.id == lotId);
        if (lot) {
            const lotStock = Number(lot.stock_qty) || 0;
            if (qtyInput) qtyInput.max = lotStock;
            if (hintEl) {
                hintEl.innerHTML = `ล็อต <strong>${escapeHtml(lot.lot_number)}</strong> เหลือ ${lotStock} ${escapeHtml(drug.unit)}`;
                hintEl.style.color = '#0284c7';
            }
        }
    } else {
        if (qtyInput) qtyInput.max = drug.stock_qty;
        if (hintEl) {
            hintEl.innerHTML = `ตัดล็อตที่หมดอายุก่อน`;
            hintEl.style.color = '#047857';
        }
    }
    onDispenseQtyChange();
}

function closeDispenseModal() {
    const modal = document.getElementById('dispenseModal');
    if (modal) modal.classList.remove('active');
    selectedDrugForDispense = null;
    currentDispenseChannel = 'WEB_MANUAL';
    isDispensing = false;
    const submitBtn = document.getElementById('btnSubmitDispense');
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'ยืนยันตัดสต็อก';
    }
}

function openHighQtyConfirmModal(drug, qty, currentStock) {
    const modal = document.getElementById('highQtyConfirmModal');
    if (!modal) return;

    document.getElementById('confirmDrugName').innerText = `${drug.name} (${drug.code})`;
    document.getElementById('confirmDispenseQty').innerText = `-${formatQty(qty)} ${drug.unit}`;
    document.getElementById('confirmCurrentStock').innerText = `${formatQty(currentStock)} ${drug.unit}`;
    
    const ratioNotice = document.getElementById('confirmStockRatioNotice');
    if (ratioNotice) {
        const percent = currentStock > 0 ? ((qty / currentStock) * 100).toFixed(1) : 0;
        let reasons = [];
        if (qty >= 100) reasons.push(`ตัดจ่ายตั้งแต่ ${formatQty(qty)} ${drug.unit} ขึ้นไป`);
        if (percent >= 50) reasons.push(`สูงถึง ${percent}% ของยาทั้งคลัง`);
        ratioNotice.innerHTML = `<i class="fas fa-triangle-exclamation"></i> ${reasons.join(' • ')}`;
    }

    modal.classList.add('active');
}

function closeHighQtyConfirmModal() {
    const modal = document.getElementById('highQtyConfirmModal');
    if (modal) modal.classList.remove('active');
    pendingDispensePayload = null;
    
    // Focus back on quantity input in the underlying modal
    const input = document.getElementById('dispenseQtyInput');
    if (input) {
        input.focus();
        input.select();
    }
}

function executeDispenseAfterConfirmation() {
    if (!pendingDispensePayload) return;
    const p = pendingDispensePayload;
    closeHighQtyConfirmModal();
    executeDispense(p.drug, p.quantity, p.channel, p.dispensed_by, p.patient_name, p.notes, p.lot_id, p.created_at);
    pendingDispensePayload = null;
}

async function submitDispense(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (isDispensing) return;

    // Safety guard: Reject instant submissions within 400ms of opening (blocks scanner trailing Enter & ghost taps)
    if (Date.now() - dispenseModalOpenedAt < 400) {
        console.warn('Blocked premature automatic dispense submission');
        return;
    }
    if (!selectedDrugForDispense) return;

    const drug = selectedDrugForDispense;
    const qtyRaw = document.getElementById('dispenseQtyInput')?.value;
    const qty = parseFloat(qtyRaw);
    if (isNaN(qty) || qty <= 0) {
        showToast('กรุณาระบุจำนวนที่ตัดจ่ายให้มากกว่า 0', 'warning');
        return;
    }
    const currentStock = Number(drug.stock_qty) || 0;
    const lotId = document.getElementById('dispenseLotSelect')?.value || null;

    if (lotId) {
        const lot = (drug.lots || []).find(l => l.id == lotId);
        if (lot && qty > Number(lot.stock_qty)) {
            showToast(`ยอดตัดจ่ายเกินคงเหลือในล็อต ${lot.lot_number} (คงเหลือ ${lot.stock_qty} ${drug.unit})`, 'error');
            return;
        }
    }

    // 1. Hard check: cannot dispense more than stock
    if (qty > currentStock) {
        showToast(`ยาคงเหลือไม่พอตัดจ่าย (คงเหลือ ${currentStock} ${drug.unit})`, 'error');
        return;
    }

    if (qty <= 0) {
        showToast('กรุณาระบุจำนวนตัดจ่ายอย่างน้อย 1 หน่วย', 'warning');
        return;
    }

    const patient = (document.getElementById('dispensePatientInput')?.value || '').trim();
    const notes = (document.getElementById('dispenseNoteInput')?.value || '').trim();
    const dispenser = (document.getElementById('dispenserNameInput')?.value || '').trim() || window.CURRENT_USER_NAME || 'ผู้ดูแลระบบคลังยา (Admin)';
    const channel = currentDispenseChannel || 'WEB_MANUAL';
    const createdAt = (document.getElementById('dispenseCreatedAtInput')?.value || '').trim();

    // 2. High Quantity Check: >= 100 OR >= 50% of current stock
    const isHighQty = (qty >= 100) || (currentStock > 0 && qty >= currentStock * 0.5);
    if (isHighQty) {
        pendingDispensePayload = {
            drug: drug,
            quantity: qty,
            channel: channel,
            dispensed_by: dispenser,
            patient_name: patient,
            notes: notes,
            lot_id: lotId,
            created_at: createdAt
        };
        openHighQtyConfirmModal(drug, qty, currentStock);
        return;
    }

    // Normal quantity: execute directly
    executeDispense(drug, qty, channel, dispenser, patient, notes, lotId, createdAt);
}

async function executeDispense(drug, qty, channel, dispenser, patient, notes, lotId = null, createdAt = null) {
    if (isDispensing) return;

    // 1. Lock immediately so the button cannot be clicked again
    isDispensing = true;
    const submitBtn = document.getElementById('btnSubmitDispense');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> กำลังตัดสต็อก...';
    }

    // 2. Instantly dismiss/close the pop-up modal so the user cannot click twice
    closeDispenseModal();

    // 3. Show immediate feedback toast so the user knows the action was received instantly
    showToast(`⏳ กำลังตัดสต็อก ${drug.name} (-${qty} ${drug.unit})...`, 'info');

    try {
        const res = await fetch('/api/dispense', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                drug_id: drug.id,
                quantity: qty,
                channel: channel,
                dispensed_by: dispenser,
                patient_name: patient,
                notes: notes,
                lot_id: lotId ? Number(lotId) : null,
                created_at: createdAt || undefined
            })
        });
        const data = await res.json();
        if (data.ok) {
            loadDrugs();
            loadDashboardStats();
            loadDispensingLogs();
            showToast(`${data.message}`, 'success');
        } else {
            showToast('ไม่สามารถตัดสต็อกได้: ' + (data.error || 'Unknown error'), 'error');
            loadDrugs();
        }
    } catch (err) {
        console.error('Dispense error:', err);
        showToast('เกิดข้อผิดพลาดในการตัดสต็อก กรุณาตรวจสอบการเชื่อมต่อ', 'error');
    } finally {
        isDispensing = false;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'ยืนยันตัดสต็อก';
        }
    }
}

// ─────────────────────────────────────────────────────────────
// Dispensing Logs (Audit History)
// ─────────────────────────────────────────────────────────────

async function loadDispensingLogs() {
    const startDate = document.getElementById('logStartDateFilter')?.value || '';
    const endDate = document.getElementById('logEndDateFilter')?.value || '';
    const legacyDate = document.getElementById('logDateFilter')?.value || '';
    let channel = document.getElementById('logChannelFilter')?.value || 'all';
    if (channel === 'QR') channel = 'QR_SCAN';

    let url = `/api/dispense/logs?channel=${encodeURIComponent(channel)}`;
    if (startDate && endDate) {
        url += `&start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`;
    } else if (startDate) {
        url += `&start_date=${encodeURIComponent(startDate)}`;
    } else if (endDate) {
        url += `&end_date=${encodeURIComponent(endDate)}`;
    } else if (legacyDate) {
        url += `&date=${encodeURIComponent(legacyDate)}`;
    }

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

function clearDispensingDateFilter() {
    const s = document.getElementById('logStartDateFilter');
    const e = document.getElementById('logEndDateFilter');
    const leg = document.getElementById('logDateFilter');
    if (s) s.value = '';
    if (e) e.value = '';
    if (leg) leg.value = '';
    if (paginationState.logs) paginationState.logs.currentPage = 1;
    loadDispensingLogs();
}

function renderLogsTable(logs) {
    allDispenseLogs = logs || [];
    const tbody = document.getElementById('logsTableBody');
    const cardsContainer = document.getElementById('logsMobileCards');
    const paginationWrapper = document.getElementById('logsPaginationWrapper');

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
        if (paginationWrapper) paginationWrapper.innerHTML = '';
        return;
    }

    const state = paginationState.logs;
    const totalItems = logs.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / state.pageSize));
    if (state.currentPage > totalPages) state.currentPage = totalPages;
    if (state.currentPage < 1) state.currentPage = 1;

    const startIdx = (state.currentPage - 1) * state.pageSize;
    const pagedLogs = logs.slice(startIdx, startIdx + state.pageSize);

    if (tbody) {
        tbody.innerHTML = pagedLogs.map(l => {
            // Plain words instead of coloured badges
            let channelBadge = '<span class="log-channel ch-web">หน้าเว็บ</span>';
            if (l.channel === 'WEB_RX_CART') channelBadge = '<span class="log-channel ch-rx">ใบสั่งยา</span>';
            else if (l.channel.includes('LINE')) channelBadge = '<span class="log-channel ch-line">LINE</span>';
            else if (l.channel.includes('QR')) channelBadge = '<span class="log-channel ch-scan">สแกน</span>';

            const driveBtn = l.drive_file_link
                ? `<a href="${l.drive_file_link}" target="_blank" class="btn btn-outline" style="padding: 0.2rem 0.55rem; font-size: 0.725rem; height: 26px; color: var(--brand-600);"><i class="fab fa-google-drive"></i> ดูรูปสลิป</a>`
                : '<span style="color: var(--text-subtle); font-size: 0.75rem;">-</span>';

            const drugImg = l.image_url || (typeof allDrugs !== 'undefined' && allDrugs.find(d => Number(d.id) === Number(l.drug_id) || (d.code && l.drug_code && d.code.trim().toUpperCase() === l.drug_code.trim().toUpperCase()))?.image_url);
            const thumbHtml = drugImg
                ? `<div class="drug-table-thumb" onclick="openImageLightbox('${escapeHtml(drugImg)}', '${escapeHtml(l.drug_name)}', '${escapeHtml(l.drug_code || '')}')" title="คลิกดูภาพขยาย">
                     <img src="${escapeHtml(drugImg)}" alt="${escapeHtml(l.drug_name)}" loading="lazy" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'drug-table-thumb-fallback\\'><i class=\\'fas fa-pills\\'></i></div>';">
                   </div>`
                : `<div class="drug-table-thumb-fallback" title="ยังไม่มีภาพยา"><i class="fas fa-pills"></i></div>`;

            let dtHtml = '<span class="log-muted">-</span>';
            if (l.created_at) {
                const parts = l.created_at.trim().split(' ');
                dtHtml = parts.length === 2
                    ? `<div class="log-date">${escapeHtml(parts[0])}</div><div class="log-muted">${escapeHtml(parts[1].slice(0, 5))}</div>`
                    : `<div class="log-date">${escapeHtml(l.created_at)}</div>`;
            }

            const who = escapeHtml((!l.dispensed_by || l.dispensed_by === 'เภสัชกร/เจ้าหน้าที่' || l.dispensed_by === 'เจ้าหน้าที่') ? (window.CURRENT_USER_NAME || l.dispensed_by || '-') : l.dispensed_by);

            return `
                <tr class="${l.is_voided ? 'log-row-voided' : ''}">
                    <td class="col-thumb">
                        ${thumbHtml}
                    </td>
                    <td class="col-datetime">
                        ${dtHtml}
                    </td>
                    <td class="col-drug">
                        <div class="log-drug-name">${escapeHtml(l.drug_name)}</div>
                        <div class="log-muted">${escapeHtml(l.drug_code || '')}${l.batch_id ? ` · <a href="/api/dispense/requisition/batch/${escapeHtml(l.batch_id)}" target="_blank" class="log-link" title="เปิดใบสั่งยาทั้งชุด">${escapeHtml(l.batch_id)}</a>` : ''}</div>
                    </td>
                    <td class="col-qty" style="text-align: center;">
                        <span class="log-qty is-out">-${l.quantity}</span>
                        ${l.is_voided ? '<div class="log-voided-tag">ยกเลิกแล้ว</div>' : ''}
                    </td>
                    <td class="col-balance" style="text-align: center; white-space: nowrap;">
                        <span class="log-muted">${l.balance_before} →</span> <strong class="log-after">${l.balance_after}</strong>
                    </td>
                    <td class="col-channel" style="text-align: center;">
                        ${channelBadge}
                        ${l.drive_file_link ? `<div><a href="${l.drive_file_link}" target="_blank" class="log-link">สลิป</a></div>` : ''}
                    </td>
                    <td class="col-dispenser">
                        <div class="log-person">${who}</div>
                        ${l.patient_name ? `<div class="log-muted">คนไข้: ${escapeHtml(l.patient_name)}</div>` : ''}
                        ${l.notes ? `<div class="log-muted">${escapeHtml(l.notes)}</div>` : ''}
                        ${l.is_voided && l.void_reason ? `<div class="log-void-reason">เหตุผล: ${escapeHtml(l.void_reason)}${l.voided_by ? ' (' + escapeHtml(l.voided_by) + ')' : ''}</div>` : ''}
                    </td>
                    <td class="col-action" style="text-align: center;">
                        <div class="log-actions">
                            ${l.batch_id ? `
                                <button class="log-btn" onclick="openBatchPrescriptionRequisition('${escapeHtml(l.batch_id)}')" title="พิมพ์ใบสั่งยา A4 ทั้งชุด">ใบสั่งยา A4</button>
                                <button class="log-btn" onclick="openSingleRequisition(${l.id})" title="พิมพ์ใบเบิกเฉพาะรายการนี้">ใบย่อย</button>
                            ` : `
                                <button class="log-btn" onclick="openSingleRequisition(${l.id})" title="พิมพ์ใบเบิกจ่ายยา (A4)">ใบเบิก</button>
                            `}
                            ${!l.is_voided ? `
                                <button type="button" class="log-btn" onclick="openEditDispenseModal(${l.id})" title="แก้ไขรายการจ่ายย้อนหลัง" style="color: #0284C7; border-color: #BAE6FD;">แก้ไข</button>
                                <button class="log-btn log-btn-danger" onclick="voidDispense(${l.id}, '${escapeHtml(l.drug_name)}', ${l.quantity})" title="ยกเลิกรายการจ่ายและคืนยาเข้าสต็อก">ยกเลิก</button>
                            ` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    if (cardsContainer) {
        cardsContainer.innerHTML = pagedLogs.map(l => {
            let channelBadge = '<span class="log-channel ch-web">หน้าเว็บ</span>';
            if (l.channel === 'WEB_RX_CART') channelBadge = '<span class="log-channel ch-rx">ใบสั่งยา</span>';
            else if (l.channel.includes('LINE')) channelBadge = '<span class="log-channel ch-line">LINE</span>';
            else if (l.channel.includes('QR')) channelBadge = '<span class="log-channel ch-scan">สแกน</span>';

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
                <div class="log-mobile-card" style="${l.is_voided ? 'opacity: 0.65;' : ''}">
                    <div style="display: flex; gap: 0.75rem; align-items: flex-start; margin-bottom: 0.5rem;">
                        ${mobileThumbHtml}
                        <div style="flex: 1; min-width: 0;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
                                <div style="display: flex; gap: 4px; align-items: center; flex-wrap: wrap;">
                                    <span class="code-pill">${escapeHtml(l.drug_code || '')}</span>
                                    ${l.batch_id ? `<span class="code-pill" style="background: rgba(99, 102, 241, 0.08); color: #4338CA; border-color: rgba(99, 102, 241, 0.25); font-size: 0.65rem;"><i class="fas fa-clipboard-list"></i> ${escapeHtml(l.batch_id)}</span>` : ''}
                                </div>
                                <div style="text-align: right;">
                                    <span class="log-qty is-out" ${l.is_voided ? 'style="text-decoration: line-through; color: var(--text-muted);"' : ''}>-${l.quantity}</span>
                                    ${l.is_voided ? '<div class="log-voided-tag">ยกเลิกแล้ว</div>' : ''}
                                                                    </div>
                            </div>
                            <div style="font-weight: 700; font-size: 1rem; color: var(--text-primary); line-height: 1.35;">${escapeHtml(l.drug_name)}</div>
                            ${l.generic_name ? `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">${escapeHtml(l.generic_name)}</div>` : ''}
                        </div>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8125rem; color: var(--text-secondary); margin-top: 0.65rem; padding-top: 0.65rem; border-top: 1px solid var(--border-subtle); flex-wrap: wrap; gap: 0.5rem;">
                        <div>
                            <span>คงเหลือ: ${l.balance_before} &rarr; </span><strong class="log-after">${l.balance_after}</strong>
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
                    <div class="log-actions" style="justify-content: flex-end; margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid var(--border-subtle);">
                        ${l.batch_id ? `
                            <button class="log-btn" onclick="openBatchPrescriptionRequisition('${escapeHtml(l.batch_id)}')">ใบสั่งยา A4</button>
                            <button class="log-btn" onclick="openSingleRequisition(${l.id})">ใบย่อย</button>
                        ` : `
                            <button class="log-btn" onclick="openSingleRequisition(${l.id})">ใบเบิก</button>
                        `}
                        ${!l.is_voided ? `
                            <button type="button" class="log-btn" onclick="openEditDispenseModal(${l.id})" style="color: #0284C7; border-color: #BAE6FD;">แก้ไข</button>
                            <button type="button" class="log-btn log-btn-danger" onclick="voidDispense(${l.id}, '${escapeHtml(l.drug_name)}', ${l.quantity})">ยกเลิก</button>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    renderPaginationBar('logsPaginationWrapper', 'logs', totalItems);
}

async function voidDispense(logId, drugName, qty) {
    const reason = await showPromptDialog(
        `ต้องการยกเลิกรายการจ่ายยา "${drugName}" จำนวน ${qty} หน่วย ใช่หรือไม่?\nกรุณาระบุเหตุผลในการยกเลิก (เช่น สแกนผิดรายการ, คนไข้เปลี่ยนยา):`,
        'ยกเลิกรายการจ่ายยาโดยเจ้าหน้าที่',
        { title: 'ยืนยันยกเลิกการตัดสต็อก', confirmText: 'ยืนยันยกเลิก', danger: true, placeholder: 'ระบุเหตุผลการยกเลิก...' }
    );
    if (!reason) return;

    try {
        const res = await fetch(`/api/dispense/${logId}/void`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: reason })
        });
        const data = await res.json();
        if (data.ok) {
            showToast(data.message || 'ยกเลิกรายการและคืนยาเข้าสต็อกเรียบร้อยแล้ว', 'success');
            loadDispensingLogs();
            loadDrugs();
            loadDashboardStats();
        } else {
            showToast('ไม่สามารถยกเลิกได้: ' + (data.error || 'เกิดข้อผิดพลาด'), 'error');
        }
    } catch (e) {
        console.error('Error voiding dispense:', e);
        showToast('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์', 'error');
    }
}

async function openEditDispenseModal(logId) {
    try {
        const res = await fetch(`/api/dispense/logs/${logId}`);
        const data = await res.json();
        if (!data.ok || !data.log) {
            showToast('ไม่พบข้อมูลรายการจ่ายนี้', 'error');
            return;
        }
        const log = data.log;

        document.getElementById('editDispenseId').value = log.id;
        document.getElementById('editDispenseDrugId').value = log.drug_id;
        document.getElementById('editDispenseOriginalQty').value = log.quantity;

        document.getElementById('editDispensePreviewCode').innerText = log.drug_code || '-';
        document.getElementById('editDispensePreviewName').innerText = log.drug_name || '-';
        document.getElementById('editDispensePreviewLot').innerText = log.lot_number || '-';
        document.getElementById('editDispenseUnitLabel').innerText = log.unit || 'หน่วย';

        let dtVal = '';
        if (log.created_at) {
            dtVal = log.created_at.slice(0, 16).replace(' ', 'T');
        }
        document.getElementById('editDispenseCreatedAt').value = dtVal;

        document.getElementById('editDispenseQty').value = log.quantity;
        document.getElementById('editDispensePatient').value = log.patient_name || '';
        document.getElementById('editDispenseDispensedBy').value = log.dispensed_by || '';
        document.getElementById('editDispenseNotes').value = log.notes || '';

        onEditDispenseQtyChange();

        const modal = document.getElementById('editDispenseModal');
        if (modal) {
            modal.style.display = 'flex';
            modal.classList.add('active');
        }
    } catch (e) {
        console.error('Error fetching dispense log:', e);
        showToast('เกิดข้อผิดพลาดในการโหลดข้อมูลรายการจ่าย', 'error');
    }
}

function closeEditDispenseModal() {
    const modal = document.getElementById('editDispenseModal');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
    }
}

function onEditDispenseQtyChange() {
    const orig = parseFloat(document.getElementById('editDispenseOriginalQty')?.value || '0');
    const cur = parseFloat(document.getElementById('editDispenseQty')?.value || '0');
    const hint = document.getElementById('editDispenseQtyHint');
    if (!hint) return;

    if (isNaN(cur) || cur <= 0) {
        hint.style.display = 'block';
        hint.style.background = '#FEE2E2';
        hint.style.color = '#B91C1C';
        hint.style.border = '1px solid #FCA5A5';
        hint.innerHTML = '<i class="fas fa-circle-exclamation"></i> จำนวนที่ตัดจ่ายต้องมากกว่า 0';
        return;
    }

    const diff = cur - orig;
    if (diff === 0) {
        hint.style.display = 'none';
    } else if (diff > 0) {
        hint.style.display = 'block';
        hint.style.background = '#FEF3C7';
        hint.style.color = '#B45309';
        hint.style.border = '1px solid #FDE68A';
        hint.innerHTML = `<i class="fas fa-arrow-up"></i> ตัดจ่ายเพิ่ม <strong>+${diff}</strong> หน่วย (ระบบจะหักสต็อกในคลังเพิ่ม ${diff} หน่วย)`;
    } else {
        const restored = Math.abs(diff);
        hint.style.display = 'block';
        hint.style.background = '#D1FAE5';
        hint.style.color = '#047857';
        hint.style.border = '1px solid #A7F3D0';
        hint.innerHTML = `<i class="fas fa-arrow-down"></i> ลดยอดตัดจ่ายลง <strong>${diff}</strong> หน่วย (ระบบจะ<strong>คืนยา ${restored} หน่วย</strong>กลับเข้าสต็อก)`;
    }
}

async function saveEditDispense(e) {
    if (e && e.preventDefault) e.preventDefault();
    const logId = document.getElementById('editDispenseId')?.value;
    if (!logId) return;

    const qty = parseFloat(document.getElementById('editDispenseQty')?.value || '0');
    if (isNaN(qty) || qty <= 0) {
        showToast('กรุณาระบุจำนวนที่ตัดจ่ายให้ถูกต้อง (มากกว่า 0)', 'warning');
        return;
    }

    const createdAt = document.getElementById('editDispenseCreatedAt')?.value || '';
    const patient = (document.getElementById('editDispensePatient')?.value || '').trim();
    const dispensedBy = (document.getElementById('editDispenseDispensedBy')?.value || '').trim();
    const notes = (document.getElementById('editDispenseNotes')?.value || '').trim();

    const btn = document.getElementById('btnSubmitEditDispense');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> กำลังบันทึก...';
    }

    try {
        const res = await fetch(`/api/dispense/logs/${logId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                quantity: qty,
                created_at: createdAt,
                patient_name: patient,
                dispensed_by: dispensedBy,
                notes: notes
            })
        });
        const data = await res.json();
        if (data.ok) {
            closeEditDispenseModal();
            showToast('แก้ไขรายการจ่ายยาย้อนหลังเรียบร้อยแล้ว', 'success');
            loadDrugs();
            loadDashboardStats();
            loadDispensingLogs();
        } else {
            showToast('ไม่สามารถแก้ไขได้: ' + (data.error || 'Unknown error'), 'error');
        }
    } catch (err) {
        console.error('Error saving dispense edit:', err);
        showToast('เกิดข้อผิดพลาดในการเชื่อมต่อ', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> บันทึกการแก้ไข';
        }
    }
}

// ─────────────────────────────────────────────────────────────
// QR Code Generator Modal
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// QR Code Generator Modal & Lot QR Code Handler
// ─────────────────────────────────────────────────────────────

let currentLabelDrug = null;
let currentLabelLot = null;
let currentLotModalDrug = null;
let currentLotModalLot = null;
let currentLotModalQrDataUrl = '';

function openLotQrModal(drugId, lotId) {
    const drug = allDrugs.find(d => d.id === Number(drugId) || d.id == drugId);
    if (!drug) return;
    const lot = (drug.lots || []).find(l => l.id === Number(lotId) || l.id == lotId);
    if (!lot) return;

    currentLotModalDrug = drug;
    currentLotModalLot = lot;

    const modal = document.getElementById('lotQrModal');
    if (!modal) return;

    const drugNameEl = document.getElementById('lotQrDrugName');
    const drugCodeEl = document.getElementById('lotQrDrugCode');
    const lotNoEl = document.getElementById('lotQrLotNo');
    const expiryEl = document.getElementById('lotQrExpiry');
    const stockEl = document.getElementById('lotQrStock');

    if (drugNameEl) drugNameEl.innerText = drug.name;
    if (drugCodeEl) drugCodeEl.innerText = drug.code;
    if (lotNoEl) lotNoEl.innerText = lot.lot_number;
    if (expiryEl) expiryEl.innerText = lot.expiry_date || '-';
    if (stockEl) stockEl.innerText = `${lot.stock_qty} ${drug.unit || 'หน่วย'}`;

    const origin = window.location.origin;
    const qrPayload = `${origin}/?scan=${encodeURIComponent(drug.code)}&lot=${encodeURIComponent(lot.lot_number)}`;
    const payloadTextEl = document.getElementById('lotQrPayloadText');
    if (payloadTextEl) payloadTextEl.innerText = qrPayload;

    const container = document.getElementById('lotQrCanvasContainer');
    if (container) {
        container.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: #0284c7;"></i>';
    }

    modal.classList.add('active');

    // Generate QR
    generateQrDataUrl(qrPayload, 180).then(dataUrl => {
        currentLotModalQrDataUrl = dataUrl;
        if (container) {
            container.innerHTML = `<img src="${dataUrl}" alt="QR ล็อต ${escapeHtml(lot.lot_number)}" style="width: 180px; height: 180px; display: block; border-radius: 4px;">`;
        }
    });
}

function closeLotQrModal() {
    const modal = document.getElementById('lotQrModal');
    if (modal) modal.classList.remove('active');
    currentLotModalDrug = null;
    currentLotModalLot = null;
    currentLotModalQrDataUrl = '';
}

function downloadLotQrImage() {
    if (!currentLotModalQrDataUrl || !currentLotModalDrug || !currentLotModalLot) return;
    const link = document.createElement('a');
    link.download = `QR_${currentLotModalDrug.code}_Lot_${currentLotModalLot.lot_number}.png`;
    link.href = currentLotModalQrDataUrl;
    link.click();
}

function printFromLotQrModal() {
    if (!currentLotModalDrug || !currentLotModalLot) return;
    const drugId = currentLotModalDrug.id;
    const lotId = currentLotModalLot.id;
    closeLotQrModal();
    openLotStickerModal(drugId, lotId);
}

// ─────────────────────────────────────────────────────────────────────────────
// 📦 LOT MANAGEMENT & SETTINGS (ตั้งค่าและแก้ไขล็อตยา)
// ─────────────────────────────────────────────────────────────────────────────

async function openEditLotModal(drugId, lotId, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }

    let drug = allDrugs.find(d => d.id === Number(drugId) || d.id == drugId);
    let lot = drug && (drug.lots || []).find(l => l.id === Number(lotId) || l.id == lotId);

    if (!lot) {
        try {
            const res = await fetch(`${API_BASE_URL}/api/lots/${lotId}`);
            const data = await res.json();
            if (data.ok && data.lot) {
                lot = data.lot;
                if (!drug) {
                    drug = {
                        id: lot.drug_id,
                        name: lot.drug_name,
                        code: lot.drug_code,
                        unit: lot.drug_unit
                    };
                }
            }
        } catch (e) {
            console.error('Error fetching lot details:', e);
        }
    }

    if (!lot) {
        showToast('ไม่พบข้อมูลล็อตยา', 'error');
        return;
    }

    const drugIdEl = document.getElementById('editLotDrugId');
    const lotIdEl = document.getElementById('editLotId');
    const drugCodeEl = document.getElementById('editLotDrugCode');
    const drugNameEl = document.getElementById('editLotDrugName');
    const unitEl = document.getElementById('editLotUnit');
    const numInput = document.getElementById('editLotNumberInput');
    const qtyInput = document.getElementById('editLotQtyInput');
    const expInput = document.getElementById('editLotExpiryInput');
    const costInput = document.getElementById('editLotCostInput');
    const notesInput = document.getElementById('editLotNotesInput');

    if (drugIdEl) drugIdEl.value = drug ? drug.id : (lot.drug_id || '');
    if (lotIdEl) lotIdEl.value = lot.id;
    if (drugCodeEl) drugCodeEl.textContent = (drug && drug.code) || lot.drug_code || '-';
    if (drugNameEl) drugNameEl.textContent = (drug && drug.name) || lot.drug_name || '-';
    if (unitEl) unitEl.textContent = (drug && drug.unit) || lot.drug_unit || 'หน่วย';

    if (numInput) numInput.value = lot.lot_number || '';
    if (qtyInput) qtyInput.value = lot.stock_qty !== undefined ? lot.stock_qty : 0;
    if (expInput) expInput.value = lot.expiry_date || '';
    if (costInput) costInput.value = (lot.cost_per_unit !== undefined && lot.cost_per_unit !== null) ? lot.cost_per_unit : '';
    if (notesInput) notesInput.value = lot.notes || '';

    const fefoBadge = document.getElementById('editLotFefoBadge');
    if (fefoBadge) {
        fefoBadge.style.display = (drug && drug.lots && drug.lots[0] && drug.lots[0].id === lot.id && lot.stock_qty > 0) ? 'inline-flex' : 'none';
    }

    const modal = document.getElementById('editLotModal');
    if (modal) {
        modal.classList.add('active');
        setTimeout(() => {
            document.getElementById('editLotNumberInput')?.focus();
        }, 100);
    }
}

function closeEditLotModal() {
    const modal = document.getElementById('editLotModal');
    if (modal) {
        modal.classList.remove('active');
    }
}

async function handleSaveLotEdit(event) {
    event.preventDefault();
    const drugId = parseInt(document.getElementById('editLotDrugId').value, 10);
    const lotId = parseInt(document.getElementById('editLotId').value, 10);
    const lotNumber = (document.getElementById('editLotNumberInput').value || '').trim();
    const stockQty = parseFloat(document.getElementById('editLotQtyInput').value);
    const expiryDate = document.getElementById('editLotExpiryInput').value || '';
    const costPerUnit = document.getElementById('editLotCostInput').value;
    const notes = (document.getElementById('editLotNotesInput').value || '').trim();

    if (!lotNumber) {
        showToast('กรุณาระบุเลขล็อต', 'warning');
        return;
    }
    if (isNaN(stockQty) || stockQty < 0) {
        showToast('จำนวนคงเหลือต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป', 'warning');
        return;
    }

    const submitBtn = document.getElementById('btnSaveLotSubmit');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> กำลังบันทึก...';
    }

    try {
        const res = await fetch(`${API_BASE_URL}/api/lots/${lotId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                lot_number: lotNumber,
                stock_qty: stockQty,
                expiry_date: expiryDate,
                cost_per_unit: costPerUnit,
                notes: notes
            })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'ไม่สามารถบันทึกข้อมูลล็อตได้');
        }

        showToast('บันทึกการแก้ไขข้อมูลล็อตเรียบร้อยแล้ว', 'success');
        closeEditLotModal();

        // Preserve subrow expanded state after reloading
        const subrowWasOpen = document.getElementById(`lots-subrow-${drugId}`)?.style.display !== 'none';
        await loadDrugs();
        if (subrowWasOpen) {
            const subrow = document.getElementById(`lots-subrow-${drugId}`);
            const chevron = document.getElementById(`lot-chevron-${drugId}`);
            const badge = document.getElementById(`btn-lot-toggle-${drugId}`);
            if (subrow) subrow.style.display = 'table-row';
            if (chevron) chevron.classList.add('open');
            if (badge) badge.classList.add('active');
        }
    } catch (err) {
        showToast(err.message || 'เกิดข้อผิดพลาดในการบันทึก', 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-check"></i> บันทึกการแก้ไข';
        }
    }
}

async function handleDeleteLot() {
    const drugId = parseInt(document.getElementById('editLotDrugId').value, 10);
    const lotId = parseInt(document.getElementById('editLotId').value, 10);
    const lotNumber = (document.getElementById('editLotNumberInput').value || '').trim();

    const ok = await showConfirmDialog(
        `คุณแน่ใจหรือไม่ว่าต้องการลบล็อต "${lotNumber}" นี้ออกจากระบบ?\n(การลบจะไม่สามารถย้อนกลับได้)`,
        { title: 'ยืนยันการลบล็อตยา', confirmText: 'ลบล็อต', danger: true }
    );
    if (!ok) return;

    const delBtn = document.getElementById('btnDeleteLot');
    if (delBtn) {
        delBtn.disabled = true;
        delBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> กำลังลบ...';
    }

    try {
        const res = await fetch(`${API_BASE_URL}/api/lots/${lotId}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'ไม่สามารถลบล็อตนี้ได้');
        }

        showToast('ลบล็อตยาเรียบร้อยแล้ว', 'success');
        closeEditLotModal();

        const subrowWasOpen = document.getElementById(`lots-subrow-${drugId}`)?.style.display !== 'none';
        await loadDrugs();
        if (subrowWasOpen) {
            const subrow = document.getElementById(`lots-subrow-${drugId}`);
            const chevron = document.getElementById(`lot-chevron-${drugId}`);
            const badge = document.getElementById(`btn-lot-toggle-${drugId}`);
            if (subrow) subrow.style.display = 'table-row';
            if (chevron) chevron.classList.add('open');
            if (badge) badge.classList.add('active');
        }
    } catch (err) {
        showToast(err.message || 'เกิดข้อผิดพลาดในการลบ', 'error');
    } finally {
        if (delBtn) {
            delBtn.disabled = false;
            delBtn.innerHTML = '<i class="fas fa-trash-can"></i> ลบล็อตนี้';
        }
    }
}

function openLotStickerModal(drugId, lotId) {
    const drug = allDrugs.find(d => d.id === Number(drugId) || d.id == drugId);
    if (!drug) return;
    const lot = (drug.lots || []).find(l => l.id === Number(lotId) || l.id == lotId);
    if (!lot) return;

    currentLabelDrug = drug;
    currentLabelLot = lot;

    populateLabelDrugDropdown(drug.id);

    const presetSelect = document.getElementById('labelLayoutPreset');
    if (presetSelect) presetSelect.value = 'a4-standard';
    
    const countInput = document.getElementById('labelPrintCount');
    if (countInput) countInput.value = '24';

    document.getElementById('qrModal').classList.add('active');
    updateLabelPreview();
}

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
    currentLabelLot = null; // default to general drug sticker
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
    currentLabelLot = null;
}

function onLabelDrugChange() {
    const select = document.getElementById('labelDrugSelect');
    if (!select) return;
    const drugId = Number(select.value);
    const drug = allDrugs.find(d => d.id === drugId);
    if (drug) {
        currentLabelDrug = drug;
        currentLabelLot = null; // reset specific lot when switching drugs
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
    const qrPayload = currentLabelLot 
        ? `${origin}/?scan=${encodeURIComponent(drug.code)}&lot=${encodeURIComponent(currentLabelLot.lot_number)}`
        : `${origin}/?scan=${encodeURIComponent(drug.code)}`;
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
                ${showExpiry ? `<div style="font-size: ${config.descSize}; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">EXP: ${escapeHtml((currentLabelLot ? currentLabelLot.expiry_date : drug.expiry_date) || '-')}${currentLabelLot ? ` • Lot: ${escapeHtml(currentLabelLot.lot_number)}` : ''}</div>` : ''}
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
    const qrPayload = currentLabelLot 
        ? `${origin}/?scan=${encodeURIComponent(drug.code)}&lot=${encodeURIComponent(currentLabelLot.lot_number)}`
        : `${origin}/?scan=${encodeURIComponent(drug.code)}`;
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
                    ${showExpiry ? `<div class="drug-exp">EXP: ${escapeHtml((currentLabelLot ? currentLabelLot.expiry_date : drug.expiry_date) || '-')}${currentLabelLot ? ` • Lot: ${escapeHtml(currentLabelLot.lot_number)}` : ''}</div>` : ''}
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
    showToast(`สลับไปใช้กล้อง${currentFacingMode === 'environment' ? 'หลัง' : 'หน้า'}...`, 'info');
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
        showToast(isTorchOn ? 'เปิดไฟฉายแล้ว' : 'ปิดไฟฉายแล้ว', 'info');
    } catch (e) {
        showToast('อุปกรณ์นี้ไม่รองรับการเปิดไฟฉาย', 'info');
    }
}

async function startScanner() {
    isCameraScanLocked = false;
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
    if (isCameraScanLocked) return;
    isCameraScanLocked = true;
    try {
        await stopScanner();
        await handleScannedCode(decodedText);
    } finally {
        setTimeout(() => { isCameraScanLocked = false; }, 1500);
    }
}

async function handleScannedCode(rawCode) {
    if (!rawCode) return;
    
    // Parse URL if the code was a URL (e.g. scanned from regular phone camera or LINE QR)
    let cleanCode = rawCode.trim();
    let urlLot = null;
    if (cleanCode.startsWith('http://') || cleanCode.startsWith('https://')) {
        try {
            const url = new URL(cleanCode);
            urlLot = url.searchParams.get('lot');
            cleanCode = url.searchParams.get('scan') || url.searchParams.get('code') || url.searchParams.get('dispense') || cleanCode;
            if (cleanCode.includes('/') && !cleanCode.startsWith('http')) {
                const parts = cleanCode.split('/');
                cleanCode = parts[parts.length - 1];
            }
        } catch (e) {}
    }
    cleanCode = cleanCode.replace(/^PHARM:/i, '').trim();

    playMedicalBeep();
    showToast(`กำลังตรวจสอบรหัส: ${cleanCode}...`, 'info');

    try {
        let lookupUrl = `/api/drugs/scan-lookup?code=${encodeURIComponent(cleanCode)}`;
        if (urlLot) {
            lookupUrl += `&lot=${encodeURIComponent(urlLot)}`;
        }
        const res = await fetch(lookupUrl);
        const data = await res.json();

        if (data.ok && data.found && data.drug) {
            const drug = data.drug;
            const matchedLotId = data.matched_lot ? data.matched_lot.id : null;
            switchTab('inventory');
            openDispenseModalForDrug(drug.id, 'QR_SCAN', matchedLotId);
            if (data.matched_lot) {
                showToast(`พบยา: ${drug.name} (ล็อต: ${data.matched_lot.lot_number})`, 'success');
            } else {
                showToast(`พบยาในคลัง: ${drug.name}`, 'success');
            }
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
    input.value = '';
    input.blur(); // Swallow trailing scanner keys
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
    showToast('กำลังวิเคราะห์รูปภาพ...', 'info');

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
                showToast(an.message || 'ไม่สามารถตรวจพบชื่อยาจากภาพนี้ได้', 'warning');
            }
        }
    } catch (e) {
        console.error('Scan error:', e);
        showToast('เกิดข้อผิดพลาดในการประมวลผลรูปภาพ', 'error');
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
            showToast('ซิงก์ข้อมูลคลังยาลง Google Sheet สำเร็จแล้ว', 'success');
            loadDashboardStats();
        } else {
            showToast('การซิงก์ Sheet: ' + (data.message || 'Error'), 'error');
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
    const clearBtn = document.getElementById('searchClearBtn');
    const hint = document.getElementById('searchShortcutHint');
    if (searchInput) {
        let debounceTimer;
        searchInput.addEventListener('input', () => {
            if (clearBtn) clearBtn.style.display = searchInput.value ? 'flex' : 'none';
            if (hint) hint.style.display = searchInput.value ? 'none' : 'block';
            clearTimeout(debounceTimer);
            if (paginationState.drugs) paginationState.drugs.currentPage = 1;
            debounceTimer = setTimeout(loadDrugs, 300);
        });
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                clearTimeout(debounceTimer);
                if (paginationState.drugs) paginationState.drugs.currentPage = 1;
                loadDrugs();
            } else if (e.key === 'Escape') {
                clearDrugSearch();
            }
        });
    }

    const catFilter = document.getElementById('categoryFilter');
    if (catFilter) catFilter.addEventListener('change', () => {
        if (catFilter.value === '__manage__') {
            catFilter.value = currentSelectedCategory || 'all';
            openCategoryManagerModal();
            return;
        }
        currentSelectedCategory = catFilter.value;
        if (paginationState.drugs) paginationState.drugs.currentPage = 1;
        loadDrugs();
    });

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
            if (paginationState.drugs) paginationState.drugs.currentPage = 1;
            loadDrugs();
        });
    }

    const expiringCheck = document.getElementById('expiringCheckbox');
    if (expiringCheck) {
        expiringCheck.addEventListener('change', () => {
            updateFilterChipStates();
            if (paginationState.drugs) paginationState.drugs.currentPage = 1;
            loadDrugs();
        });
    }

    const logDate = document.getElementById('logDateFilter');
    if (logDate) logDate.addEventListener('change', () => {
        if (paginationState.logs) paginationState.logs.currentPage = 1;
        loadDispensingLogs();
    });

    const logStartDate = document.getElementById('logStartDateFilter');
    if (logStartDate) logStartDate.addEventListener('change', () => {
        if (paginationState.logs) paginationState.logs.currentPage = 1;
        loadDispensingLogs();
    });

    const logEndDate = document.getElementById('logEndDateFilter');
    if (logEndDate) logEndDate.addEventListener('change', () => {
        if (paginationState.logs) paginationState.logs.currentPage = 1;
        loadDispensingLogs();
    });

    const logChannel = document.getElementById('logChannelFilter');
    if (logChannel) logChannel.addEventListener('change', () => {
        if (paginationState.logs) paginationState.logs.currentPage = 1;
        loadDispensingLogs();
    });

    const stockInSearch = document.getElementById('stockInSearchInput');
    if (stockInSearch) {
        let debounceTimer;
        stockInSearch.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            if (paginationState.stockIn) paginationState.stockIn.currentPage = 1;
            debounceTimer = setTimeout(() => renderStockInTable(stockInLogsList), 250);
        });
        stockInSearch.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                clearTimeout(debounceTimer);
                if (paginationState.stockIn) paginationState.stockIn.currentPage = 1;
                renderStockInTable(stockInLogsList);
            }
        });
    }

    const stockInDate = document.getElementById('stockInDateFilter');
    if (stockInDate) stockInDate.addEventListener('change', () => {
        if (paginationState.stockIn) paginationState.stockIn.currentPage = 1;
        loadStockInLogs();
    });

    const stockInStartDate = document.getElementById('stockInStartDateFilter');
    if (stockInStartDate) stockInStartDate.addEventListener('change', () => {
        if (paginationState.stockIn) paginationState.stockIn.currentPage = 1;
        loadStockInLogs();
    });

    const stockInEndDate = document.getElementById('stockInEndDateFilter');
    if (stockInEndDate) stockInEndDate.addEventListener('change', () => {
        if (paginationState.stockIn) paginationState.stockIn.currentPage = 1;
        loadStockInLogs();
    });

    // Global Keyboard Shortcuts (Linear-grade Pro UX)
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeDrugModal();
            closeDispenseModal();
            closeStockInModal();
            closeEditStockInModal();
            closeQrModal();
            closeGoogleSettingsModal();
            closeLineSettingsModal();
            closeNewBarcodeModal();
            closeImageLightbox();
            closeApkInstallModal();
            closeAuditLogModal();
            closeBatchRequisitionModal();
            closeMobileUserMenu();
            closeRxCartModal();
            closeEditDispenseModal();
            closeEditLotModal();
            closeLotQrModal();
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

function clearDrugSearch() {
    const searchInput = document.getElementById('drugSearchInput');
    const catFilter = document.getElementById('categoryFilter');
    const lowStockCheck = document.getElementById('lowStockCheckbox');
    const expCheck = document.getElementById('expiringCheckbox');
    const clearBtn = document.getElementById('searchClearBtn');
    const hint = document.getElementById('searchShortcutHint');
    if (searchInput) searchInput.value = '';
    if (catFilter) catFilter.value = 'all';
    if (lowStockCheck) lowStockCheck.checked = false;
    if (expCheck) expCheck.checked = false;
    if (clearBtn) clearBtn.style.display = 'none';
    if (hint) hint.style.display = 'block';
    const chipLow = document.getElementById('chipLowStock');
    const chipExp = document.getElementById('chipExpiring');
    if (chipLow) chipLow.classList.remove('active');
    if (chipExp) chipExp.classList.remove('active');
    if (paginationState.drugs) paginationState.drugs.currentPage = 1;
    loadDrugs();
    if (searchInput) searchInput.focus();
}

function searchStockInLogs() {
    if (paginationState.stockIn) paginationState.stockIn.currentPage = 1;
    renderStockInTable(stockInLogsList);
}

function showToast(message, type = 'info', duration = 3200) {
    const toast = document.createElement('div');
    toast.className = 'toast-alert';
    const borderColor = type === 'success' ? 'var(--emerald-600)' : (type === 'error' ? 'var(--rose-600)' : (type === 'warning' ? 'var(--amber-600)' : 'var(--accent)'));
    const iconClass = type === 'success' ? 'fa-check-circle' : (type === 'error' ? 'fa-circle-exclamation' : (type === 'warning' ? 'fa-triangle-exclamation' : 'fa-circle-info'));
    const iconColor = borderColor;

    toast.style.cssText = `
        position: fixed;
        bottom: 1.75rem;
        right: 1.75rem;
        z-index: 10040;
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
        animation: slideUp 0.2s ease;
        max-width: 90vw;
    `;
    toast.innerHTML = `<i class="fas ${iconClass}" style="color: ${iconColor}; font-size: 1rem;"></i> <span>${escapeHtml(message)}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(8px)';
        toast.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
        setTimeout(() => toast.remove(), 260);
    }, duration);
}

function showAppDialog({ title = 'ยืนยันการทำรายการ', message = '', mode = 'confirm', defaultValue = '', placeholder = '', confirmText = 'ยืนยัน', cancelText = 'ยกเลิก', danger = false } = {}) {
    return new Promise((resolve) => {
        const modal = document.getElementById('appDialogModal');
        const titleEl = document.getElementById('appDialogTitle');
        const msgEl = document.getElementById('appDialogMessage');
        const inputGroup = document.getElementById('appDialogInputGroup');
        const inputEl = document.getElementById('appDialogInput');
        const confirmBtn = document.getElementById('appDialogConfirmBtn');
        const cancelBtn = document.getElementById('appDialogCancelBtn');
        const closeBtn = document.getElementById('appDialogCloseBtn');

        if (!modal || !confirmBtn || !cancelBtn) {
            resolve(mode === 'prompt' ? defaultValue : true);
            return;
        }

        titleEl.innerText = title;
        msgEl.innerText = message;
        confirmBtn.innerText = confirmText;
        cancelBtn.innerText = cancelText;
        confirmBtn.className = danger ? 'btn btn-danger' : 'btn btn-primary';

        if (mode === 'prompt') {
            inputGroup.style.display = 'block';
            inputEl.value = defaultValue || '';
            inputEl.placeholder = placeholder || '';
        } else {
            inputGroup.style.display = 'none';
            inputEl.value = '';
        }

        let settled = false;
        const finish = (val) => {
            if (settled) return;
            settled = true;
            document.removeEventListener('keydown', onKeyDown, true);
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            closeBtn.removeEventListener('click', onCancel);
            modal.removeEventListener('click', onOverlayClick);
            modal.classList.remove('active');
            modal.style.display = 'none';
            resolve(val);
        };

        const onConfirm = () => {
            if (mode === 'prompt') {
                const v = (inputEl.value || '').trim();
                if (!v) {
                    inputEl.focus();
                    showToast('กรุณาระบุข้อมูลก่อนยืนยัน', 'warning');
                    return;
                }
                finish(v);
            } else {
                finish(true);
            }
        };
        const onCancel = () => finish(mode === 'prompt' ? null : false);
        const onOverlayClick = (e) => { if (e.target === modal) onCancel(); };
        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onCancel();
            } else if (e.key === 'Enter' && mode === 'prompt' && document.activeElement === inputEl) {
                e.preventDefault();
                onConfirm();
            }
        };

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
        closeBtn.addEventListener('click', onCancel);
        modal.addEventListener('click', onOverlayClick);
        document.addEventListener('keydown', onKeyDown, true);

        modal.style.display = 'flex';
        requestAnimationFrame(() => {
            modal.classList.add('active');
            if (mode === 'prompt') {
                inputEl.focus();
                inputEl.select();
            } else {
                confirmBtn.focus();
            }
        });
    });
}

function showConfirmDialog(message, options = {}) {
    return showAppDialog({ ...options, message, mode: 'confirm' });
}

function showPromptDialog(message, defaultValue = '', options = {}) {
    return showAppDialog({ ...options, message, defaultValue, mode: 'prompt' });
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
// Row Action Dropdown (⋯ More Menu)
// ─────────────────────────────────────────────────────────────

function toggleRowDropdown(drugId, event) {
    event.stopPropagation();
    const menu = document.getElementById(`dropdown-menu-${drugId}`);
    if (!menu) return;
    const isOpen = menu.classList.contains('open');
    closeAllDropdowns();
    if (!isOpen) {
        const toggleBtn = event.currentTarget;
        const rect = toggleBtn.getBoundingClientRect();

        // The sticky actions <td> is its own stacking context (z-index:3). Lift the cell that owns
        // the open menu above its siblings, otherwise the next row's sticky cell paints over the menu.
        const ownerCell = toggleBtn.closest('td');
        if (ownerCell) ownerCell.classList.add('has-open-menu');

        // Use fixed positioning so the dropdown floats freely over table and cannot be clipped by table-wrapper overflow
        menu.style.position = 'fixed';
        menu.style.zIndex = '99999';

        // Measure menu size while temporarily hidden
        menu.style.visibility = 'hidden';
        menu.classList.add('open');
        const menuWidth = menu.offsetWidth || 195;
        const menuHeight = menu.offsetHeight || 215;
        menu.style.visibility = '';

        // Horizontal positioning: align right edge of menu with right edge of button
        let left = rect.right - menuWidth;
        if (left < 10) left = 10;
        if (left + menuWidth > window.innerWidth - 10) {
            left = window.innerWidth - menuWidth - 10;
        }
        menu.style.setProperty('left', `${left}px`, 'important');
        menu.style.setProperty('right', 'auto', 'important');

        // Vertical positioning: default downwards unless not enough room in viewport
        const spaceBelowViewport = window.innerHeight - rect.bottom;
        const spaceAboveViewport = rect.top;

        if (spaceBelowViewport < menuHeight && spaceAboveViewport > spaceBelowViewport) {
            // Flip upwards only when at the bottom of the viewport AND there is more room above
            menu.style.setProperty('top', 'auto', 'important');
            menu.style.setProperty('bottom', `${window.innerHeight - rect.top + 4}px`, 'important');
            menu.classList.add('dropup');
        } else {
            // Open downwards
            menu.style.setProperty('top', `${rect.bottom + 4}px`, 'important');
            menu.style.setProperty('bottom', 'auto', 'important');
            menu.classList.remove('dropup');
        }
    }
}

function toggleToolsDropdown(event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    const menu = document.getElementById('toolsDropdownMenu');
    if (!menu) return;
    const isOpen = menu.classList.contains('open');
    closeAllDropdowns();
    if (!isOpen) {
        menu.classList.add('open');
        menu.style.setProperty('left', '0', 'important');
        menu.style.setProperty('right', 'auto', 'important');
    }
}

function closeAllDropdowns() {
    document.querySelectorAll('td.has-open-menu').forEach(td => td.classList.remove('has-open-menu'));
    document.querySelectorAll('.row-action-dropdown:not(#toolsDropdown) .dropdown-menu.open').forEach(m => {
        m.classList.remove('open');
        m.classList.remove('dropup');
        m.style.removeProperty('position');
        m.style.removeProperty('top');
        m.style.removeProperty('bottom');
        m.style.removeProperty('left');
        m.style.removeProperty('right');
        m.style.removeProperty('z-index');
    });
    const toolsMenu = document.getElementById('toolsDropdownMenu');
    if (toolsMenu) {
        toolsMenu.classList.remove('open');
    }
}

// Close dropdowns when clicking anywhere outside, scrolling, or resizing
document.addEventListener('click', function() {
    closeAllDropdowns();
});
window.addEventListener('scroll', closeAllDropdowns, { passive: true });
window.addEventListener('resize', closeAllDropdowns, { passive: true });
document.addEventListener('scroll', closeAllDropdowns, { passive: true, capture: true });

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
    const ok = await showConfirmDialog(
        'คุณต้องการยกเลิกการเชื่อมต่อกับบัญชี Google นี้ใช่หรือไม่?\n(ข้อมูลในคลังยายังคงอยู่ในเครื่องตามปกติ)',
        { title: 'ยืนยันยกเลิกการเชื่อมต่อ Google', confirmText: 'ยกเลิกเชื่อมต่อ', danger: true }
    );
    if (!ok) return;
    try {
        const res = await fetch('/api/google/disconnect', { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
            showToast('ตัดการเชื่อมต่อ Google เรียบร้อยแล้ว', 'info');
            loadGoogleConfig();
            loadDashboardStats();
        } else {
            showToast('ไม่สามารถตัดการเชื่อมต่อได้: ' + (data.error || 'Error'), 'error');
        }
    } catch (e) {
        console.error('Disconnect error:', e);
        showToast('เกิดข้อผิดพลาดในการตัดการเชื่อมต่อ', 'error');
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
            showToast('บันทึกและเชื่อมต่อ Google Drive & Sheets เรียบร้อยแล้ว', 'success');
            loadGoogleConfig();
            loadDashboardStats();
        } else {
            showToast('ไม่สามารถบันทึกได้: ' + (data.error || 'Error'), 'error');
        }
    } catch (e) {
        console.error('Save google config error:', e);
        showToast('เกิดข้อผิดพลาดในการบันทึก', 'error');
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
            showToast('สร้าง Google Sheet คลังยาสำเร็จแล้ว', 'success');
            loadGoogleConfig();
            loadDashboardStats();
        } else {
            showToast('ไม่สามารถสร้าง Sheet อัตโนมัติได้: ' + (data.error || 'กรุณาตรวจสอบสิทธิ์ของ Service Account'), 'error');
        }
    } catch (e) {
        console.error('Auto create sheet error:', e);
        showToast('เกิดข้อผิดพลาดในการสร้าง Sheet', 'error');
    } finally {
        if (btn) btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> สร้าง Sheet ใหม่อัตโนมัติ';
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
    showToast('กำลังดาวน์โหลด Excel คลังยา...', 'success');
}

function exportLogsExcel() {
    // Pick up active filters from UI
    const startDateVal = document.getElementById('logStartDateFilter')?.value || '';
    const endDateVal   = document.getElementById('logEndDateFilter')?.value || '';
    const dateVal      = document.getElementById('logDateFilter')?.value || '';
    let channelVal     = document.getElementById('logChannelFilter')?.value || 'all';
    if (channelVal === 'QR') channelVal = 'QR_SCAN';
    const params = new URLSearchParams();
    if (startDateVal)                         params.set('start_date', startDateVal);
    if (endDateVal)                           params.set('end_date', endDateVal);
    if (dateVal && !startDateVal && !endDateVal) params.set('date', dateVal);
    if (channelVal && channelVal !== 'all')   params.set('channel', channelVal);

    const link = document.createElement('a');
    link.href = `/api/export/logs?${params.toString()}`;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('กำลังดาวน์โหลด Excel ประวัติการตัดสต็อก...', 'success');
}

// ─────────────────────────────────────────────────────────────
// Official Thai Requisition Forms Export (Single & Batch)
// ─────────────────────────────────────────────────────────────

let currentReqDateMode = 'today';

function openSingleRequisition(logId) {
    if (!logId) return;
    const savedDispenser = localStorage.getItem('pharmacy_formal_dispenser') || '';
    const params = new URLSearchParams();
    if (savedDispenser) {
        params.set('dispenser', savedDispenser);
    }
    const queryString = params.toString() ? `?${params.toString()}` : '';
    const url = `/api/dispense/requisition/${logId}${queryString}`;
    window.open(url, '_blank');
}

function openBatchPrescriptionRequisition(batchId) {
    if (!batchId) return;
    const savedDispenser = localStorage.getItem('pharmacy_formal_dispenser') || '';
    const params = new URLSearchParams();
    if (savedDispenser) {
        params.set('dispenser', savedDispenser);
    }
    const queryString = params.toString() ? `?${params.toString()}` : '';
    const url = `/api/dispense/requisition/batch/${batchId}${queryString}`;
    window.open(url, '_blank');
}

function _localTodayIsoDate() {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];
}

function openBatchRequisitionModal() {
    const modal = document.getElementById('batchRequisitionModal');
    if (!modal) return;

    // Pick active date / range filter from logs table if any
    const startFilter = document.getElementById('logStartDateFilter')?.value || '';
    const endFilter = document.getElementById('logEndDateFilter')?.value || '';
    const activeDate = document.getElementById('logDateFilter')?.value || '';
    const activeChannel = document.getElementById('logChannelFilter')?.value || 'all';

    if (startFilter && endFilter && startFilter === endFilter) {
        setRequisitionDateMode('specific');
        const specInput = document.getElementById('reqSpecificDate');
        if (specInput) specInput.value = startFilter;
    } else if (startFilter || endFilter) {
        setRequisitionDateMode('range');
        const startInput = document.getElementById('reqStartDate');
        const endInput = document.getElementById('reqEndDate');
        const todayStr = _localTodayIsoDate();
        if (startInput) startInput.value = startFilter || endFilter || todayStr;
        if (endInput) endInput.value = endFilter || startFilter || todayStr;
    } else if (activeDate) {
        setRequisitionDateMode('specific');
        const specInput = document.getElementById('reqSpecificDate');
        if (specInput) specInput.value = activeDate;
    } else {
        setRequisitionDateMode('today');
    }

    const channelSelect = document.getElementById('reqChannelFilter');
    if (channelSelect) channelSelect.value = activeChannel;

    // Restore previously used formal name from localStorage if present
    const dispInput = document.getElementById('reqDispenserName');
    if (dispInput) {
        dispInput.value = localStorage.getItem('pharmacy_formal_dispenser') || '';
    }

    modal.classList.add('active');
}

function closeBatchRequisitionModal() {
    const modal = document.getElementById('batchRequisitionModal');
    if (modal) modal.classList.remove('active');
}

function setRequisitionDateMode(mode) {
    currentReqDateMode = mode;
    const btnToday = document.getElementById('btnReqToday');
    const btnSpecific = document.getElementById('btnReqSpecific');
    const btnRange = document.getElementById('btnReqRange');
    const boxSpecific = document.getElementById('reqSpecificDateBox');
    const boxRange = document.getElementById('reqRangeDateBox');

    if (btnToday) btnToday.classList.toggle('active', mode === 'today');
    if (btnSpecific) btnSpecific.classList.toggle('active', mode === 'specific');
    if (btnRange) btnRange.classList.toggle('active', mode === 'range');

    if (boxSpecific) boxSpecific.style.display = mode === 'specific' ? 'block' : 'none';
    if (boxRange) boxRange.style.display = mode === 'range' ? 'block' : 'none';

    // Set defaults using local clinic date (not UTC)
    const todayStr = _localTodayIsoDate();
    if (mode === 'specific') {
        const specInput = document.getElementById('reqSpecificDate');
        if (specInput && !specInput.value) specInput.value = todayStr;
    } else if (mode === 'range') {
        const startInput = document.getElementById('reqStartDate');
        const endInput = document.getElementById('reqEndDate');
        if (startInput && !startInput.value) startInput.value = todayStr;
        if (endInput && !endInput.value) endInput.value = todayStr;
    }
}

function submitGenerateBatchRequisition() {
    let channel = document.getElementById('reqChannelFilter')?.value || 'all';
    if (channel === 'QR') channel = 'QR_SCAN';
    const dept = document.getElementById('reqDeptName')?.value || '';
    const dispenser = document.getElementById('reqDispenserName')?.value?.trim() || '';
    const params = new URLSearchParams();

    if (currentReqDateMode === 'today') {
        const todayStr = _localTodayIsoDate();
        params.set('date', todayStr);
    } else if (currentReqDateMode === 'specific') {
        const dateVal = document.getElementById('reqSpecificDate')?.value;
        if (!dateVal) {
            showToast('กรุณาระบุวันที่ต้องการออกใบเบิก', 'warning');
            return;
        }
        params.set('date', dateVal);
    } else if (currentReqDateMode === 'range') {
        const startVal = document.getElementById('reqStartDate')?.value;
        const endVal = document.getElementById('reqEndDate')?.value;
        if (!startVal || !endVal) {
            showToast('กรุณาระบุช่วงวันที่เริ่มต้นและสิ้นสุด', 'warning');
            return;
        }
        params.set('start_date', startVal);
        params.set('end_date', endVal);
    }

    if (channel && channel !== 'all') {
        params.set('channel', channel);
    }
    if (dept) {
        params.set('requester', dept);
    }
    if (dispenser) {
        localStorage.setItem('pharmacy_formal_dispenser', dispenser);
        params.set('dispenser', dispenser);
    } else {
        localStorage.removeItem('pharmacy_formal_dispenser');
    }

    closeBatchRequisitionModal();
    const url = `/api/dispense/requisition-batch?${params.toString()}`;
    window.open(url, '_blank');
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
            showToast('บันทึกการตั้งค่าแจ้งเตือน LINE เรียบร้อยแล้ว', 'success');
            loadLineConfig();
            loadDashboardStats();
            loadDrugs();
        } else {
            showToast('ไม่สามารถบันทึกได้: ' + (data.error || 'Error'), 'error');
        }
    } catch (err) {
        console.error('Save LINE config error:', err);
        showToast('เกิดข้อผิดพลาดในการบันทึกการตั้งค่า LINE', 'error');
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
            showToast(`ส่งแจ้งเตือนยาใกล้หมดอายุ (${data.expiring_count} รายการ) เข้า LINE สำเร็จแล้ว`, 'success');
            loadLineConfig();
            loadDashboardStats();
        } else if (data.ok && !data.sent) {
            showToast(`${data.message}`, 'info');
        } else {
            showToast('ไม่สามารถส่งข้อความได้: ' + (data.error || 'Unknown Error'), 'error');
        }
    } catch (err) {
        console.error('Send LINE alert error:', err);
        showToast('เกิดข้อผิดพลาดในการส่ง LINE Alert', 'error');
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
    const form = document.getElementById('stockInForm');
    if (form) form.reset();

    const selectEl = document.getElementById('stockInDrugSelect');
    if (selectEl) selectEl.dataset.lastDrugId = '';

    populateStockInDrugSelect(drugId);

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
    if (recByInput) {
        recByInput.value = window.CURRENT_USER_NAME || recByInput.value || 'ผู้ดูแลระบบคลังยา (Admin)';
    }

    setStockInSupplierType('GPO');

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

    const drugId = select.value || '';
    const prevDrugId = select.dataset.lastDrugId || '';
    const drugSwitched = prevDrugId !== String(drugId);
    const preview = document.getElementById('stockInDrugPreview');
    const drug = allDrugs.find(d => Number(d.id) === Number(drugId));

    const expiryInput = document.getElementById('stockInExpiryInput');
    const lotInput = document.getElementById('stockInLotInput');
    const costInput = document.getElementById('stockInCostInput');

    // Prevent stale lot / expiry / cost from a previously selected drug leaking into the newly chosen drug
    if (drugSwitched) {
        if (expiryInput) expiryInput.value = '';
        if (lotInput) lotInput.value = '';
        if (costInput) costInput.value = '';
        select.dataset.lastDrugId = String(drugId);
    }

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

        // Unit selector (box / tablet) and cost per box when the drug has a pack size
        setupStockInUnit(drug, drugSwitched);

        // Auto-fill expiry date if available
        if (expiryInput && !expiryInput.value && drug.expiry_date) {
            expiryInput.value = drug.expiry_date;
        }

        // Auto-fill lot if available
        if (lotInput && !lotInput.value && drug.lot_number) {
            lotInput.value = drug.lot_number;
        }
    } else if (preview) {
        preview.style.display = 'none';
        const costLbl = document.getElementById('stockInCostLabel');
        if (costLbl) costLbl.textContent = 'ราคาทุน (บาท)';
        const unitSel = document.getElementById('stockInUnitSelect');
        if (unitSel) {
            unitSel.innerHTML = '';
            unitSel.style.display = 'none';
        }
    }

    calcStockInTotal();
}

function stockInPackSize(drug) {
    const v = Number(drug && drug.pack_size);
    return v > 1 ? v : 0;
}

function stockInSelectedDrug() {
    const id = document.getElementById('stockInDrugSelect')?.value;
    return allDrugs.find(d => Number(d.id) === Number(id)) || null;
}

function stockInUsesPack() {
    const sel = document.getElementById('stockInUnitSelect');
    return !!sel && sel.style.display !== 'none' && sel.value === 'pack';
}

function updateStockInCostLabel(drug) {
    const label = document.getElementById('stockInCostLabel');
    if (!label) return;
    const unitName = stockInUsesPack() ? (drug.pack_unit || 'กล่อง') : (drug.unit || '');
    label.textContent = unitName ? `ราคาทุน (บาท / ${unitName})` : 'ราคาทุน (บาท)';
}

function setupStockInUnit(drug, resetCost = false) {
    const sel = document.getElementById('stockInUnitSelect');
    const costInput = document.getElementById('stockInCostInput');
    const ps = stockInPackSize(drug);
    if (sel) {
        if (ps) {
            sel.innerHTML = `<option value="pack">${escapeHtml(drug.pack_unit || 'กล่อง')}</option><option value="unit">${escapeHtml(drug.unit || 'หน่วย')}</option>`;
            sel.value = 'pack';
            sel.dataset.mode = 'pack';
            sel.style.display = '';
        } else {
            sel.innerHTML = '';
            sel.dataset.mode = 'unit';
            sel.style.display = 'none';
        }
    }
    if (costInput && (resetCost || !costInput.value || costInput.value === '0')) {
        const c = Number(drug.cost) || 0;
        costInput.value = c ? (ps ? Math.round(c * ps * 100) / 100 : c) : '';
    }
    updateStockInCostLabel(drug);
}

function onStockInUnitChange() {
    const drug = stockInSelectedDrug();
    const sel = document.getElementById('stockInUnitSelect');
    const costInput = document.getElementById('stockInCostInput');
    if (!drug || !sel) return;
    const ps = stockInPackSize(drug);
    const prev = sel.dataset.mode || 'pack';
    const now = sel.value;
    if (ps && costInput && costInput.value && prev !== now) {      // keep the same price, restated per new unit
        const v = parseFloat(costInput.value);
        if (!isNaN(v)) costInput.value = Math.round((now === 'unit' ? v / ps : v * ps) * 1000000) / 1000000;
    }
    sel.dataset.mode = now;
    updateStockInCostLabel(drug);
    calcStockInTotal();
}

function calcStockInTotal() {
    const qty = parseFloat(document.getElementById('stockInQtyInput')?.value || 0);
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
            const ps = stockInPackSize(drug);
            const addUnits = stockInUsesPack() ? qty * ps : qty;
            const newTotal = Number(drug.stock_qty) + addUnits;
            newStockEl.innerText = `${formatQty(newTotal)} ${drug.unit}` + (ps ? ` (≈ ${formatQty(Math.round(newTotal / ps * 100) / 100)} ${drug.pack_unit || 'กล่อง'})` : '');
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

    const qty = parseFloat(document.getElementById('stockInQtyInput')?.value || 0);
    if (isNaN(qty) || qty <= 0) {
        showToast('จำนวนรับเข้าต้องมากกว่า 0', 'warning');
        return;
    }

    const lotNumber = (document.getElementById('stockInLotInput')?.value || '').trim();
    const expiryDate = (document.getElementById('stockInExpiryInput')?.value || '').trim();
    const costRaw = (document.getElementById('stockInCostInput')?.value || '').trim();
    let costPerUnit = null;
    if (costRaw !== '') {
        const parsedCost = parseFloat(costRaw);
        if (isNaN(parsedCost) || parsedCost < 0) {
            showToast('ราคาทุนต้องเป็นตัวเลขที่ไม่ติดลบ', 'warning');
            return;
        }
        costPerUnit = parsedCost;
    }
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
                input_unit: stockInUsesPack() ? 'pack' : 'unit',   // quantity and cost are typed per box when 'pack'
                supplier: supplier,
                received_by: receivedBy,
                notes: notes
            })
        });

        const data = await res.json();
        if (data.ok) {
            showToast(`${data.message}`, 'success');
            closeStockInModal();
            loadDrugs();
            loadDashboardStats();
            if (currentTab === 'stockin') {
                loadStockInLogs();
            } else if (currentTab === 'analytics') {
                loadAnalytics();
            }
        } else {
            showToast('ไม่สามารถรับเข้าสต็อกได้: ' + (data.error || 'Unknown error'), 'error');
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

let currentStockInSupplierType = 'GPO';

function setStockInSupplierType(type) {
    currentStockInSupplierType = type;
    const btnGPO = document.getElementById('btnSupplierTypeGPO');
    const btnCompany = document.getElementById('btnSupplierTypeCompany');
    const btnCarried = document.getElementById('btnSupplierTypeCarriedOver');
    const companyWrap = document.getElementById('companySelectWrapper');
    const carriedWrap = document.getElementById('carriedOverSelectWrapper');
    const supplierInput = document.getElementById('stockInSupplierInput');

    btnGPO?.classList.toggle('active', type === 'GPO');
    btnCompany?.classList.toggle('active', type === 'COMPANY');
    btnCarried?.classList.toggle('active', type === 'CARRIED_OVER');

    if (companyWrap) companyWrap.style.display = (type === 'COMPANY') ? 'block' : 'none';
    if (carriedWrap) carriedWrap.style.display = (type === 'CARRIED_OVER') ? 'block' : 'none';

    if (type === 'GPO') {
        if (supplierInput) supplierInput.value = 'องค์การเภสัชกรรม (GPO)';
    } else if (type === 'CARRIED_OVER') {
        const sel = document.getElementById('stockInCarriedYearSelect');
        const customInp = document.getElementById('stockInCustomCarriedYearInput');
        let yr = sel ? sel.value : '2567';
        if (yr === 'CUSTOM' && customInp && customInp.value.trim()) {
            yr = customInp.value.trim();
        }
        if (supplierInput) supplierInput.value = `ยอดยกมา (ปีงบ ${yr})`;
    } else {
        const sel = document.getElementById('stockInCompanySelect');
        const customInp = document.getElementById('stockInCustomCompanyInput');
        if (sel && sel.value === 'CUSTOM') {
            if (customInp) customInp.style.display = 'block';
            if (supplierInput) supplierInput.value = customInp?.value.trim() || 'บริษัท';
        } else {
            if (customInp) customInp.style.display = 'none';
            if (supplierInput) supplierInput.value = sel?.value || 'บริษัท';
        }
    }
}

function onStockInCarriedYearSelectChange(val) {
    const customInp = document.getElementById('stockInCustomCarriedYearInput');
    const supplierInput = document.getElementById('stockInSupplierInput');
    if (customInp) {
        customInp.style.display = (val === 'CUSTOM') ? 'block' : 'none';
        if (val === 'CUSTOM') customInp.focus();
    }
    let yr = (val === 'CUSTOM') ? (customInp?.value.trim() || '2567') : val;
    if (supplierInput) supplierInput.value = `ยอดยกมา (ปีงบ ${yr})`;
}

function onStockInCustomCarriedYearInput(val) {
    const supplierInput = document.getElementById('stockInSupplierInput');
    const yr = val.trim() || '2567';
    if (supplierInput) supplierInput.value = `ยอดยกมา (ปีงบ ${yr})`;
}

function onStockInCompanySelectChange(val) {
    const customInp = document.getElementById('stockInCustomCompanyInput');
    const supplierInput = document.getElementById('stockInSupplierInput');
    if (val === 'CUSTOM') {
        if (customInp) {
            customInp.style.display = 'block';
            customInp.focus();
            if (supplierInput) supplierInput.value = customInp.value.trim() || 'บริษัท';
        }
    } else {
        if (customInp) customInp.style.display = 'none';
        if (supplierInput) supplierInput.value = val || 'บริษัท';
    }
}

function onCustomCompanyInput(val) {
    const supplierInput = document.getElementById('stockInSupplierInput');
    if (supplierInput) {
        supplierInput.value = val.trim() || 'บริษัท';
    }
}

async function loadStockInLogs() {
    const tbody = document.getElementById('stockInTableBody');
    const cards = document.getElementById('stockInMobileCards');
    const startDate = document.getElementById('stockInStartDateFilter')?.value || '';
    const endDate = document.getElementById('stockInEndDateFilter')?.value || '';
    const legacyDate = document.getElementById('stockInDateFilter')?.value || '';

    let url = '/api/stock-in/logs?limit=100';
    if (startDate && endDate) {
        url += `&start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`;
    } else if (startDate) {
        url += `&start_date=${encodeURIComponent(startDate)}`;
    } else if (endDate) {
        url += `&end_date=${encodeURIComponent(endDate)}`;
    } else if (legacyDate) {
        url += `&date=${encodeURIComponent(legacyDate)}`;
    }

    try {
        const res = await fetch(url);
        const data = await res.json();
        if (data.ok) {
            stockInLogsList = data.logs || [];
            renderStockInTable(stockInLogsList);
        }
    } catch (err) {
        console.error('Load Stock In Logs error:', err);
        if (tbody) tbody.innerHTML = `<tr><td colspan="12" style="text-align: center; color: var(--rose-600); padding: 1.5rem;">เกิดข้อผิดพลาดในการโหลดประวัติรับยา</td></tr>`;
    }
}

function renderStockInTable(logs) {
    stockInLogsList = logs || [];
    const tbody = document.getElementById('stockInTableBody');
    const cards = document.getElementById('stockInMobileCards');
    const paginationWrapper = document.getElementById('stockInPaginationWrapper');
    const searchVal = (document.getElementById('stockInSearchInput')?.value || '').trim().toLowerCase();

    const filtered = (logs || []).filter(l => {
        if (!searchVal) return true;
        return (
            (l.drug_name && l.drug_name.toLowerCase().includes(searchVal)) ||
            (l.drug_code && l.drug_code.toLowerCase().includes(searchVal)) ||
            (l.lot_number && l.lot_number.toLowerCase().includes(searchVal)) ||
            (l.supplier && l.supplier.toLowerCase().includes(searchVal)) ||
            (l.notes && l.notes.toLowerCase().includes(searchVal))
        );
    });

    if (filtered.length === 0) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="12" style="text-align: center; color: var(--text-muted); padding: 2.5rem;"><i class="fas fa-inbox" style="font-size: 2rem; margin-bottom: 0.5rem; display: block; opacity: 0.4;"></i>ยังไม่มีประวัติการรับยาเข้าสต็อก</td></tr>`;
        }
        if (cards) {
            cards.innerHTML = `<div style="text-align: center; padding: 2.5rem 1rem; color: var(--text-muted); background: var(--bg-surface); border-radius: 12px; border: 1px dashed var(--border-default);"><i class="fas fa-inbox" style="font-size: 2rem; margin-bottom: 0.5rem; display: block; opacity: 0.4;"></i>ยังไม่มีประวัติรับยาเข้า</div>`;
        }
        if (paginationWrapper) paginationWrapper.innerHTML = '';
        return;
    }

    const state = paginationState.stockIn;
    const totalItems = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / state.pageSize));
    if (state.currentPage > totalPages) state.currentPage = totalPages;
    if (state.currentPage < 1) state.currentPage = 1;

    const startIdx = (state.currentPage - 1) * state.pageSize;
    const pagedStockIn = filtered.slice(startIdx, startIdx + state.pageSize);

    if (tbody) {
        tbody.innerHTML = pagedStockIn.map(l => {
                const drugImg = l.image_url || (typeof allDrugs !== 'undefined' && allDrugs.find(d => Number(d.id) === Number(l.drug_id) || (d.code && l.drug_code && d.code.trim().toUpperCase() === l.drug_code.trim().toUpperCase()))?.image_url);
                const thumbHtml = drugImg
                    ? `<div class="drug-table-thumb" onclick="openImageLightbox('${escapeHtml(drugImg)}', '${escapeHtml(l.drug_name)}', '${escapeHtml(l.drug_code || '')}')" title="คลิกดูภาพขยาย">
                         <img src="${escapeHtml(drugImg)}" alt="${escapeHtml(l.drug_name)}" loading="lazy" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'drug-table-thumb-fallback\\'><i class=\\'fas fa-pills\\'></i></div>';">
                       </div>`
                    : `<div class="drug-table-thumb-fallback" title="ยังไม่มีภาพยา"><i class="fas fa-pills"></i></div>`;

                let inDtHtml = '<span class="log-muted">-</span>';
                if (l.created_at) {
                    const parts = l.created_at.trim().split(' ');
                    inDtHtml = parts.length === 2
                        ? `<div class="log-date">${escapeHtml(parts[0])}</div><div class="log-muted">${escapeHtml(parts[1].slice(0, 5))}</div>`
                        : `<div class="log-date">${escapeHtml(l.created_at)}</div>`;
                }
                const receiver = escapeHtml((!l.received_by || l.received_by === 'เภสัชกร/เจ้าหน้าที่' || l.received_by === 'เจ้าหน้าที่') ? (window.CURRENT_USER_NAME || l.received_by || '-') : l.received_by);

                return `
                    <tr class="${l.is_voided ? 'log-row-voided' : ''}">
                        <td class="col-thumb">
                            ${thumbHtml}
                        </td>
                        <td class="col-datetime">
                            ${inDtHtml}
                        </td>
                        <td>
                            <div class="log-drug-name">${escapeHtml(l.drug_name)}</div>
                            <div class="log-muted">${escapeHtml(l.drug_code || '-')}</div>
                        </td>
                        <td>
                            <span class="log-person">${l.lot_number ? escapeHtml(l.lot_number) : '-'}</span>
                        </td>
                        <td style="text-align: center;">
                            <span class="log-qty is-in">+${l.quantity}</span>
                            ${l.is_voided ? '<div class="log-voided-tag">ยกเลิกแล้ว</div>' : ''}
                        </td>
                        <td style="text-align: center; white-space: nowrap;">
                            <span class="log-muted">${l.balance_before} →</span> <strong class="log-after">${l.balance_after}</strong>
                        </td>
                        <td class="log-muted">
                            ${l.cost_per_unit ? `฿${parseFloat(l.cost_per_unit).toFixed(2)}` : '-'}
                        </td>
                        <td class="log-person" style="${l.is_voided ? 'text-decoration: line-through;' : ''}">
                            ${l.total_cost ? `฿${parseFloat(l.total_cost).toLocaleString('th-TH', { minimumFractionDigits: 2 })}` : '-'}
                        </td>
                        <td class="log-channel">
                            ${escapeHtml(l.supplier || '-')}
                        </td>
                        <td class="log-muted">
                            ${escapeHtml(l.expiry_date || '-')}
                        </td>
                        <td style="word-break: break-word; overflow-wrap: anywhere; min-width: 150px;">
                            <div class="log-person">${receiver}</div>
                            ${l.notes ? `<div class="log-muted">${escapeHtml(l.notes)}</div>` : ''}
                            ${l.is_voided && l.void_reason ? `<div class="log-void-reason">เหตุผล: ${escapeHtml(l.void_reason)}${l.voided_by ? ' (' + escapeHtml(l.voided_by) + ')' : ''}</div>` : ''}
                        </td>
                        <td style="text-align: center; white-space: nowrap;">
                            ${l.is_voided ? '<span class="log-voided-tag">ยกเลิกแล้ว</span>' : `
                                <div class="log-actions">
                                    <button type="button" class="log-btn" onclick="openEditStockInModal(${l.id})" title="แก้ไขรายการรับเข้าย้อนหลัง">แก้ไข</button>
                                    <button type="button" class="log-btn log-btn-danger" onclick="voidStockInRecord(${l.id})" title="ยกเลิกรายการรับเข้าและปรับลดยาออกจากสต็อก">ยกเลิก</button>
                                </div>
                            `}
                        </td>
                    </tr>
                `;
            }).join('');
        }

    if (cards) {
        if (filtered.length === 0) {
            cards.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 2rem;">ยังไม่มีรายการรับยาเข้า</div>`;
        } else {
            cards.innerHTML = pagedStockIn.map(l => {
                const drugImg = l.image_url || (typeof allDrugs !== 'undefined' && allDrugs.find(d => Number(d.id) === Number(l.drug_id) || (d.code && l.drug_code && d.code.trim().toUpperCase() === l.drug_code.trim().toUpperCase()))?.image_url);
                const mobileThumbHtml = drugImg
                    ? `<div class="drug-card-thumb" onclick="openImageLightbox('${escapeHtml(drugImg)}', '${escapeHtml(l.drug_name)}', '${escapeHtml(l.drug_code || '')}')" title="คลิกดูภาพขยาย" style="width: 44px; height: 44px; min-width: 44px; max-width: 44px; min-height: 44px; max-height: 44px; border-radius: 8px; overflow: hidden; display: flex; align-items: center; justify-content: center; background: var(--bg-subtle); border: 1px solid var(--border-default); cursor: pointer; flex-shrink: 0;">
                         <img src="${escapeHtml(drugImg)}" alt="${escapeHtml(l.drug_name)}" loading="lazy" style="width: 44px; height: 44px; object-fit: cover; border-radius: 7px;" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'drug-card-thumb-fallback\\' style=\\'width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:var(--bg-subtle);border:1px solid var(--border-subtle);color:var(--text-subtle);\\'><i class=\\'fas fa-pills\\'></i></div>';">
                       </div>`
                    : `<div class="drug-card-thumb-fallback" title="ยังไม่มีภาพยา" style="width: 44px; height: 44px; min-width: 44px; max-width: 44px; min-height: 44px; max-height: 44px; border-radius: 8px; display: flex; align-items: center; justify-content: center; background: var(--bg-subtle); border: 1px solid var(--border-subtle); color: var(--text-subtle); flex-shrink: 0;">
                         <i class="fas fa-pills"></i>
                       </div>`;

                const isGpo = l.supplier && (l.supplier.includes('GPO') || l.supplier.includes('องค์การ'));
                const supplierBadge = `<span class="log-channel">${isGpo ? 'GPO' : 'บริษัท'}</span>`;

                return `
                    <div class="log-mobile-card" style="${l.is_voided ? 'opacity: 0.65;' : ''}">
                        <div style="display: flex; gap: 0.75rem; align-items: flex-start; margin-bottom: 0.5rem;">
                            ${mobileThumbHtml}
                            <div style="flex: 1; min-width: 0;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
                                    <span class="code-pill">${escapeHtml(l.drug_code || '-')}</span>
                                    ${l.is_voided
                                        ? `<div><span style="text-decoration: line-through; color: var(--text-muted); font-weight: 600; font-size: 0.85rem;">+${l.quantity}</span> <span class="log-voided-tag">ยกเลิกแล้ว</span></div>`
                                        : `<span class="log-qty is-in">+${l.quantity}</span>`
                                    }
                                </div>
                                <div style="font-weight: 700; font-size: 1rem; color: var(--text-primary); line-height: 1.35;">${escapeHtml(l.drug_name)}</div>
                                ${l.generic_name ? `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">${escapeHtml(l.generic_name)}</div>` : ''}
                            </div>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8125rem; color: var(--text-secondary); margin-bottom: 0.35rem;">
                            <span>คงเหลือ: ${l.balance_before} &rarr; <strong class="log-after">${l.balance_after}</strong></span>
                            ${l.lot_number ? `<span>Lot: <code>${escapeHtml(l.lot_number)}</code></span>` : ''}
                        </div>
                        <div style="font-size: 0.8125rem; color: var(--text-secondary); margin-bottom: 0.5rem;">
                            <span>มูลค่า: <strong style="${l.is_voided ? 'color: var(--text-muted); text-decoration: line-through;' : 'color: #059669;'}">฿${l.total_cost ? parseFloat(l.total_cost).toLocaleString('th-TH', { minimumFractionDigits: 2 }) : '0.00'}</strong></span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; color: var(--text-muted); border-top: 1px solid var(--border-subtle); padding-top: 0.4rem;">
                            <span>${supplierBadge} ${escapeHtml(l.supplier || '-')}</span>
                            <span><i class="far fa-clock"></i> ${escapeHtml(l.created_at)}</span>
                        </div>
                        <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">
                            <div><i class="fas fa-user-check" style="color: var(--brand-500); font-size: 0.7rem;"></i> ผู้ตรวจรับ: <strong>${escapeHtml((!l.received_by || l.received_by === 'เภสัชกร/เจ้าหน้าที่' || l.received_by === 'เจ้าหน้าที่') ? (window.CURRENT_USER_NAME || l.received_by || '-') : l.received_by)}</strong></div>
                            ${l.notes ? `<div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px;"><i class="fas fa-note-sticky"></i> ${escapeHtml(l.notes)}</div>` : ''}
                            ${l.is_voided && l.void_reason ? `
                                <div style="font-size: 0.7rem; color: #DC2626; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 4px; padding: 2px 6px; margin-top: 3px; line-height: 1.35; white-space: normal !important; word-break: break-all;">
                                    <i class="fas fa-circle-exclamation"></i> เหตุผล: ${escapeHtml(l.void_reason)} (${escapeHtml(l.voided_by || '')})
                                </div>` : ''}
                        </div>
                        <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.45rem; padding-top: 0.45rem; border-top: 1px dashed var(--border-subtle);">
                            ${l.is_voided ? `
                                <span class="badge" style="background: rgba(239, 68, 68, 0.08); color: #DC2626; border: 1px solid rgba(239, 68, 68, 0.25); font-size: 0.725rem; padding: 2px 8px;">
                                    <i class="fas fa-ban"></i> รายการนี้ถูกยกเลิกแล้ว
                                </span>
                            ` : `
                                <button type="button" class="btn btn-outline btn-xs" onclick="openEditStockInModal(${l.id})" style="font-size: 0.75rem; color: #0284C7; border-color: #BAE6FD;">
                                    <i class="fas fa-pen-to-square"></i> แก้ไขย้อนหลัง
                                </button>
                                <button type="button" class="btn btn-outline btn-xs" onclick="voidStockInRecord(${l.id})" style="font-size: 0.75rem; color: #DC2626; border-color: #FECACA; display: inline-flex; align-items: center; gap: 3px;">
                                    <i class="fas fa-rotate-left"></i> ยกเลิก
                                </button>
                            `}
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    renderPaginationBar('stockInPaginationWrapper', 'stockIn', totalItems);
}

function clearStockInFilters() {
    const s = document.getElementById('stockInStartDateFilter');
    const e = document.getElementById('stockInEndDateFilter');
    const leg = document.getElementById('stockInDateFilter');
    if (s) s.value = '';
    if (e) e.value = '';
    if (leg) leg.value = '';
    const searchInput = document.getElementById('stockInSearchInput');
    if (searchInput) searchInput.value = '';
    if (paginationState.stockIn) paginationState.stockIn.currentPage = 1;
    loadStockInLogs();
}

function exportStockInExcel() {
    const startDateVal = document.getElementById('stockInStartDateFilter')?.value || '';
    const endDateVal   = document.getElementById('stockInEndDateFilter')?.value || '';
    const dateVal      = document.getElementById('stockInDateFilter')?.value || '';
    const params = new URLSearchParams();
    if (startDateVal)                             params.set('start_date', startDateVal);
    if (endDateVal)                               params.set('end_date', endDateVal);
    if (dateVal && !startDateVal && !endDateVal) params.set('date', dateVal);

    const link = document.createElement('a');
    link.href = `/api/export/stock-in?${params.toString()}`;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('กำลังดาวน์โหลด Excel ประวัติการรับยาเข้า...', 'success');
}

// ─────────────────────────────────────────────────────────────
// Retrospective Stock-In Edit Modal Functions
// ─────────────────────────────────────────────────────────────

let currentEditSupplierType = 'GPO';

function setEditSupplierType(type) {
    currentEditSupplierType = type;
    const btnGPO = document.getElementById('btnEditSupplierTypeGPO');
    const btnCompany = document.getElementById('btnEditSupplierTypeCompany');
    const btnCarried = document.getElementById('btnEditSupplierTypeCarriedOver');
    const companyWrap = document.getElementById('editCompanySelectWrapper');
    const carriedWrap = document.getElementById('editCarriedOverSelectWrapper');
    const supplierInput = document.getElementById('editStockInSupplier');

    btnGPO?.classList.toggle('active', type === 'GPO');
    btnCompany?.classList.toggle('active', type === 'COMPANY');
    btnCarried?.classList.toggle('active', type === 'CARRIED_OVER');

    if (companyWrap) companyWrap.style.display = (type === 'COMPANY') ? 'block' : 'none';
    if (carriedWrap) carriedWrap.style.display = (type === 'CARRIED_OVER') ? 'block' : 'none';

    if (type === 'GPO') {
        if (supplierInput) supplierInput.value = 'องค์การเภสัชกรรม (GPO)';
    } else if (type === 'CARRIED_OVER') {
        const sel = document.getElementById('editStockInCarriedYearSelect');
        const customInp = document.getElementById('editStockInCustomCarriedYearInput');
        let yr = sel ? sel.value : '2567';
        if (yr === 'CUSTOM' && customInp && customInp.value.trim()) {
            yr = customInp.value.trim();
        }
        if (supplierInput) supplierInput.value = `ยอดยกมา (ปีงบ ${yr})`;
    } else {
        const sel = document.getElementById('editStockInCompanySelect');
        const customInp = document.getElementById('editStockInCustomCompany');
        if (sel && sel.value === 'CUSTOM') {
            if (customInp) customInp.style.display = 'block';
            if (supplierInput) supplierInput.value = customInp?.value.trim() || 'บริษัท';
        } else {
            if (customInp) customInp.style.display = 'none';
            if (supplierInput) supplierInput.value = sel?.value || 'บริษัท';
        }
    }
}

function onEditStockInCarriedYearSelectChange(val) {
    const customInp = document.getElementById('editStockInCustomCarriedYearInput');
    const supplierInput = document.getElementById('editStockInSupplier');
    if (customInp) {
        customInp.style.display = (val === 'CUSTOM') ? 'block' : 'none';
        if (val === 'CUSTOM') customInp.focus();
    }
    let yr = (val === 'CUSTOM') ? (customInp?.value.trim() || '2567') : val;
    if (supplierInput) supplierInput.value = `ยอดยกมา (ปีงบ ${yr})`;
}

function onEditStockInCustomCarriedYearInput(val) {
    const supplierInput = document.getElementById('editStockInSupplier');
    const yr = val.trim() || '2567';
    if (supplierInput) supplierInput.value = `ยอดยกมา (ปีงบ ${yr})`;
}

function onEditCompanySelectChange(val) {
    const customInp = document.getElementById('editStockInCustomCompany');
    const supplierInput = document.getElementById('editStockInSupplier');
    if (val === 'CUSTOM') {
        if (customInp) {
            customInp.style.display = 'block';
            customInp.focus();
            if (supplierInput) supplierInput.value = customInp.value.trim() || 'บริษัท';
        }
    } else {
        if (customInp) customInp.style.display = 'none';
        if (supplierInput) supplierInput.value = val || 'บริษัท';
    }
}

function onEditCustomCompanyInput(val) {
    const supplierInput = document.getElementById('editStockInSupplier');
    if (supplierInput) {
        supplierInput.value = val.trim() || 'บริษัท';
    }
}

function openEditStockInModal(logId) {
    const log = stockInLogsList.find(l => Number(l.id) === Number(logId));
    if (!log) {
        showToast('ไม่พบข้อมูลรายการรับยานี้', 'error');
        return;
    }
    if (log.is_voided) {
        showToast('รายการรับยานี้ถูกยกเลิกไปแล้ว ไม่สามารถแก้ไขได้', 'warning');
        return;
    }

    document.getElementById('editStockInId').value = log.id;
    document.getElementById('editStockInDrugId').value = log.drug_id || '';
    document.getElementById('editStockInOriginalQty').value = log.quantity || 0;

    document.getElementById('editPreviewDrugCode').textContent = log.drug_code || '-';
    document.getElementById('editPreviewDrugName').textContent = log.drug_name || '-';
    
    const drug = typeof allDrugs !== 'undefined' ? allDrugs.find(d => Number(d.id) === Number(log.drug_id)) : null;
    const curStock = drug ? drug.stock_qty : (log.current_drug_stock || log.balance_after || 0);
    const unitStr = drug ? drug.unit : (log.unit || 'หน่วย');
    document.getElementById('editPreviewCurrentStock').textContent = curStock;
    document.getElementById('editPreviewUnit').textContent = unitStr;

    // Created At datetime-local formatted
    const createdAtInput = document.getElementById('editStockInCreatedAt');
    if (createdAtInput) {
        let val = (log.created_at || '').trim();
        if (val.includes(' ')) {
            val = val.replace(' ', 'T');
        }
        createdAtInput.value = val;
    }

    const baseQty = Number(log.quantity || 0);
    const ps = stockInPackSize(drug);
    const editUnitSel = document.getElementById('editStockInUnitSelect');
    let usePack = false;
    if (ps) {
        const noteMentionsPack = String(log.notes || '').includes('[รับ ');
        const isExactMultiple = baseQty >= ps && Math.abs((baseQty / ps) - Math.round(baseQty / ps)) < 1e-6;
        usePack = noteMentionsPack || isExactMultiple;
        if (editUnitSel) {
            editUnitSel.innerHTML = `<option value="pack">${escapeHtml(drug.pack_unit || 'กล่อง')}</option><option value="unit">${escapeHtml(unitStr)}</option>`;
            editUnitSel.value = usePack ? 'pack' : 'unit';
            editUnitSel.dataset.mode = editUnitSel.value;
            editUnitSel.style.display = '';
        }
    } else if (editUnitSel) {
        editUnitSel.innerHTML = '';
        editUnitSel.dataset.mode = 'unit';
        editUnitSel.style.display = 'none';
    }

    document.getElementById('editStockInQty').value = usePack
        ? Math.round((baseQty / ps) * 10000) / 10000
        : (baseQty || 1);
    document.getElementById('editStockInLot').value = log.lot_number || '';
    document.getElementById('editStockInExpiry').value = log.expiry_date || '';
    const unitCostVal = Number(log.cost_per_unit || 0);
    document.getElementById('editStockInCost').value = unitCostVal > 0
        ? (usePack ? Math.round(unitCostVal * ps * 100) / 100 : unitCostVal)
        : '';
    updateEditStockInCostLabel(drug, unitStr);
    let editRecVal = (log.received_by || '').trim();
    if (!editRecVal || editRecVal === 'เภสัชกร/เจ้าหน้าที่' || editRecVal === 'เจ้าหน้าที่') {
        editRecVal = window.CURRENT_USER_NAME || editRecVal || 'ผู้ดูแลระบบคลังยา (Admin)';
    }
    document.getElementById('editStockInReceivedBy').value = editRecVal;
    document.getElementById('editStockInNotes').value = log.notes || '';

    // Supplier init
    const sup = log.supplier || '';
    const isGpo = sup.includes('GPO') || sup.includes('องค์การ');
    const isCarried = sup.includes('ยอดยกมา') || sup.includes('ยกยอด');
    if (isGpo) {
        setEditSupplierType('GPO');
    } else if (isCarried) {
        setEditSupplierType('CARRIED_OVER');
        const sel = document.getElementById('editStockInCarriedYearSelect');
        const customInp = document.getElementById('editStockInCustomCarriedYearInput');
        const m = sup.match(/\d{4}/);
        const yr = m ? m[0] : '2569';
        const standardYears = ['2570', '2569', '2568', '2567'];
        if (sel) {
            if (standardYears.includes(yr)) {
                sel.value = yr;
                if (customInp) customInp.style.display = 'none';
            } else {
                sel.value = 'CUSTOM';
                if (customInp) {
                    customInp.style.display = 'block';
                    customInp.value = yr;
                }
            }
        }
        document.getElementById('editStockInSupplier').value = sup;
    } else {
        setEditSupplierType('COMPANY');
        const sel = document.getElementById('editStockInCompanySelect');
        const customInp = document.getElementById('editStockInCustomCompany');
        let found = false;
        if (sel) {
            for (let opt of sel.options) {
                if (opt.value === sup) {
                    sel.value = sup;
                    found = true;
                    break;
                }
            }
            if (!found) {
                sel.value = 'CUSTOM';
                if (customInp) {
                    customInp.style.display = 'block';
                    customInp.value = sup;
                }
            } else {
                if (customInp) customInp.style.display = 'none';
            }
        }
        document.getElementById('editStockInSupplier').value = sup;
    }

    calcEditStockInImpact();

    // Check if cancel button should warn or disable
    const delBtn = document.getElementById('btnDeleteFromEditModal');
    if (delBtn) {
        if (curStock < (log.quantity || 0)) {
            delBtn.title = `ไม่สามารถยกเลิกได้เพราะยาถูกจ่ายไปแล้วจนเหลือคงคลัง ${curStock} หน่วย (น้อยกว่ายอดรับเข้า ${log.quantity})`;
            delBtn.style.opacity = '0.45';
        } else {
            delBtn.title = 'ยกเลิกรายการนี้';
            delBtn.style.opacity = '1';
        }
    }

    const modal = document.getElementById('editStockInModal');
    if (modal) modal.classList.add('active');
}

function closeEditStockInModal() {
    const modal = document.getElementById('editStockInModal');
    if (modal) modal.classList.remove('active');
}

function editStockInSelectedDrug() {
    const did = document.getElementById('editStockInDrugId')?.value;
    return (typeof allDrugs !== 'undefined' && did) ? allDrugs.find(d => Number(d.id) === Number(did)) : null;
}

function editStockInUsesPack() {
    const sel = document.getElementById('editStockInUnitSelect');
    return !!sel && sel.style.display !== 'none' && sel.value === 'pack';
}

function updateEditStockInCostLabel(drug, fallbackUnit = '') {
    const label = document.getElementById('editStockInCostLabel');
    if (!label) return;
    const baseU = (drug && drug.unit) || fallbackUnit || document.getElementById('editPreviewUnit')?.textContent || 'หน่วย';
    const unitName = editStockInUsesPack() ? ((drug && drug.pack_unit) || 'กล่อง') : baseU;
    label.textContent = unitName ? `ราคาทุน (บาท / ${unitName})` : 'ราคาทุน (บาท)';
}

function onEditStockInUnitChange() {
    const drug = editStockInSelectedDrug();
    const sel = document.getElementById('editStockInUnitSelect');
    const qtyInp = document.getElementById('editStockInQty');
    const costInp = document.getElementById('editStockInCost');
    const ps = stockInPackSize(drug);
    if (!sel || !ps) return;
    const prev = sel.dataset.mode || 'unit';
    const now = sel.value;
    if (prev !== now) {
        if (qtyInp && qtyInp.value) {
            const qv = parseFloat(qtyInp.value);
            if (!isNaN(qv)) qtyInp.value = Math.round((now === 'pack' ? qv / ps : qv * ps) * 10000) / 10000;
        }
        if (costInp && costInp.value) {
            const cv = parseFloat(costInp.value);
            if (!isNaN(cv)) costInp.value = Math.round((now === 'unit' ? cv / ps : cv * ps) * 1000000) / 1000000;
        }
    }
    sel.dataset.mode = now;
    updateEditStockInCostLabel(drug);
    calcEditStockInImpact();
}

function calcEditStockInImpact() {
    const drug = editStockInSelectedDrug();
    const ps = stockInPackSize(drug);
    const usesPack = editStockInUsesPack() && ps > 1;
    const origQty = parseFloat(document.getElementById('editStockInOriginalQty')?.value || '0');
    const inputQty = parseFloat(document.getElementById('editStockInQty')?.value || '0');
    const newBaseQty = usesPack ? (inputQty * ps) : inputQty;
    const cost = parseFloat(document.getElementById('editStockInCost')?.value || '0') || 0;
    
    const totalCostInp = document.getElementById('editStockInTotalCost');
    if (totalCostInp) {
        totalCostInp.value = '฿' + (inputQty * cost).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    const curStock = parseFloat(document.getElementById('editPreviewCurrentStock')?.textContent || '0');
    const diff = Math.round((newBaseQty - origQty) * 1000000) / 1000000;
    const unitLabel = (drug && drug.unit) || document.getElementById('editPreviewUnit')?.textContent || 'หน่วย';
    const hintEl = document.getElementById('editStockInImpactHint');
    const saveBtn = document.getElementById('btnSaveEditStockIn');

    if (hintEl) {
        if (diff === 0) {
            hintEl.textContent = usesPack
                ? `รับเข้า ${inputQty} ${drug?.pack_unit || 'กล่อง'} (${newBaseQty} ${unitLabel}) • ยอดรวมเท่าเดิม ไม่กระทบสต็อกปัจจุบัน`
                : 'จำนวนรับเข้าเท่าเดิม ไม่กระทบสต็อกปัจจุบัน';
            hintEl.style.color = 'var(--text-muted)';
            if (saveBtn) saveBtn.disabled = false;
        } else if (diff > 0) {
            hintEl.innerHTML = `<i class="fas fa-arrow-trend-up"></i> สต็อกยาจะเพิ่มขึ้น +${diff} ${unitLabel} (จากคงเหลือ ${curStock} &rarr; <strong>${curStock + diff}</strong> ${unitLabel})`;
            hintEl.style.color = '#059669';
            if (saveBtn) saveBtn.disabled = false;
        } else {
            // User is reducing received quantity
            if (curStock + diff < 0) {
                hintEl.innerHTML = `<i class="fas fa-triangle-exclamation"></i> <strong>ไม่สามารถลดยอดรับเข้าเหลือ ${newBaseQty} ${unitLabel} ได้:</strong> ยานี้ถูกตัดจ่ายไปแล้วจนเหลือในคลังเพียง ${curStock} ${unitLabel} หากลดลง ${Math.abs(diff)} ${unitLabel} สต็อกจะติดลบ (${curStock + diff}) ระบบจึงล็อคป้องกันไว้`;
                hintEl.style.color = '#DC2626';
                if (saveBtn) saveBtn.disabled = true;
            } else {
                hintEl.innerHTML = `<i class="fas fa-arrow-trend-down"></i> สต็อกยาจะลดลง ${diff} ${unitLabel} (จากคงเหลือ ${curStock} &rarr; <strong>${curStock + diff}</strong> ${unitLabel})`;
                hintEl.style.color = '#D97706';
                if (saveBtn) saveBtn.disabled = false;
            }
        }
    }
}

async function saveEditStockIn(event) {
    event.preventDefault();
    const logId = document.getElementById('editStockInId')?.value;
    if (!logId) return;

    const qtyVal = parseFloat(document.getElementById('editStockInQty')?.value || '');
    if (isNaN(qtyVal) || qtyVal <= 0) {
        showToast('จำนวนรับเข้าต้องมากกว่า 0', 'warning');
        return;
    }

    const costRaw = (document.getElementById('editStockInCost')?.value || '').trim();
    let costPerUnit = null;
    if (costRaw !== '') {
        const c = parseFloat(costRaw);
        if (isNaN(c) || c < 0) {
            showToast('ราคาทุนต้องเป็นตัวเลขที่ไม่ติดลบ', 'warning');
            return;
        }
        costPerUnit = c;
    }

    const btn = document.getElementById('btnSaveEditStockIn');
    if (btn) btn.disabled = true;

    let createdAtVal = document.getElementById('editStockInCreatedAt')?.value || '';
    if (createdAtVal.includes('T')) {
        createdAtVal = createdAtVal.replace('T', ' ');
    }

    const payload = {
        quantity: qtyVal,
        input_unit: editStockInUsesPack() ? 'pack' : 'unit',
        lot_number: document.getElementById('editStockInLot')?.value.trim() || '',
        expiry_date: document.getElementById('editStockInExpiry')?.value || '',
        cost_per_unit: costPerUnit,
        supplier: document.getElementById('editStockInSupplier')?.value.trim() || 'องค์การเภสัชกรรม (GPO)',
        received_by: document.getElementById('editStockInReceivedBy')?.value.trim() || '',
        notes: document.getElementById('editStockInNotes')?.value.trim() || '',
        created_at: createdAtVal
    };

    const urlCode = new URLSearchParams(window.location.search).get('code');
    const codeQuery = urlCode ? `?code=${encodeURIComponent(urlCode)}` : '';

    try {
        let res = await fetch(`/api/stock-in/${logId}${codeQuery}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // Fallback to POST if PUT is not allowed by proxy
        if (!res.ok && res.status === 405) {
            res = await fetch(`/api/stock-in/${logId}${codeQuery}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }

        const data = await res.json().catch(() => null);
        if (res.ok && data?.ok) {
            showToast(data.message || 'แก้ไขรายการรับเข้าย้อนหลังสำเร็จ', 'success');
            closeEditStockInModal();
            await loadStockInLogs();
            if (typeof loadDrugs === 'function') loadDrugs();
        } else {
            showToast((data && data.error) || `เกิดข้อผิดพลาดในการแก้ไข (HTTP ${res.status})`, 'error');
        }
    } catch (err) {
        console.error('Save Edit Stock In error:', err);
        showToast('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function voidStockInRecord(logId) {
    const log = stockInLogsList.find(l => Number(l.id) === Number(logId));
    const drugName = log ? log.drug_name : `รายการ #${logId}`;
    const qty = log ? Number(log.quantity || 0) : 0;

    // Check drug stock
    const drug = typeof allDrugs !== 'undefined' ? allDrugs.find(d => Number(d.id) === Number(log?.drug_id)) : null;
    const curStock = drug ? Number(drug.stock_qty || 0) : (log?.current_drug_stock != null ? Number(log.current_drug_stock) : null);

    if (curStock !== null && curStock < qty) {
        showToast(`ไม่สามารถยกเลิกรายการรับเข้าได้: ยา '${drugName}' ถูกตัดจ่ายไปแล้วจนเหลือในคลังเพียง ${curStock} หน่วย (น้อยกว่ายอดรับเข้า ${qty} หน่วย) ระบบบล็อกไว้เพื่อป้องกันไม่ให้สต็อกติดลบ`, 'error', 7000);
        return;
    }

    const promptMsg = `คุณต้องการยกเลิกรายการรับเข้ายา '${drugName}' จำนวน ${qty} หน่วย ใช่หรือไม่?\nสต็อกยาในคลังจะถูกปรับลดลง ${qty} หน่วย (${curStock !== null ? curStock : 'ปัจจุบัน'} &rarr; ${curStock !== null ? curStock - qty : ''})\n\nกรุณาระบุเหตุผลในการยกเลิก (เช่น เอกสารผิดพลาด, บันทึกยอดซ้ำ):`;
    const reason = await showPromptDialog(
        promptMsg.replace('&rarr;', '→'),
        'ยกเลิกรายการรับเข้าโดยเจ้าหน้าที่',
        { title: 'ยืนยันยกเลิกรายการรับเข้า', confirmText: 'ยืนยันยกเลิก', danger: true, placeholder: 'ระบุเหตุผลการยกเลิก...' }
    );
    if (!reason) return;

    const urlCode = new URLSearchParams(window.location.search).get('code');
    const codeQuery = urlCode ? `?code=${encodeURIComponent(urlCode)}` : '';

    try {
        let res = await fetch(`/api/stock-in/${logId}/void${codeQuery}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: reason })
        });

        // Fallback to /delete endpoint if needed
        if (!res.ok && (res.status === 404 || res.status === 405)) {
            res = await fetch(`/api/stock-in/${logId}/delete${codeQuery}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: reason })
            });
        }

        const data = await res.json().catch(() => null);
        if (res.ok && data?.ok) {
            showToast(data.message || 'ยกเลิกรายการรับเข้าสำเร็จ', 'success');
            await loadStockInLogs();
            if (typeof loadDrugs === 'function') loadDrugs();
            if (typeof loadDashboardStats === 'function') loadDashboardStats();
        } else {
            showToast((data && data.error) || `ไม่สามารถยกเลิกรายการได้ (HTTP ${res.status})`, 'error');
        }
    } catch (err) {
        console.error('Void Stock In error:', err);
        showToast('เกิดข้อผิดพลาดในการยกเลิกรายการ', 'error');
    }
}

// Alias for backwards compatibility
const deleteStockInRecord = voidStockInRecord;

async function voidStockInFromEditModal() {
    const logId = document.getElementById('editStockInId')?.value;
    if (!logId) return;
    closeEditStockInModal();
    await voidStockInRecord(logId);
}

const deleteStockInFromEditModal = voidStockInFromEditModal;

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
    if (retailValEl) {
        const retTxt = `฿${(val.retail_value || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        retailValEl.innerText = retTxt;
        retailValEl.title = retTxt;
        retailValEl.className = 'kpi-value text-blue kpi-value-money';
        if (retTxt.length > 13) retailValEl.style.fontSize = '1.02rem';
        else if (retTxt.length > 10) retailValEl.style.fontSize = '1.12rem';
    }

    const costValEl = document.getElementById('analyticsCostVal');
    if (costValEl) {
        const costTxt = `฿${(val.cost_value || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        costValEl.innerText = costTxt;
        costValEl.title = costTxt;
        costValEl.className = 'kpi-value text-emerald kpi-value-money';
        if (costTxt.length > 13) costValEl.style.fontSize = '1.02rem';
        else if (costTxt.length > 10) costValEl.style.fontSize = '1.12rem';
    }

    const marginValEl = document.getElementById('analyticsMarginVal');
    if (marginValEl) {
        const marginTxt = `฿${(val.potential_margin || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        marginValEl.innerText = marginTxt;
        marginValEl.title = marginTxt;
        marginValEl.className = 'kpi-value text-indigo kpi-value-money';
        if (marginTxt.length > 13) marginValEl.style.fontSize = '1.02rem';
        else if (marginTxt.length > 10) marginValEl.style.fontSize = '1.12rem';
    }

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

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = isDark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(15, 23, 42, 0.08)';
    Chart.defaults.font.family = "'Anuphan', -apple-system, sans-serif";
    Chart.defaults.color = isDark ? '#94A3B8' : '#64748B';

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
                        label: 'รับเข้าสต็อก',
                        data: weekly.received || [],
                        backgroundColor: 'rgba(16, 185, 129, 0.85)',
                        borderColor: '#10B981',
                        borderWidth: 1.5,
                        borderRadius: 6,
                        barPercentage: 0.7,
                        categoryPercentage: 0.6
                    },
                    {
                        label: 'ตัดสต็อกจ่าย',
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
                    x: { grid: { color: gridColor } },
                    y: {
                        beginAtZero: true,
                        ticks: { precision: 0 },
                        grid: { color: gridColor }
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
                        '#0F766E',
                        '#0D9488',
                        '#14B8A6',
                        '#334155',
                        '#475569',
                        '#64748B'
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
                        ticks: { precision: 0 },
                        grid: { color: gridColor }
                    },
                    y: { grid: { color: gridColor } }
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
                        '#0F766E', '#0D9488', '#14B8A6', '#2DD4BF',
                        '#0284C7', '#334155', '#64748B', '#94A3B8'
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
                console.log('ServiceWorker active:', reg.scope);
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

function openMobileUserMenu() {
    const modal = document.getElementById('mobileUserMenuModal');
    if (!modal) return;

    // Sync live connection badges in mobile menu
    const lineBadge = document.getElementById('mobileMenuLineStatus');
    const sheetBadge = document.getElementById('mobileMenuSheetStatus');
    const avatarDot = document.getElementById('mobileAvatarStatusDot');

    // Check line status from desktop badge if available
    const lineDot = document.getElementById('lineStatusDot');
    const isLineActive = lineDot && lineDot.classList.contains('active');
    if (lineBadge) {
        lineBadge.className = isLineActive ? 'badge badge-success' : 'badge badge-danger';
        lineBadge.innerHTML = isLineActive ? '<span class="status-dot-inline is-ok"></span>พร้อมใช้' : '<span class="status-dot-inline is-err"></span>ไม่พร้อม';
    }

    const sheetDot = document.getElementById('sheetStatusDot');
    const isSheetActive = sheetDot && sheetDot.classList.contains('active');
    if (sheetBadge) {
        sheetBadge.className = isSheetActive ? 'badge badge-success' : 'badge badge-danger';
        sheetBadge.innerHTML = isSheetActive ? '<span class="status-dot-inline is-ok"></span>ซิงค์แล้ว' : '<span class="status-dot-inline is-err"></span>ไม่ได้ซิงค์';
    }

    if (avatarDot) {
        avatarDot.style.backgroundColor = (isLineActive && isSheetActive) ? 'var(--emerald-500)' : 'var(--amber-600)';
    }

    modal.classList.add('active');
}

function closeMobileUserMenu() {
    const modal = document.getElementById('mobileUserMenuModal');
    if (modal) modal.classList.remove('active');
}

function handleUserProfileClick(e) {
    openMobileUserMenu();
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
            showToast('บน iPhone: แตะปุ่มแชร์ > เลือก "เพิ่มไปยังหน้าจอโฮม"', 'info');
        } else {
            showToast('บน Android: แตะปุ่มจุดสามจุด > เลือก "ติดตั้งแอป" หรือ "เพิ่มลงในหน้าจอหลัก"', 'info');
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

// ─────────────────────────────────────────────────────────────
// AUDIT LOGS & USER ACTIVITY TRAIL
// ─────────────────────────────────────────────────────────────

let auditSearchTimeout = null;

function debounceAuditSearch() {
    clearTimeout(auditSearchTimeout);
    auditSearchTimeout = setTimeout(() => {
        loadAuditLogs();
    }, 350);
}

function openAuditLogModal() {
    const modal = document.getElementById('auditLogModal');
    if (modal) {
        modal.classList.add('active');
        loadAuditLogs();
    }
}

function closeAuditLogModal() {
    const modal = document.getElementById('auditLogModal');
    if (modal) {
        modal.classList.remove('active');
    }
}

function escapeAuditHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function loadAuditLogs() {
    const tableBody = document.getElementById('auditLogsTableBody');
    const mobileCardsContainer = document.getElementById('auditLogsMobileCards');
    const refreshIcon = document.getElementById('auditRefreshIcon');
    const actionFilter = document.getElementById('auditActionFilter')?.value || '';
    const searchFilter = document.getElementById('auditSearchInput')?.value?.trim() || '';
    const countBadge = document.getElementById('auditCountBadge');

    if (refreshIcon) refreshIcon.classList.add('fa-spin');
    const loadingHtml = `
        <tr>
            <td colspan="5" style="text-align: center; padding: 2.5rem; color: var(--text-muted);">
                <i class="fas fa-circle-notch fa-spin"></i> กำลังโหลดประวัติกิจกรรม...
            </td>
        </tr>
    `;
    if (tableBody) tableBody.innerHTML = loadingHtml;
    if (mobileCardsContainer) {
        mobileCardsContainer.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--text-muted); font-size: 0.85rem;">
                <i class="fas fa-circle-notch fa-spin"></i> กำลังโหลดประวัติกิจกรรม...
            </div>
        `;
    }

    try {
        const queryParams = new URLSearchParams({ limit: '200' });
        if (actionFilter) queryParams.set('action', actionFilter);
        if (searchFilter) queryParams.set('user_email', searchFilter);

        const resp = await fetch(`/api/audit/logs?${queryParams.toString()}`);
        const data = await resp.json();

        if (refreshIcon) refreshIcon.classList.remove('fa-spin');

        if (!data.ok) {
            const errHtml = `
                <tr>
                    <td colspan="5" style="text-align: center; padding: 2rem; color: #ef4444;">
                        <i class="fas fa-circle-exclamation"></i> ไม่สามารถโหลดประวัติกิจกรรมได้: ${escapeAuditHtml(data.error || 'Unauthorized')}
                    </td>
                </tr>
            `;
            if (tableBody) tableBody.innerHTML = errHtml;
            if (mobileCardsContainer) {
                mobileCardsContainer.innerHTML = `<div style="text-align: center; padding: 1.5rem; color: #ef4444;"><i class="fas fa-circle-exclamation"></i> ไม่สามารถโหลดได้</div>`;
            }
            return;
        }

        const logs = data.logs || [];
        if (countBadge) countBadge.textContent = `${logs.length} รายการ`;

        if (logs.length === 0) {
            const emptyHtml = `
                <tr>
                    <td colspan="5" style="text-align: center; padding: 2.5rem; color: var(--text-muted);">
                        <i class="fas fa-inbox" style="font-size: 1.5rem; margin-bottom: 0.5rem; opacity: 0.5; display: block;"></i>
                        ยังไม่มีบันทึกประวัติกิจกรรมตามเงื่อนไขที่เลือก
                    </td>
                </tr>
            `;
            if (tableBody) tableBody.innerHTML = emptyHtml;
            if (mobileCardsContainer) {
                mobileCardsContainer.innerHTML = `
                    <div style="text-align: center; padding: 2rem; color: var(--text-muted); font-size: 0.825rem;">
                        <i class="fas fa-inbox" style="font-size: 1.3rem; margin-bottom: 0.4rem; opacity: 0.5; display: block;"></i>
                        ยังไม่มีบันทึกประวัติกิจกรรม
                    </div>
                `;
            }
            return;
        }

        const actionBadges = {
            'LOGIN': { label: 'เข้าสู่ระบบ', bg: 'rgba(99, 102, 241, 0.15)', text: '#6366F1', icon: 'fa-right-to-bracket' },
            'LOGOUT': { label: 'ออกจากระบบ', bg: 'rgba(100, 116, 139, 0.15)', text: '#64748B', icon: 'fa-right-from-bracket' },
            'ADD_DRUG': { label: 'เพิ่มยาใหม่', bg: 'rgba(16, 185, 129, 0.15)', text: '#10B981', icon: 'fa-plus' },
            'EDIT_DRUG': { label: 'แก้ไขยา', bg: 'rgba(245, 158, 11, 0.15)', text: '#F59E0B', icon: 'fa-pen' },
            'DELETE_DRUG': { label: 'ลบรายการยา', bg: 'rgba(239, 68, 68, 0.15)', text: '#EF4444', icon: 'fa-trash' },
            'DISPENSE': { label: 'ตัดจ่ายสต็อก', bg: 'rgba(37, 99, 235, 0.15)', text: '#2563EB', icon: 'fa-prescription-bottle-medical' },
            'STOCK_IN': { label: 'รับเข้าสต็อก', bg: 'rgba(5, 150, 105, 0.15)', text: '#059669', icon: 'fa-boxes-packing' }
        };

        const rowsHtml = logs.map(l => {
            const act = actionBadges[l.action] || { label: l.action, bg: 'rgba(100, 116, 139, 0.12)', text: 'var(--text-secondary)', icon: 'fa-circle-info' };
            const safeEmail = escapeAuditHtml(l.user_email || 'anonymous');
            const safeName = escapeAuditHtml(l.user_name || safeEmail);
            const safeDetail = escapeAuditHtml(l.detail || l.target_name || '-');
            const safeIp = escapeAuditHtml(l.ip_address || '-');
            const safeTime = escapeAuditHtml(l.created_at || '-');

            return `
                <tr style="border-bottom: 1px solid var(--border-default); transition: background 0.15s ease;">
                    <td style="padding: 0.65rem 0.85rem; font-family: var(--font-mono); font-size: 0.775rem; color: var(--text-muted); white-space: nowrap;">
                        ${safeTime}
                    </td>
                    <td style="padding: 0.65rem 0.85rem; white-space: nowrap;">
                        <div style="display: flex; align-items: center; gap: 0.45rem;">
                            <div style="width: 26px; height: 26px; border-radius: 50%; background: var(--bg-subtle); display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: var(--text-secondary); flex-shrink: 0; border: 1px solid var(--border-subtle);">
                                <i class="fas fa-user"></i>
                            </div>
                            <div style="min-width: 0; line-height: 1.25;">
                                <div style="font-weight: 600; font-size: 0.8125rem; color: var(--text-primary); max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${safeName}">${safeName}</div>
                                <div style="font-size: 0.72rem; color: var(--text-muted); max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${safeEmail}">${safeEmail}</div>
                            </div>
                        </div>
                    </td>
                    <td style="padding: 0.65rem 0.85rem; white-space: nowrap;">
                        <span style="display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.25rem 0.6rem; border-radius: 6px; font-size: 0.73rem; font-weight: 600; background: ${act.bg}; color: ${act.text};">
                            <i class="fas ${act.icon}" style="font-size: 0.7rem;"></i>
                            <span>${act.label}</span>
                        </span>
                    </td>
                    <td style="padding: 0.65rem 0.85rem; color: var(--text-secondary); line-height: 1.5; min-width: 300px; word-break: normal; overflow-wrap: break-word;">
                        ${l.target_name ? `<span style="font-weight: 700; color: var(--brand-600); margin-right: 0.35rem;">[${escapeAuditHtml(l.target_name)}]</span>` : ''}
                        <span>${safeDetail}</span>
                    </td>
                    <td style="padding: 0.65rem 0.85rem; text-align: right; white-space: nowrap;">
                        <span style="font-family: var(--font-mono); font-size: 0.725rem; color: var(--text-muted); background: var(--bg-subtle); border: 1px solid var(--border-default); padding: 0.15rem 0.45rem; border-radius: 4px; display: inline-block;">${safeIp}</span>
                    </td>
                </tr>
            `;
        }).join('');

        if (tableBody) tableBody.innerHTML = rowsHtml;

        if (mobileCardsContainer) {
            mobileCardsContainer.innerHTML = logs.map(l => {
                const act = actionBadges[l.action] || { label: l.action, bg: 'rgba(100, 116, 139, 0.12)', text: 'var(--text-secondary)', icon: 'fa-circle-info' };
                const safeEmail = escapeAuditHtml(l.user_email || 'anonymous');
                const safeName = escapeAuditHtml(l.user_name || safeEmail);
                const safeDetail = escapeAuditHtml(l.detail || l.target_name || '-');
                const safeIp = escapeAuditHtml(l.ip_address || '-');
                const safeTime = escapeAuditHtml(l.created_at || '-');

                return `
                    <div style="background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: var(--radius-md); padding: 0.85rem; margin-bottom: 0.65rem; box-shadow: var(--shadow-xs);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; gap: 0.5rem;">
                            <span style="display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.2rem 0.55rem; border-radius: 6px; font-size: 0.725rem; font-weight: 700; background: ${act.bg}; color: ${act.text};">
                                <i class="fas ${act.icon}" style="font-size: 0.7rem;"></i>
                                <span>${act.label}</span>
                            </span>
                            <span style="font-family: var(--font-mono); font-size: 0.725rem; color: var(--text-muted); white-space: nowrap;"><i class="far fa-clock" style="margin-right: 3px;"></i>${safeTime}</span>
                        </div>
                        <div style="font-size: 0.825rem; color: var(--text-primary); line-height: 1.5; margin-bottom: 0.5rem;">
                            ${l.target_name ? `<span style="font-weight: 700; color: var(--brand-600); margin-right: 0.35rem;">[${escapeAuditHtml(l.target_name)}]</span>` : ''}
                            <span style="color: var(--text-secondary);">${safeDetail}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.725rem; color: var(--text-secondary); border-top: 1px dashed var(--border-subtle); padding-top: 0.45rem; gap: 0.5rem;">
                            <div style="display: flex; align-items: center; gap: 0.35rem; min-width: 0; overflow: hidden;">
                                <i class="fas fa-user-circle" style="color: var(--text-muted); flex-shrink: 0;"></i>
                                <span style="font-weight: 600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 160px;" title="${safeName}">${safeName}</span>
                            </div>
                            <span style="font-family: var(--font-mono); color: var(--text-muted); font-size: 0.675rem; background: var(--bg-subtle); border: 1px solid var(--border-default); padding: 0.1rem 0.35rem; border-radius: 4px; flex-shrink: 0;">${safeIp}</span>
                        </div>
                    </div>
                `;
            }).join('');
        }

    } catch (err) {
        if (refreshIcon) refreshIcon.classList.remove('fa-spin');
        const failHtml = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 2rem; color: #ef4444;">
                    <i class="fas fa-triangle-exclamation"></i> เกิดข้อผิดพลาดในการโหลด: ${escapeAuditHtml(err.message)}
                </td>
            </tr>
        `;
        if (tableBody) tableBody.innerHTML = failHtml;
        if (mobileCardsContainer) {
            mobileCardsContainer.innerHTML = `<div style="text-align: center; padding: 1.5rem; color: #ef4444;"><i class="fas fa-triangle-exclamation"></i> โหลดข้อมูลไม่สำเร็จ</div>`;
        }
    }
}

// ==========================================================================
// 🛒 MULTI-DRUG RX CART & BATCH DISPENSING CONTROLLER
// ==========================================================================

let rxCart = []; // [{ drug: {...}, quantity: 1, notes: '' }]

function isInRxCart(drugId) {
    return rxCart.some(item => Number(item.drug.id) === Number(drugId));
}

function addToRxCart(drugId) {
    const drug = allDrugs.find(d => Number(d.id) === Number(drugId));
    if (!drug) {
        showToast('ไม่พบข้อมูลยาในระบบ', 'error');
        return;
    }
    const curStock = Number(drug.stock_qty || 0);
    if (curStock <= 0) {
        showToast(`ยา "${drug.name}" สินค้าหมดสต็อก ไม่สามารถจ่ายได้`, 'warning');
        return;
    }

    const existingIndex = rxCart.findIndex(item => Number(item.drug.id) === Number(drugId));
    if (existingIndex >= 0) {
        openRxCartModal();
        showToast(`ยา "${drug.name}" อยู่ในใบสั่งยาแล้ว`, 'info');
        return;
    } else {
        rxCart.push({
            drug: drug,
            quantity: 1,
            notes: ''
        });
        showToast(`เพิ่ม "${drug.name}" ลงในใบสั่งยาแล้ว`, 'success');
    }

    updateRxCartBadges();
    renderRxCartModal();
    renderDrugsTable(allDrugs);
}

function removeFromRxCart(drugId) {
    rxCart = rxCart.filter(item => Number(item.drug.id) !== Number(drugId));
    updateRxCartBadges();
    renderRxCartModal();
    renderDrugsTable(allDrugs);
    if (rxCart.length === 0) {
        closeRxCartModal();
        showToast('ล้างรายการยาในใบสั่งยาหมดแล้ว', 'info');
    } else {
        showToast('ลบรายการยาออกจากใบสั่งยาแล้ว', 'info');
    }
}

function updateRxCartQty(drugId, newQty) {
    const item = rxCart.find(it => Number(it.drug.id) === Number(drugId));
    if (!item) return;

    let qty = parseFloat(newQty);
    if (isNaN(qty)) {
        showToast('กรุณาระบุจำนวนเป็นตัวเลขที่ถูกต้อง', 'warning');
        renderRxCartModal();
        return;
    }
    if (qty <= 0) {
        removeFromRxCart(drugId);
        return;
    }

    const curStock = Number(item.drug.stock_qty || 0);
    if (qty > curStock) {
        showToast(`จำนวน ${qty} เกินสต็อกที่มี (${curStock} ${item.drug.unit}) ปรับเป็น ${curStock}`, 'warning');
        qty = curStock;
    }

    item.quantity = qty;
    updateRxCartBadges();
    renderRxCartModal();
}

function updateRxCartItemNote(drugId, note) {
    const item = rxCart.find(it => Number(it.drug.id) === Number(drugId));
    if (item) {
        item.notes = String(note || '').trim();
    }
}

function cancelAndClearRxCart() {
    if (rxCart.length === 0) {
        closeRxCartModal();
        return;
    }
    rxCart = [];
    updateRxCartBadges();
    renderRxCartModal();
    renderDrugsTable(allDrugs);
    closeRxCartModal();
    showToast('ยกเลิกใบสั่งยาและล้างรายการทั้งหมดเรียบร้อยแล้ว', 'info');
}

function clearRxCart() {
    cancelAndClearRxCart();
}

function updateRxCartBadges() {
    const count = rxCart.length;
    const totalQty = rxCart.reduce((sum, it) => sum + it.quantity, 0);
    const totalPrice = rxCart.reduce((sum, it) => sum + (it.quantity * Number(it.drug.price || 0)), 0);

    // Header badge
    const headerBadge = document.getElementById('rxCartBadge');
    if (headerBadge) {
        headerBadge.textContent = count;
        headerBadge.style.display = count > 0 ? 'inline-flex' : 'none';
    }

    // Toolbar button badge
    const toolbarCount = document.getElementById('btnRxCartCount');
    if (toolbarCount) {
        toolbarCount.textContent = count;
    }

    // Floating bar
    const floatingBar = document.getElementById('floatingRxCartBar');
    const floatingCount = document.getElementById('floatingCartCount');
    const floatingItemsText = document.getElementById('floatingCartItemsText');
    const floatingSubtitle = document.getElementById('floatingCartSubtitle');

    if (floatingBar) {
        if (count > 0) {
            floatingBar.style.display = 'flex';
            if (floatingCount) floatingCount.textContent = count;
            if (floatingItemsText) floatingItemsText.textContent = `${count} รายการ (${totalQty} ชิ้น)`;
            if (floatingSubtitle) floatingSubtitle.textContent = `ยอดรวม ฿${totalPrice.toLocaleString('th-TH', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        } else {
            floatingBar.style.display = 'none';
        }
    }
}

function renderRxCartModal() {
    const container = document.getElementById('rxCartItemsContainer');
    const countEl = document.getElementById('rxCartItemsCount');
    const kindsEl = document.getElementById('rxSummaryKinds');
    const totalQtyEl = document.getElementById('rxSummaryTotalQty');
    const totalPriceEl = document.getElementById('rxSummaryTotalPrice');
    const submitBtn = document.getElementById('btnSubmitRxBatch');

    if (!container) return;

    const count = rxCart.length;
    const totalQty = rxCart.reduce((sum, it) => sum + it.quantity, 0);
    const totalPrice = rxCart.reduce((sum, it) => sum + (it.quantity * Number(it.drug.price || 0)), 0);

    if (countEl) countEl.textContent = count;
    if (kindsEl) kindsEl.textContent = `${count} รายการ`;
    if (totalQtyEl) totalQtyEl.textContent = `${totalQty} หน่วย`;
    if (totalPriceEl) totalPriceEl.textContent = `฿${totalPrice.toLocaleString('th-TH', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

    if (submitBtn) {
        submitBtn.disabled = count === 0;
    }

    if (count === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 2.5rem 1.5rem; color: var(--text-muted);">
                <div style="font-size: 2.25rem; margin-bottom: 0.65rem; color: var(--border-default);">
                    <i class="fas fa-clipboard"></i>
                </div>
                <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-secondary); margin-bottom: 0.25rem;">
                    ยังไม่มีรายการยาในใบสั่งยา
                </div>
                <div style="font-size: 0.8125rem;">
                    คลิกปุ่ม <strong>"+ใบสั่งยา"</strong> ที่รายการยาในตาราง เพื่อเพิ่มยาลงในใบสั่งยานี้
                </div>
            </div>
        `;
        return;
    }

    container.innerHTML = rxCart.map((it, idx) => {
        const d = it.drug;
        const curStock = Number(d.stock_qty || 0);
        const price = Number(d.price || 0);
        const subtotal = it.quantity * price;
        const isHighQty = (it.quantity >= 100) || (curStock > 0 && it.quantity >= curStock * 0.5);

        return `
            <div class="rx-cart-item-row" id="rx-cart-row-${d.id}">
                <div class="rx-col-index" style="text-align: center; font-weight: 700; color: var(--text-muted); font-size: 0.85rem;">
                    ${idx + 1}
                </div>
                <div class="rx-col-info" style="min-width: 0;">
                    <div class="rx-item-name" style="font-weight: 700; font-size: 0.9rem; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
                        ${escapeHtml(d.name)}
                    </div>
                    <div class="rx-item-meta" style="display: flex; gap: 0.5rem; align-items: center; font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">
                        <span class="rx-item-code" style="font-family: var(--font-mono);">${escapeHtml(d.code)}</span>
                        <span>•</span>
                        <span>คงเหลือ: <strong style="color: #059669;">${curStock} ${escapeHtml(d.unit)}</strong></span>
                        <span>•</span>
                        <span>฿${price.toFixed(2)}/${escapeHtml(d.unit)}</span>
                    </div>
                    ${isHighQty ? `
                        <div class="rx-item-warning" style="margin-top: 4px; font-size: 0.7rem; color: #D97706; font-weight: 600; display: flex; align-items: center; gap: 0.3rem;">
                            <i class="fas fa-triangle-exclamation"></i> จำนวนจ่ายค่อนข้างสูง (≥50% สต็อก)
                        </div>
                    ` : ''}
                </div>
                <div class="rx-col-stepper">
                    <div class="rx-qty-stepper">
                        <button type="button" class="rx-qty-btn" onclick="updateRxCartQty(${d.id}, ${it.quantity - 1})" title="ลดจำนวน">
                            <i class="fas fa-minus" style="font-size: 0.7rem;"></i>
                        </button>
                        <input type="number" class="rx-qty-input" value="${it.quantity}" min="0.001" step="any" max="${curStock}" onchange="updateRxCartQty(${d.id}, this.value)">
                        <button type="button" class="rx-qty-btn" onclick="updateRxCartQty(${d.id}, ${it.quantity + 1})" title="เพิ่มจำนวน">
                            <i class="fas fa-plus" style="font-size: 0.7rem;"></i>
                        </button>
                    </div>
                </div>
                <div class="rx-col-subtotal" style="text-align: right;">
                    <div class="rx-item-subtotal-val" style="font-family: var(--font-mono); font-weight: 800; font-size: 0.95rem; color: #059669;">
                        ฿${subtotal.toLocaleString('th-TH', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </div>
                </div>
                <div class="rx-col-del" style="text-align: center;">
                    <button type="button" class="btn btn-icon btn-subtle text-danger" onclick="removeFromRxCart(${d.id})" title="ลบยานี้ออกจากใบสั่ง" style="width: 32px; height: 32px; border-radius: 6px;">
                        <i class="fas fa-trash-can" style="font-size: 0.85rem;"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function setRxCartDateNow() {
    const inp = document.getElementById('rxCartCreatedAtInput');
    if (inp) {
        const now = new Date();
        const offset = now.getTimezoneOffset() * 60000;
        inp.value = (new Date(now.getTime() - offset)).toISOString().slice(0, 16);
    }
}

function openRxCartModal() {
    renderRxCartModal();
    setRxCartDateNow();
    const modal = document.getElementById('rxCartModal');
    if (modal) {
        modal.style.display = 'flex';
        modal.classList.add('active');
        const patientInput = document.getElementById('rxCartPatientName');
        if (patientInput && !patientInput.value) {
            setTimeout(() => patientInput.focus(), 150);
        }
    }
}

function closeRxCartModal() {
    const modal = document.getElementById('rxCartModal');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
    }
}

async function submitRxBatchDispense() {
    if (rxCart.length === 0) {
        showToast('กรุณาเลือกรายการยาในใบสั่งยาอย่างน้อย 1 รายการ', 'warning');
        return;
    }

    const patientName = (document.getElementById('rxCartPatientName')?.value || '').trim();
    if (!patientName) {
        showToast('กรุณากรอกชื่อผู้รับมอบยา / คนไข้ ก่อนยืนยัน', 'warning');
        document.getElementById('rxCartPatientName')?.focus();
        return;
    }

    const dept = (document.getElementById('rxCartDepartment')?.value || 'แผนกตรวจรักษา / หอผู้ป่วยสามัญ').trim();
    const dispenser = (document.getElementById('rxCartDispenserName')?.value || 'เภสัชกร / เจ้าหน้าที่ประจำคลังยา').trim();
    const notes = (document.getElementById('rxCartNotes')?.value || '').trim();
    const createdAt = (document.getElementById('rxCartCreatedAtInput')?.value || '').trim();

    const submitBtn = document.getElementById('btnSubmitRxBatch');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> กำลังตัดสต็อกใบสั่งยา...';
    }

    try {
        const payload = {
            items: rxCart.map(it => ({
                drug_id: it.drug.id,
                quantity: it.quantity,
                notes: it.notes
            })),
            patient_name: patientName,
            requester_dept: dept,
            dispensed_by: dispenser,
            notes: notes,
            created_at: createdAt || undefined,
            channel: 'WEB_RX_CART'
        };

        const res = await fetch('/api/dispense/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.ok) {
            const result = data.result;
            // Clear cart
            rxCart = [];
            updateRxCartBadges();
            closeRxCartModal();

            // Refresh data
            loadDrugs();
            loadDashboardStats();
            loadDispensingLogs();

            // Open success modal
            openRxBatchSuccessModal(result);
        } else {
            showToast(data.error || 'เกิดข้อผิดพลาดในการตัดสต็อก', 'error');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'ยืนยันตัดสต็อก';
            }
        }
    } catch (err) {
        showToast('การเชื่อมต่อล้มเหลว: ' + err.message, 'error');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'ยืนยันตัดสต็อก';
        }
    }
}

function openRxBatchSuccessModal(result) {
    const modal = document.getElementById('rxBatchSuccessModal');
    if (!modal) return;

    const batchIdEl = document.getElementById('rxSuccessBatchId');
    const patientEl = document.getElementById('rxSuccessPatient');
    const totalItemsEl = document.getElementById('rxSuccessTotalItems');
    const totalPriceEl = document.getElementById('rxSuccessTotalPrice');
    const printBtn = document.getElementById('rxSuccessPrintBtn');

    if (batchIdEl) batchIdEl.textContent = result.batch_id || '-';
    if (patientEl) patientEl.textContent = result.patient_name || '-';
    if (totalItemsEl) totalItemsEl.textContent = `${result.total_items} รายการ (${result.total_qty} หน่วย)`;
    if (totalPriceEl) totalPriceEl.textContent = result.total_price_formatted || '-';

    if (printBtn) {
        printBtn.href = result.requisition_url || `/api/dispense/requisition/batch/${result.batch_id}`;
    }

    modal.style.display = 'flex';
    modal.classList.add('active');
}

function closeRxBatchSuccessModal() {
    const modal = document.getElementById('rxBatchSuccessModal');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
    }
}

// ─────────────────────────────────────────────────────────────
// 🏷️ DRUG CATEGORY MANAGEMENT SYSTEM (CRUD)
// ─────────────────────────────────────────────────────────────

let currentCategories = [];
let currentSelectedCategory = 'all';
let editingCategoryId = null;

async function loadCategories() {
    try {
        const res = await fetch('/api/categories');
        const data = await res.json();
        if (data.ok && Array.isArray(data.categories)) {
            currentCategories = data.categories;
            renderCategoryFilterOptions();
            renderDrugCategoryInputOptions();
            renderCategoryManagerList();
        }
    } catch (e) {
        console.error('Failed to load categories:', e);
    }
}

function renderCategoryFilterOptions() {
    const filterSelect = document.getElementById('categoryFilter');
    if (!filterSelect) return;
    
    const currentVal = currentSelectedCategory || filterSelect.value || 'all';
    
    let html = '<option value="all">ทุกหมวดหมู่ยา</option>';
    currentCategories.forEach(cat => {
        html += `<option value="${escapeHtml(cat.name)}">${escapeHtml(cat.name)}</option>`;
    });
    // (Category management opens only from the tag button next to this filter.)
    filterSelect.innerHTML = html;
    
    // Restore previous selection if valid
    const hasVal = Array.from(filterSelect.options).some(opt => opt.value === currentVal);
    if (hasVal && currentVal !== '__manage__') {
        filterSelect.value = currentVal;
    } else {
        filterSelect.value = 'all';
        currentSelectedCategory = 'all';
    }
}

function renderDrugCategoryInputOptions(selectedCategory = null) {
    const catSelect = document.getElementById('drugCategoryInput');
    if (!catSelect) return;
    
    const currentVal = selectedCategory || catSelect.value || 'ทั่วไป';
    let found = false;
    
    let html = '';
    currentCategories.forEach(cat => {
        const isSel = (cat.name === currentVal);
        if (isSel) found = true;
        html += `<option value="${escapeHtml(cat.name)}"${isSel ? ' selected' : ''}>${escapeHtml(cat.name)}</option>`;
    });
    
    // If the drug had a category not in currentCategories, preserve it as an option
    if (currentVal && !found && currentVal !== '__manage__') {
        html += `<option value="${escapeHtml(currentVal)}" selected>${escapeHtml(currentVal)} (เดิม)</option>`;
    }
    
    catSelect.innerHTML = html;
}

function openCategoryManagerModal() {
    editingCategoryId = null;
    const modal = document.getElementById('categoryManagerModal');
    if (!modal) return;
    modal.classList.add('active');
    
    const nameInput = document.getElementById('newCategoryNameInput');
    if (nameInput) {
        nameInput.value = '';
        setTimeout(() => nameInput.focus(), 100);
    }
    renderCategoryManagerList();
}

function closeCategoryManagerModal() {
    editingCategoryId = null;
    const modal = document.getElementById('categoryManagerModal');
    if (modal) modal.classList.remove('active');
}

function renderCategoryManagerList() {
    const container = document.getElementById('categoryManagerList');
    const countBadge = document.getElementById('catManagerCount');
    if (!container) return;
    
    if (countBadge) {
        countBadge.textContent = currentCategories.length;
    }
    
    if (currentCategories.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; color: var(--text-muted); padding: 1.5rem 0; font-size: 0.85rem;">
                <i class="fas fa-tags" style="font-size: 1.5rem; color: var(--text-subtle); display: block; margin-bottom: 0.4rem;"></i>
                ยังไม่มีหมวดหมู่ยา กรุณาเพิ่มหมวดหมู่แรกด้านบน
            </div>
        `;
        return;
    }
    
    container.innerHTML = currentCategories.map(cat => {
        const isEditing = (editingCategoryId === cat.id);
        const drugCount = cat.drug_count || 0;
        const color = cat.color || 'teal';
        
        if (isEditing) {
            return `
                <div class="cat-item-row" style="background: var(--bg-subtle); border-color: var(--teal-500);">
                    <form class="cat-edit-form" onsubmit="event.preventDefault(); saveEditCategoryInline(${cat.id});">
                        <select id="editCatColor_${cat.id}" class="form-select" style="width: 100px; height: 32px; padding: 0.2rem 0.5rem; font-size: 0.78rem; flex-shrink: 0;">
                            <option value="teal"${color === 'teal' ? ' selected' : ''}>เขียวอมฟ้า</option>
                            <option value="emerald"${color === 'emerald' ? ' selected' : ''}>เขียวสด</option>
                            <option value="blue"${color === 'blue' ? ' selected' : ''}>น้ำเงิน</option>
                            <option value="purple"${color === 'purple' ? ' selected' : ''}>ม่วง</option>
                            <option value="amber"${color === 'amber' ? ' selected' : ''}>ส้มอำพัน</option>
                            <option value="rose"${color === 'rose' ? ' selected' : ''}>แดงกุหลาบ</option>
                            <option value="cyan"${color === 'cyan' ? ' selected' : ''}>ฟ้าสดใส</option>
                            <option value="indigo"${color === 'indigo' ? ' selected' : ''}>คราม</option>
                            <option value="slate"${color === 'slate' ? ' selected' : ''}>เทา</option>
                        </select>
                        <input type="text" id="editCatName_${cat.id}" class="form-input" value="${escapeHtml(cat.name)}" style="height: 32px; font-size: 0.82rem; padding: 0.2rem 0.6rem; flex: 1; min-width: 120px;" required>
                        <div class="cat-actions">
                            <button type="submit" class="cat-action-btn" title="บันทึก" style="color: var(--teal-600); border-color: var(--teal-500);">
                                <i class="fas fa-check"></i>
                            </button>
                            <button type="button" class="cat-action-btn" onclick="cancelEditCategoryInline()" title="ยกเลิก">
                                <i class="fas fa-xmark"></i>
                            </button>
                        </div>
                    </form>
                </div>
            `;
        }
        
        return `
            <div class="cat-item-row">
                <div class="cat-item-main">
                    <span class="cat-color-dot cat-dot-${escapeHtml(color)}"></span>
                    <span class="cat-name-label" title="${escapeHtml(cat.name)}">${escapeHtml(cat.name)}</span>
                    <span class="cat-drug-badge" title="มียาในหมวดนี้ ${drugCount} รายการ">
                        <i class="fas fa-pills" style="font-size: 0.65rem; margin-right: 3px;"></i>${drugCount} ยา
                    </span>
                </div>
                <div class="cat-actions">
                    <button type="button" class="cat-action-btn" onclick="startEditCategoryInline(${cat.id})" title="แก้ไขชื่อ/สีหมวดหมู่">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button type="button" class="cat-action-btn cat-btn-delete" onclick="confirmDeleteCategory(${cat.id}, '${escapeHtml(cat.name).replace(/'/g, "\\'")}', ${drugCount})" title="ลบหมวดหมู่นี้">
                        <i class="fas fa-trash-can"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

async function submitAddCategory() {
    const nameInput = document.getElementById('newCategoryNameInput');
    const colorSelect = document.getElementById('newCategoryColorSelect');
    if (!nameInput) return;
    
    const name = nameInput.value.trim();
    const color = colorSelect ? colorSelect.value : 'teal';
    
    if (!name) {
        showToast('กรุณากรอกชื่อหมวดหมู่ที่ต้องการเพิ่ม', 'warning');
        nameInput.focus();
        return;
    }
    
    try {
        const res = await fetch('/api/categories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, color })
        });
        const data = await res.json();
        if (data.ok) {
            nameInput.value = '';
            showToast(`เพิ่มหมวดหมู่ "${name}" เรียบร้อยแล้ว`, 'success');
            await loadCategories();
            loadDrugs();
        } else {
            showToast(data.error || 'ไม่สามารถเพิ่มหมวดหมู่ได้', 'error');
        }
    } catch (e) {
        console.error('Add category error:', e);
        showToast('เกิดข้อผิดพลาดในการเชื่อมต่อเครือข่าย', 'error');
    }
}

function startEditCategoryInline(catId) {
    editingCategoryId = catId;
    renderCategoryManagerList();
    setTimeout(() => {
        const input = document.getElementById(`editCatName_${catId}`);
        if (input) {
            input.focus();
            input.select();
        }
    }, 50);
}

function cancelEditCategoryInline() {
    editingCategoryId = null;
    renderCategoryManagerList();
}

async function saveEditCategoryInline(catId) {
    const nameInput = document.getElementById(`editCatName_${catId}`);
    const colorSelect = document.getElementById(`editCatColor_${catId}`);
    if (!nameInput) return;
    
    const name = nameInput.value.trim();
    const color = colorSelect ? colorSelect.value : 'teal';
    
    if (!name) {
        showToast('ชื่อหมวดหมู่ต้องไม่ว่างเปล่า', 'warning');
        nameInput.focus();
        return;
    }
    
    try {
        const res = await fetch(`/api/categories/${catId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, color })
        });
        const data = await res.json();
        if (data.ok) {
            editingCategoryId = null;
            showToast(`แก้ไขหมวดหมู่เป็น "${name}" เรียบร้อยแล้ว`, 'success');
            await loadCategories();
            loadDrugs();
        } else {
            showToast(data.error || 'ไม่สามารถแก้ไขหมวดหมู่ได้', 'error');
        }
    } catch (e) {
        console.error('Edit category error:', e);
        showToast('เกิดข้อผิดพลาดในการบันทึกการแก้ไข', 'error');
    }
}

async function confirmDeleteCategory(catId, catName, drugCount) {
    let confirmMsg = `ต้องการลบหมวดหมู่ "${catName}" ใช่หรือไม่?`;
    if (drugCount > 0) {
        confirmMsg = `หมวดหมู่ "${catName}" มียาอยู่ ${drugCount} รายการ!\n\nหากลบ ระบบจะย้ายยาทั้ง ${drugCount} รายการไปอยู่หมวดหมู่ "ทั่วไป" อัตโนมัติ เพื่อป้องกันข้อมูลสูญหาย\n\nต้องการยืนยันการลบหรือไม่?`;
    }
    
    const ok = await showConfirmDialog(confirmMsg, { title: 'ยืนยันการลบหมวดหมู่', confirmText: 'ลบหมวดหมู่', danger: true });
    if (!ok) return;
    
    try {
        const res = await fetch(`/api/categories/${catId}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (data.ok) {
            showToast(`ลบหมวดหมู่ "${catName}" สำเร็จแล้ว`, 'success');
            await loadCategories();
            loadDrugs();
        } else {
            showToast(data.error || 'ไม่สามารถลบหมวดหมู่ได้', 'error');
        }
    } catch (e) {
        console.error('Delete category error:', e);
        showToast('เกิดข้อผิดพลาดในการลบหมวดหมู่', 'error');
    }
}

async function triggerManualDbBackup() {
    showToast('กำลังสำรองข้อมูลฐานข้อมูล...', 'info');
    try {
        const res = await fetch('/api/system/backup', {
            method: 'POST',
            credentials: 'include'
        });
        const data = await res.json();
        if (data.ok) {
            showToast(`สำรองข้อมูลสำเร็จ: ${data.data.filename}`, 'success');
        } else {
            showToast(`สำรองข้อมูลไม่สำเร็จ: ${data.error || 'เกิดข้อผิดพลาด'}`, 'error');
        }
    } catch (e) {
        console.error('Backup error:', e);
        showToast('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์', 'error');
    }
}

function toggleCompactTableView() {
    const wrapper = document.querySelector('.desktop-table-wrapper');
    const icon = document.getElementById('compactViewIcon');
    const text = document.getElementById('compactViewText');
    if (!wrapper) return;
    
    const isCompact = wrapper.classList.toggle('table-compact');
    localStorage.setItem('pharmacy_compact_table', isCompact ? '1' : '0');
    
    if (icon && text) {
        if (isCompact) {
            icon.className = 'fas fa-expand';
            text.textContent = 'มุมมองปกติ';
            showToast('เปิดใช้งานมุมมองกะทัดรัด (Compact View)', 'info');
        } else {
            icon.className = 'fas fa-table-columns';
            text.textContent = 'มุมมองกะทัดรัด';
            showToast('เปิดใช้งานมุมมองปกติ', 'info');
        }
    }
}

// Restore saved compact table view preference
function initCompactTableView() {
    if (localStorage.getItem('pharmacy_compact_table') === '1') {
        const wrapper = document.querySelector('.desktop-table-wrapper');
        const icon = document.getElementById('compactViewIcon');
        const text = document.getElementById('compactViewText');
        if (wrapper) wrapper.classList.add('table-compact');
        if (icon) icon.className = 'fas fa-expand';
        if (text) text.textContent = 'มุมมองปกติ';
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCompactTableView);
} else {
    initCompactTableView();
}

window.triggerManualDbBackup = triggerManualDbBackup;
window.toggleCompactTableView = toggleCompactTableView;




