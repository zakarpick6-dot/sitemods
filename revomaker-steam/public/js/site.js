/* REVOMAKER STEAM — shared site behaviour */
(function () {
  'use strict';

  const RV = window.RV;
  if (!RV) return;

  const { $, $$, esc, icon } = RV;

  /* ------------------------------- navigation ----------------------------- */

  function initNavigation() {
    const toggle = $('[data-nav-toggle]');
    const mobile = $('#mobileNav');
    if (!toggle || !mobile) return;

    const setOpen = (open) => {
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      mobile.classList.toggle('open', open);
    };

    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      setOpen(!mobile.classList.contains('open'));
    });

    mobile.addEventListener('click', (event) => {
      if (event.target.closest('a, button')) setOpen(false);
    });

    document.addEventListener('click', (event) => {
      if (!mobile.classList.contains('open')) return;
      if (event.target.closest('.site-header')) return;
      setOpen(false);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && mobile.classList.contains('open')) setOpen(false);
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 980) setOpen(false);
    });

    const path = window.location.pathname;
    $$('.nav-link').forEach((link) => {
      const href = link.getAttribute('href') || '';
      const sameCategory = path.startsWith('/category/') && href === path.replace(/\/$/, '');
      const dropPage = path.startsWith('/drop/') && href.endsWith('/#latest');
      if (sameCategory || dropPage) {
        $$('.nav-link.active').forEach((node) => node.classList.remove('active'));
        link.classList.add('active');
      }
    });
  }

  /* --------------------------------- search ------------------------------- */

  let overlay = null;
  let searchInput = null;
  let searchResults = null;
  let searchSeq = 0;
  let activeIndex = -1;
  let lastFocused = null;
  let previousOverflow = '';

  function resultMarkup(items) {
    if (!items.length) {
      return `<div class="search-empty">No drops matched that search.<br />Try a platform name or a shorter phrase.</div>`;
    }
    return items
      .map(
        (drop, index) => `<a class="search-result${index === activeIndex ? ' active' : ''}" href="/drop/${encodeURIComponent(
          drop.slug
        )}" data-index="${index}">
          <img src="${esc(RV.safeImage(drop.thumbnail))}" alt="" loading="lazy" width="56" height="35" />
          <span class="search-result-info">
            <strong>${esc(drop.title)}</strong>
            <span>${esc(drop.category ? drop.category.name : 'DROP')} · ${RV.number(drop.views)} views</span>
          </span>
          ${icon('arrow-up-right')}
        </a>`
      )
      .join('');
  }

  async function runSearch(term) {
    if (!searchResults) return;
    const seq = ++searchSeq;
    const limit = term ? 7 : 6;
    let data;
    try {
      data = await RV.api.drops({ q: term || undefined, limit, sort: 'latest' });
    } catch (error) {
      if (seq !== searchSeq || !searchResults) return;
      searchResults.innerHTML = `<div class="search-empty">${esc(error.message)}</div>`;
      return;
    }
    if (seq !== searchSeq || !searchResults) return;
    const items = data.drops || [];
    activeIndex = -1;
    searchResults.innerHTML = `
      <div class="search-label">${term ? `${items.length} result${items.length === 1 ? '' : 's'}` : 'Latest drops'}</div>
      ${resultMarkup(items)}`;
  }

  function updateActive(items) {
    const nodes = $$('.search-result', searchResults);
    nodes.forEach((node, index) => node.classList.toggle('active', index === activeIndex));
    if (nodes[activeIndex]) nodes[activeIndex].scrollIntoView({ block: 'nearest' });
  }

  function openSearch() {
    if (overlay) {
      searchInput.focus();
      return;
    }
    lastFocused = document.activeElement;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    overlay = document.createElement('div');
    overlay.className = 'search-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Search drops');
    overlay.innerHTML = `
      <div class="search-box" role="search">
        <div class="search-box-head">
          ${icon('search')}
          <input type="search" id="globalSearchInput" placeholder="Search the vault…" autocomplete="off" spellcheck="false" aria-label="Search drops" />
          <button class="search-close" type="button" data-search-close aria-label="Close search">ESC</button>
        </div>
        <div class="search-results" id="globalSearchResults" aria-live="polite"></div>
        <div class="search-hint">
          <span class="inline"><kbd>↑</kbd><kbd>↓</kbd> navigate <kbd>↵</kbd> open</span>
          <span>REVOMAKER vault · real-time index</span>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    searchInput = $('#globalSearchInput', overlay);
    searchResults = $('#globalSearchResults', overlay);
    searchResults.innerHTML = '<div class="search-empty">Loading the vault…</div>';

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay || event.target.closest('[data-search-close]')) closeSearch();
      const result = event.target.closest('.search-result');
      if (result) closeSearch();
    });

    const debounced = RV.debounce((value) => runSearch(value.trim()), 200);
    searchInput.addEventListener('input', () => {
      activeIndex = -1;
      debounced(searchInput.value);
    });

    searchInput.addEventListener('keydown', (event) => {
      const nodes = $$('.search-result', searchResults);
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        activeIndex = Math.min(activeIndex + 1, nodes.length - 1);
        updateActive(nodes);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        updateActive(nodes);
      } else if (event.key === 'Enter' && nodes.length) {
        event.preventDefault();
        const target = nodes[Math.max(activeIndex, 0)];
        if (target) window.location.href = target.href;
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeSearch();
      }
    });

    document.addEventListener('keydown', onSearchKeydown, true);
    runSearch('');
    setTimeout(() => searchInput && searchInput.focus({ preventScroll: true }), 30);
  }

  function onSearchKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSearch();
    }
  }

  function closeSearch() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    searchInput = null;
    searchResults = null;
    document.removeEventListener('keydown', onSearchKeydown, true);
    document.body.style.overflow = previousOverflow;
    if (lastFocused && lastFocused.focus) lastFocused.focus({ preventScroll: true });
    lastFocused = null;
  }

  function initSearch() {
    $$('[data-search-open]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        openSearch();
      });
    });

    document.addEventListener('keydown', (event) => {
      const key = event.key.toLowerCase();
      const typing = /^(input|textarea|select)$/i.test(document.activeElement?.tagName || '');
      if ((event.ctrlKey || event.metaKey) && key === 'k') {
        event.preventDefault();
        openSearch();
      } else if (key === '/' && !typing && !overlay) {
        event.preventDefault();
        openSearch();
      }
    });
  }

  /* -------------------------------- GET DROP ------------------------------ */

  function getDropFromEvent(event) {
    const anchor = event.target.closest('a[data-get-drop]');
    if (!anchor) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();

    const slug = anchor.getAttribute('data-slug');
    if (!slug) {
      window.open(anchor.href, '_blank');
      return;
    }

    const title = anchor.getAttribute('data-title') || 'this drop';
    const target = `/go/${encodeURIComponent(slug)}`;
    const popup = window.open(target, '_blank');
    if (popup) {
      try {
        popup.opener = null;
      } catch {
        /* cross-origin once redirected */
      }
      RV.toast(`Claim registered — opening ${title} in a new tab.`, 'success');
      return;
    }

    RV.openModal({
      title: 'Your drop is ready',
      size: 'modal-sm',
      body: `<div class="redirect-card">
        <div class="redirect-emblem"><img src="/assets/brand/logo-192.png" alt="" width="62" height="62" /></div>
        <h3>Popup blocked?</h3>
        <p>Your claim was registered. Open <strong>${esc(title)}</strong> on its official destination below.</p>
        <a class="btn btn-primary" href="${target}" target="_blank" rel="noopener noreferrer">
          Open destination ${icon('arrow-up-right')}
        </a>
      </div>`,
      footer: '',
    });
  }

  /* -------------------------------- visitor ------------------------------- */

  function initVisitorPing() {
    const path = window.location.pathname;
    if (path.startsWith('/admin')) return;

    const PING_KEY = 'rv_visit_ping';
    const last = Number(RV.storage.get(PING_KEY, 0)) || 0;
    if (Date.now() - last < 10 * 60 * 1000) return;
    RV.storage.set(PING_KEY, Date.now());

    RV.api.track
      .visit(path)
      .catch(() => {
        /* tracking is best-effort */
      });
  }

  /* --------------------------------- status ------------------------------- */

  function initHealth() {
    const node = $('#systemStatus');
    if (!node) return;
    RV.api
      .health()
      .then((data) => {
        node.textContent = data.ok ? 'All systems operational' : 'Degraded service';
      })
      .catch(() => {
        node.textContent = 'Status check unavailable';
      });
  }

  function initMisc() {
    const year = $('#year');
    if (year) year.textContent = String(new Date().getFullYear());
    $$('.ticker-track').forEach((track) => {
      if (track.dataset.cloned) return;
      track.dataset.cloned = '1';
      track.innerHTML += track.innerHTML;
    });
  }

  function init() {
    initMisc();
    initNavigation();
    initSearch();
    initHealth();
    initVisitorPing();
    document.addEventListener('click', getDropFromEvent);
    RV.observeReveals();
  }

  RV.site = { openSearch, closeSearch, init };
  init();
})();
