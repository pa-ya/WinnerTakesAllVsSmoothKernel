// ============================================================
// DekantPM Comparison — UI glue (theme, formatting, settings, init)
// ============================================================
// Loaded LAST, after the engine files (engines/core.js, l2.js, lmsr.js,
// dual.js). Holds only browser/UI state + helpers; all market math lives in
// the engine modules. globalTraders now lives in engines/core.js.
'use strict';

// ============================================================
// 2. GLOBAL STATE
// ============================================================
var currentTheme = 'dark';
var dualMarket = null;         // DualMarket instance

var settings = {
  fontSize: 'md',
  numberFormat: 'short',
  decimalPrecision: 1,
  statsMode: 'cards',
};

// ============================================================
// 3. THEME
// ============================================================
function applyHtmlClass() {
  document.documentElement.className = 'theme-' + currentTheme;
}

function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyHtmlClass();
  var icon = document.getElementById('themeIcon');
  if (icon) icon.textContent = currentTheme === 'dark' ? '☾' : '☀';
  updateAllCharts();
  saveSettings();
}

function applyFontSize(size) {
  settings.fontSize = size || 'md';
  var map = { xs: '13px', sm: '14px', md: '16px', lg: '18px', xl: '20px' };
  document.documentElement.style.fontSize = map[settings.fontSize] || '16px';
}

// ============================================================
// 4. UTILITIES
// ============================================================
function debounce(fn, ms) {
  var timer;
  return function () {
    var ctx = this, args = arguments;
    clearTimeout(timer);
    timer = setTimeout(function () { fn.apply(ctx, args); }, ms);
  };
}

function isLargeMarket() {
  return dualMarket && dualMarket.lmsr && dualMarket.lmsr.N >= 128;
}

function formatCompact(n) {
  if (n == null || isNaN(n)) return '—';
  var abs = Math.abs(n);
  var prec = settings.decimalPrecision;
  if (settings.numberFormat === 'long') {
    return n.toLocaleString('en-US', { minimumFractionDigits: prec, maximumFractionDigits: prec });
  }
  if (abs >= 1e9) return (n / 1e9).toFixed(prec) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(prec) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(prec) + 'K';
  return n.toFixed(prec);
}

function formatPct(n) {
  if (n == null || isNaN(n)) return '—';
  return (n * 100).toFixed(settings.decimalPrecision) + '%';
}

function formatPnl(n) {
  if (n == null || isNaN(n)) return '—';
  var s = formatCompact(n);
  return n >= 0 ? '+' + s : s;
}

function getChartColors() {
  var s = getComputedStyle(document.documentElement);
  return {
    primary: s.getPropertyValue('--primary').trim() || '#3b82f6',
    accent: s.getPropertyValue('--accent').trim() || '#06b6d4',
    text: s.getPropertyValue('--text').trim() || '#e2e8f0',
    textMuted: s.getPropertyValue('--text-muted').trim() || '#94a3b8',
    border: s.getPropertyValue('--border').trim() || '#334155',
    success: s.getPropertyValue('--success').trim() || '#22c55e',
    warning: s.getPropertyValue('--warning').trim() || '#f59e0b',
    danger: s.getPropertyValue('--danger').trim() || '#ef4444',
    purple: s.getPropertyValue('--purple').trim() || '#a855f7',
    bg: s.getPropertyValue('--bg-secondary').trim() || '#1e293b',
    grid: currentTheme === 'dark' ? 'rgba(148,163,184,0.18)' : 'rgba(100,116,139,0.12)',
  };
}

function showToast(message, type) {
  var container = document.getElementById('toastContainer');
  if (!container) return;
  var toast = document.createElement('div');
  toast.className = 'toast toast-' + (type || 'info');
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(function () { if (toast.parentNode) toast.remove(); }, 3100);
}

function updateAllCharts() {
  if (dualMarket && dualMarket.initialized) {
    if (typeof initDistCharts === 'function') {
      initDistCharts();
      if (typeof refreshDistCharts === 'function') refreshDistCharts();
    }
    // Combined charts
    if (typeof initCombinedDistChart === 'function') initCombinedDistChart();
    if (typeof refreshCombinedDistChart === 'function') refreshCombinedDistChart();
    // Re-apply dataset visibility from checkbox states after chart recreation
    if (typeof reapplyDatasetToggles === 'function') reapplyDatasetToggles();
    // Re-apply resolution markers and kernel chart if resolved
    if (typeof applyResolutionMarkers === 'function') applyResolutionMarkers();
    if (dualMarket.lmsr.resolved && typeof renderKernelChart === 'function') {
      renderKernelChart(dualMarket.lmsr.winningBin);
    }
    // LP charts
    if (typeof initLpPayoutCharts === 'function') initLpPayoutCharts();
    if (typeof refreshLpTab === 'function') refreshLpTab();
    // Payout analysis chart
    if (typeof renderPayoutAnalysisChart === 'function') renderPayoutAnalysisChart();
  }
}

function saveSettings() {
  try {
    localStorage.setItem('dekantpm_comparison_settings_v1', JSON.stringify({
      theme: currentTheme,
      fontSize: settings.fontSize,
      numberFormat: settings.numberFormat,
      decimalPrecision: settings.decimalPrecision,
      statsMode: settings.statsMode,
    }));
  } catch (e) { /* ignore */ }
}

function loadSettings() {
  try {
    var raw = localStorage.getItem('dekantpm_comparison_settings_v1');
    if (!raw) return;
    var s = JSON.parse(raw);
    if (s.theme) currentTheme = s.theme;
    if (s.fontSize) settings.fontSize = s.fontSize;
    if (s.numberFormat) settings.numberFormat = s.numberFormat;
    if (typeof s.decimalPrecision === 'number') settings.decimalPrecision = s.decimalPrecision;
    if (s.statsMode) settings.statsMode = s.statsMode;
  } catch (e) { /* ignore */ }
}

// ============================================================
// 10. INITIALIZATION
// ============================================================
(function () {
  loadSettings();
  applyHtmlClass();
  applyFontSize(settings.fontSize);
})();

