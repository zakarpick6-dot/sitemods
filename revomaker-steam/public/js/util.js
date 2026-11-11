/* REVOMAKER STEAM — shared front-end helpers */
(function () {
  'use strict';

  const RV = (window.RV = window.RV || {});
  let modalSeq = 0;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  RV.$ = $;
  RV.$$ = $$;

  const esc = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  RV.esc = esc;

  const ICON_ALIASES = {
    spark: 'sparkles',
    bolt: 'activity',
    star: 'star',
    shield: 'shield',
    grid: 'grid',
    steam: 'steam',
    xbox: 'xbox',
    cookie: 'cookie',
  };

  RV.categoryIcon = (icon) => ICON_ALIASES[icon] || 'grid';
  RV.icon = (name, cls = 'icon') =>
    `<svg class="${cls}" aria-hidden="true"><use href="/assets/icons.svg#i-${name}"></use></svg>`;

  const numberFmt = new Intl.NumberFormat('en-US');
  const compactFmt = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  });
  RV.number = (n) => numberFmt.format(Number(n) || 0);
  RV.compact = (n) => (Number(n) >= 1000 ? compactFmt.format(Number(n)) : numberFmt.format(Number(n) || 0));

  RV.percent = (value) => `${(Number(value) || 0).toFixed(Number(value) >= 10 ? 0 : 1)}%`;

  RV.date = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  RV.shortDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  RV.dateTime = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  RV.timeAgo = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
  };

  RV.debounce = (fn, wait = 250) => {
    let timer;
    const debounced = (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
    debounced.cancel = () => clearTimeout(timer);
    return debounced;
  };

  RV.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  RV.storage = {
    get(key, fallback = null) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* storage unavailable */
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* noop */
      }
    },
  };

  RV.qs = (key) => new URLSearchParams(window.location.search).get(key);

  RV.setText = (selector, value, root = document) => {
    const node = $(selector, root);
    if (node) node.textContent = value;
  };

  /* ------------------------------- toasts -------------------------------- */

  const TOAST_ICONS = {
    success: 'check-circle',
    error: 'x-circle',
    warning: 'alert',
    info: 'info',
  };

  RV.toast = (message, type = 'info', timeout = 4200) => {
    let stack = $('#toastStack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      stack.id = 'toastStack';
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `${RV.icon(TOAST_ICONS[type] || 'info')}<span>${esc(message)}</span>`;
    stack.appendChild(toast);
    const remove = () => {
      toast.classList.add('hide');
      setTimeout(() => toast.remove(), 320);
    };
    const timer = setTimeout(remove, timeout);
    toast.addEventListener('click', () => {
      clearTimeout(timer);
      remove();
    });
  };

  /* -------------------------------- modals ------------------------------- */

  function lockScroll() {
    document.body.classList.add('no-scroll');
  }
  function unlockScroll() {
    if (!document.querySelector('.modal-backdrop')) document.body.classList.remove('no-scroll');
  }

  /**
   * Open a modal. Content passed in `body` / `footer` must already be escaped
   * by the caller when it contains user-generated text.
   */
  RV.openModal = function openModal(options = {}) {
    const { title, subtitle, body, footer, size = '', closable = true, onMount } = options;
    const id = ++modalSeq;
    const previousFocus = document.activeElement;

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal ${size}" role="dialog" aria-modal="true" aria-labelledby="modal-title-${id}">
        ${
          title
            ? `<div class="modal-head">
                 <div>
                   <h3 class="modal-title" id="modal-title-${id}">${esc(title)}</h3>
                   ${subtitle ? `<p class="modal-sub">${esc(subtitle)}</p>` : ''}
                 </div>
                 ${
                   closable
                     ? `<button class="modal-close" type="button" data-modal-close aria-label="Close dialog">${RV.icon('close')}</button>`
                     : ''
                 }
               </div>`
            : ''
        }
        <div class="modal-body">${body || ''}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
      </div>`;

    const close = () => {
      if (!backdrop.isConnected) return;
      backdrop.remove();
      unlockScroll();
      document.removeEventListener('keydown', onKeydown, true);
      if (previousFocus && previousFocus.focus) previousFocus.focus({ preventScroll: true });
    };

    function onKeydown(event) {
      if (event.key === 'Escape' && closable) {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = $$(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        backdrop
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop && closable) close();
      const closeBtn = event.target.closest('[data-modal-close]');
      if (closeBtn) close();
    });
    document.addEventListener('keydown', onKeydown, true);
    document.body.appendChild(backdrop);
    lockScroll();

    if (onMount) onMount(backdrop.querySelector('.modal'), close, backdrop);
    const focusTarget = $('input, textarea, select, .btn-primary, .btn-danger, button', backdrop);
    if (focusTarget) setTimeout(() => focusTarget.focus({ preventScroll: true }), 40);

    return { close, element: backdrop };
  };

  RV.confirm = function confirm(options = {}) {
    const {
      title = 'Are you sure?',
      message = '',
      confirmLabel = 'Confirm',
      cancelLabel = 'Cancel',
      danger = false,
    } = options;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value, close) => {
        if (settled) return;
        settled = true;
        close();
        resolve(value);
      };
      const modal = RV.openModal({
        title,
        size: 'modal-sm',
        body: `<p style="color:var(--muted);font-size:.87rem;line-height:1.7;margin:0">${esc(message)}</p>`,
        footer: `<button class="btn btn-ghost btn-sm" type="button" data-modal-close>${esc(cancelLabel)}</button>
                 <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-sm" type="button" data-confirm>${esc(confirmLabel)}</button>`,
        onMount(el, close) {
          el.querySelector('[data-confirm]').addEventListener('click', () => finish(true, close));
          el.querySelectorAll('[data-modal-close]').forEach((btn) =>
            btn.addEventListener('click', () => finish(false, close))
          );
        },
      });
      const observer = new MutationObserver(() => {
        if (!modal.element.isConnected) {
          observer.disconnect();
          if (!settled) {
            settled = true;
            resolve(false);
          }
        }
      });
      observer.observe(document.body, { childList: true });
    });
  };

  /* ------------------------------ animations ----------------------------- */

  let revealObserver = null;

  function ensureObserver() {
    if (revealObserver) return revealObserver;
    if (!('IntersectionObserver' in window)) return null;
    revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            revealObserver.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
    );
    return revealObserver;
  }

  RV.observeReveals = (root = document) => {
    const observer = ensureObserver();
    const nodes = $$('.reveal, .reveal-scale', root);
    if (!observer) {
      nodes.forEach((node) => node.classList.add('is-visible'));
      return;
    }
    nodes.forEach((node) => {
      if (!node.classList.contains('is-visible')) observer.observe(node);
    });
  };

  RV.countUp = (element, target, options = {}) => {
    const { duration = 1200, format = RV.number } = options;
    if (!element) return;
    const end = Number(target) || 0;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      element.textContent = format(end);
      return;
    }
    const start = performance.now();
    const from = 0;
    function tick(now) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      element.textContent = format(Math.round(from + (end - from) * eased));
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  };

  /* ------------------------------- visuals ------------------------------- */

  RV.sparkline = (series, key, color = '#8b5cf6') => {
    if (!Array.isArray(series) || !series.length) return '';
    const values = series.map((point) => Number(point[key]) || 0);
    const max = Math.max(...values, 1);
    const w = 150;
    const h = 34;
    const pad = 3;
    const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
    const points = values.map((value, index) => {
      const x = pad + index * step;
      const y = h - pad - (value / max) * (h - pad * 2);
      return [x, y];
    });
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    const area = `${line} L${(pad + (values.length - 1) * step).toFixed(1)} ${h} L${pad} ${h} Z`;
    const id = `sp-${Math.random().toString(36).slice(2, 8)}`;
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${color}" stop-opacity=".35"/>
        <stop offset="1" stop-color="${color}" stop-opacity="0"/>
      </linearGradient></defs>
      <path d="${area}" fill="url(#${id})"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  };

  RV.safeImage = (url, fallback = '/assets/drops/fallback-other.svg') => {
    if (typeof url === 'string' && /^\/(assets|uploads)\//.test(url)) return url;
    return fallback;
  };

  /* ------------------------------ drop card ------------------------------ */

  RV.dropCard = function dropCard(drop, options = {}) {
    const category = drop.category || {};
    const accent = /^#[0-9a-f]{6}$/i.test(category.accent || '') ? category.accent : '#8b5cf6';
    const icon = RV.categoryIcon(category.icon);
    const thumb = RV.safeImage(drop.thumbnail);
    const slug = encodeURIComponent(drop.slug);
    const title = esc(drop.title);
    const date = RV.date(drop.publishedAt || drop.createdAt);
    return `<article class="drop-card reveal" style="--accent:${accent}" data-drop-id="${Number(drop.id) || ''}">
      <a class="drop-media" href="/drop/${slug}" aria-label="Open ${title}">
        <img src="${esc(thumb)}" alt="${title} key art" loading="lazy" width="1200" height="750" />
        <span class="drop-cat">${RV.icon(icon)} ${esc(category.name || 'DROP')}</span>
        <span class="drop-views">${RV.icon('eye')} ${RV.compact(drop.views)}</span>
      </a>
      <div class="drop-body">
        <div class="drop-kicker">
          <span>${esc(date)}</span>
          <span class="dot-sep"></span>
          <span>${drop.featured ? 'Featured' : 'Published'}</span>
        </div>
        <h3 class="drop-title"><a href="/drop/${slug}">${title}</a></h3>
        <p class="drop-desc">${esc(drop.description)}</p>
        <div class="drop-foot">
          <span class="drop-clicks">${RV.icon('download')} ${RV.number(drop.clicks)} claims</span>
          <a class="btn btn-primary get-drop" href="/go/${slug}" target="_blank" rel="noopener noreferrer"
             data-get-drop data-slug="${slug}" data-title="${title}" aria-label="Get ${title}">
            GET DROP ${RV.icon('arrow-up-right')}
          </a>
        </div>
      </div>
    </article>`;
  };

  RV.featureCard = function featureCard(drop) {
    const category = drop.category || {};
    const accent = /^#[0-9a-f]{6}$/i.test(category.accent || '') ? category.accent : '#8b5cf6';
    const thumb = RV.safeImage(drop.thumbnail);
    const slug = encodeURIComponent(drop.slug);
    return `<article class="feature-card reveal" style="--accent:${accent}">
      <img src="${esc(thumb)}" alt="${esc(drop.title)} key art" loading="lazy" width="1200" height="750" />
      <div class="feature-body">
        <div class="feature-topline">
          <span class="badge badge-accent" style="--accent:${accent}">${RV.icon(RV.categoryIcon(category.icon))} ${esc(category.name || 'DROP')}</span>
          <span class="badge badge-live">${RV.icon('flame')} Featured</span>
        </div>
        <h3 class="feature-title"><a href="/drop/${slug}">${esc(drop.title)}</a></h3>
        <p class="feature-desc">${esc(drop.description)}</p>
        <div class="feature-foot">
          <span class="feature-meta">${RV.icon('eye')} ${RV.number(drop.views)} <span class="dot-sep"></span> ${RV.date(drop.publishedAt)}</span>
          <a class="btn btn-soft btn-sm" href="/go/${slug}" target="_blank" rel="noopener noreferrer"
             data-get-drop data-slug="${slug}" data-title="${esc(drop.title)}">
            GET DROP ${RV.icon('arrow-up-right')}
          </a>
        </div>
      </div>
    </article>`;
  };

  RV.emptyState = (title, message, icon = 'search') =>
    `<div class="empty-state">${RV.icon(icon)}<h3>${esc(title)}</h3><p>${esc(message)}</p></div>`;

  RV.copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        textarea.remove();
        return ok;
      } catch {
        return false;
      }
    }
  };

  RV.initials = (name) =>
    String(name || '?')
      .split(/\s+/)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

  document.documentElement.classList.add('js');
})();
