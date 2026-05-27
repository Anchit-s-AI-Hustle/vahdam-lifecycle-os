/* eslint-env browser */
/**
 * table-sort.js — drop-in column sorting for any <table>.
 *
 * Usage in HTML:
 *   <table data-sortable>
 *     <thead><tr>
 *       <th>Name</th>
 *       <th data-sort="number">Revenue</th>
 *       <th data-sort="number">Open %</th>
 *       <th data-sort="date">Sent</th>
 *       <th data-no-sort>Actions</th>
 *     </tr></thead>
 *     <tbody> ... </tbody>
 *   </table>
 *
 * - Click a header to sort asc; click again to flip; click again to clear.
 * - Numeric / date / string / pct detection is automatic if you don't set data-sort.
 * - Works on dynamically re-rendered tables: just call window.attachTableSort()
 *   after re-rendering or rely on the MutationObserver auto-attach.
 */
(function () {
  'use strict';

  if (window.attachTableSort) return;

  function parseCell(text, type) {
    if (type === 'number' || type === 'currency' || type === 'pct') {
      const n = parseFloat(String(text).replace(/[^0-9.\-]/g, ''));
      return isNaN(n) ? -Infinity : n;
    }
    if (type === 'date') {
      const t = Date.parse(text);
      return isNaN(t) ? -Infinity : t;
    }
    return String(text).trim().toLowerCase();
  }

  function detectType(values) {
    let numeric = 0, date = 0, total = 0;
    for (const v of values) {
      const s = String(v).trim();
      if (!s) continue;
      total++;
      if (/^[\-+]?[$£€₹]?[\d,]+(\.\d+)?(%|k|m|cr)?$/i.test(s.replace(/\s/g, ''))) numeric++;
      else if (!isNaN(Date.parse(s)) && /\d/.test(s)) date++;
    }
    if (numeric / Math.max(1, total) > 0.65) return 'number';
    if (date / Math.max(1, total) > 0.65) return 'date';
    return 'string';
  }

  function applySort(table, colIndex, type, direction) {
    const tbody = table.tBodies[0];
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll(':scope > tr'));
    if (!rows.length) return;
    rows.sort((a, b) => {
      const av = parseCell(a.cells[colIndex]?.dataset.sortValue ?? a.cells[colIndex]?.innerText ?? '', type);
      const bv = parseCell(b.cells[colIndex]?.dataset.sortValue ?? b.cells[colIndex]?.innerText ?? '', type);
      if (av < bv) return direction === 'asc' ? -1 : 1;
      if (av > bv) return direction === 'asc' ? 1 : -1;
      return 0;
    });
    const frag = document.createDocumentFragment();
    rows.forEach((r) => frag.appendChild(r));
    tbody.appendChild(frag);
  }

  function injectStylesOnce() {
    if (document.getElementById('table-sort-styles')) return;
    const css = document.createElement('style');
    css.id = 'table-sort-styles';
    css.textContent = `
      table[data-sortable] th[data-sortable-col] {
        cursor: pointer; user-select: none; position: relative;
        transition: color .12s;
      }
      table[data-sortable] th[data-sortable-col]:hover { color: #FBF5EA; }
      table[data-sortable] th[data-sortable-col] .ts-arrow {
        display: inline-block; margin-left: 4px; opacity: 0.25;
        font-size: 0.85em; transition: opacity .12s, transform .12s;
        font-family: 'JetBrains Mono', monospace;
      }
      table[data-sortable] th[data-sort-direction] .ts-arrow {
        opacity: 1; color: #AB8743;
      }
      table[data-sortable] th[data-sort-direction="asc"]  .ts-arrow::before { content: '▲'; }
      table[data-sortable] th[data-sort-direction="desc"] .ts-arrow::before { content: '▼'; }
    `;
    document.head.appendChild(css);
  }

  function attachTableSort(root) {
    injectStylesOnce();
    const scope = root || document;
    const tables = scope.querySelectorAll('table[data-sortable]:not([data-sort-attached])');
    tables.forEach((table) => {
      table.dataset.sortAttached = '1';
      const headers = table.querySelectorAll('thead th');
      headers.forEach((th, i) => {
        if (th.hasAttribute('data-no-sort')) return;
        th.dataset.sortableCol = String(i);
        if (!th.querySelector('.ts-arrow')) {
          const arrow = document.createElement('span');
          arrow.className = 'ts-arrow';
          th.appendChild(arrow);
        }
        th.addEventListener('click', () => {
          const current = th.dataset.sortDirection;
          const next = current === 'asc' ? 'desc' : current === 'desc' ? null : 'asc';
          // Clear other headers
          headers.forEach((h) => { if (h !== th) delete h.dataset.sortDirection; });
          if (!next) { delete th.dataset.sortDirection; return; }
          th.dataset.sortDirection = next;
          // Detect type
          let type = th.dataset.sort;
          if (!type) {
            const sample = Array.from(table.tBodies[0]?.rows || []).slice(0, 20).map((r) => r.cells[i]?.innerText || '');
            type = detectType(sample);
          }
          applySort(table, i, type, next);
        });
      });
    });
  }

  // Re-attach when DOM updates (any dashboard re-render).
  const observer = new MutationObserver((mutations) => {
    let needsAttach = false;
    for (const m of mutations) {
      if (m.addedNodes.length) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && (n.matches?.('table[data-sortable]') || n.querySelector?.('table[data-sortable]'))) {
            needsAttach = true; break;
          }
        }
      }
    }
    if (needsAttach) attachTableSort();
  });

  function boot() {
    attachTableSort();
    observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.attachTableSort = attachTableSort;
})();
