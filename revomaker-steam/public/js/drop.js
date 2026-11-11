/* REVOMAKER STEAM — drop detail */
(function () {
  'use strict';

  const RV = window.RV;
  if (!RV) return;

  const { $, esc, icon } = RV;

  const slug = decodeURIComponent((window.location.pathname.match(/^\/drop\/([a-z0-9-]+)/i) || [])[1] || '');

  function ctr(views, clicks) {
    const total = Number(views) || 0;
    if (!total) return '0.0%';
    return `${((Number(clicks) || 0) / total * 100).toFixed(1)}%`;
  }

  function renderMain(drop) {
    const main = $('#dropMain');
    if (!main) return;
    const accent = /^#[0-9a-f]{6}$/i.test(drop.category?.accent || '') ? drop.category.accent : '#8b5cf6';
    const thumb = RV.safeImage(drop.thumbnail);
    const host = drop.externalHost || 'official destination';
    const safe = drop.category?.slug === 'cookies';

    main.innerHTML = `
      <div class="drop-main-media">
        <img src="${esc(thumb)}" alt="${esc(drop.title)} key art" width="1200" height="750" />
        <span class="drop-cat" style="--accent:${accent}">${icon(RV.categoryIcon(drop.category?.icon))} ${esc(
      drop.category?.name || 'DROP'
    )}</span>
        <span class="drop-views">${icon('eye')} ${RV.number(drop.views)}</span>
      </div>
      <div class="drop-content" style="--accent:${accent}">
        <div class="drop-kicker">
          <span>${drop.featured ? 'Featured drop' : 'Published drop'}</span>
          <span class="dot-sep"></span>
          <span>${RV.date(drop.publishedAt || drop.createdAt)}</span>
        </div>
        <h1>${esc(drop.title)}</h1>
        <div class="drop-meta-row">
          <span class="inline">${icon(RV.categoryIcon(drop.category?.icon))} ${esc(drop.category?.name || 'DROP')}</span>
          <span class="dot-sep"></span>
          <span class="inline">${icon('calendar')} ${RV.date(drop.publishedAt || drop.createdAt)}</span>
          <span class="dot-sep"></span>
          <span class="inline" data-view-count>${icon('eye')} ${RV.number(drop.views)} views</span>
          <span class="dot-sep"></span>
          <span class="inline">${icon('download')} ${RV.number(drop.clicks)} claims</span>
        </div>
        <div class="drop-prose">${esc(drop.description)}</div>
        <div class="drop-get-panel">
          <a class="btn btn-primary btn-lg get-drop" href="/go/${encodeURIComponent(drop.slug)}"
             target="_blank" rel="noopener noreferrer" data-get-drop
             data-slug="${esc(drop.slug)}" data-title="${esc(drop.title)}">
            GET DROP ${icon('arrow-up-right')}
          </a>
          <div class="drop-destination">
            <div class="drop-destination-label">Official destination</div>
            <div class="drop-destination-host">${icon('shield')} <span>${esc(host)}</span></div>
          </div>
          <button class="btn btn-soft" type="button" data-copy-link>${icon('copy')} Copy link</button>
        </div>
        <div class="drop-safety-note">
          ${icon('shield')}
          <span>${
            safe
              ? 'This cookie-category drop is documentation or a harmless text resource. REVOMAKER STEAM never lists authentication cookies, session tokens or account credentials.'
              : 'This link opens an official destination in a new tab. REVOMAKER STEAM never asks for passwords, session tokens or account credentials.'
          }</span>
        </div>
        <div class="drop-actions-row">
          <a class="btn btn-ghost btn-sm" href="/#latest">${icon('arrow-left')} Back to the feed</a>
          <a class="btn btn-ghost btn-sm" href="/category/${encodeURIComponent(
            drop.category?.slug || 'other'
          )}">${icon('layers')} All ${esc(drop.category?.name || 'drops')}</a>
        </div>
      </div>`;

    main.querySelector('[data-copy-link]')?.addEventListener('click', async () => {
      const ok = await RV.copy(window.location.href);
      RV.toast(ok ? 'Drop link copied to clipboard.' : 'Could not copy the link.', ok ? 'success' : 'error');
    });
  }

  function renderSidebar(drop, related) {
    const sidebar = document.querySelector('.drop-sidebar');
    if (!sidebar) return;
    const accent = /^#[0-9a-f]{6}$/i.test(drop.category?.accent || '') ? drop.category.accent : '#8b5cf6';

    const relatedItems = related
      .slice(0, 4)
      .map(
        (item) => `<a class="related-item" href="/drop/${encodeURIComponent(item.slug)}">
          <span class="related-thumb"><img src="${esc(RV.safeImage(item.thumbnail))}" alt="" loading="lazy" width="64" height="40" /></span>
          <span class="related-info">
            <h4>${esc(item.title)}</h4>
            <span>${RV.compact(item.views)} views · ${RV.date(item.publishedAt)}</span>
          </span>
        </a>`
      )
      .join('');

    sidebar.innerHTML = `
      <div class="side-card">
        <div class="side-card-head"><span>Drop statistics</span><span class="badge badge-live"><span class="live-dot"></span> Live</span></div>
        <div class="side-card-body">
          <div class="drop-stat-grid">
            <div class="drop-stat-cell"><small>Views</small><strong data-stat-views>${RV.number(drop.views)}</strong></div>
            <div class="drop-stat-cell"><small>Clicks</small><strong data-stat-clicks>${RV.number(drop.clicks)}</strong></div>
            <div class="drop-stat-cell"><small>CTR</small><strong data-stat-ctr>${ctr(drop.views, drop.clicks)}</strong></div>
            <div class="drop-stat-cell"><small>Category</small><strong style="font-size:.9rem">${esc(drop.category?.name || 'DROP')}</strong></div>
          </div>
        </div>
      </div>
      <div class="side-card">
        <div class="side-card-head"><span>More like this</span><span>${RV.number(related.length)}</span></div>
        ${
          relatedItems
            ? `<div class="related-list">${relatedItems}</div>`
            : `<div class="side-card-body"><p class="text-muted" style="font-size:.8rem">No related drops yet.</p></div>`
        }
      </div>
      <div class="side-card">
        <a class="side-category" href="/category/${encodeURIComponent(drop.category?.slug || 'other')}" style="--accent:${accent}">
          <span class="category-icon">${icon(RV.categoryIcon(drop.category?.icon))}</span>
          <span><strong>${esc(drop.category?.name || 'DROP')} lane</strong><span>Browse every drop</span></span>
          ${icon('chevron-right')}
        </a>
      </div>`;
  }

  function renderRelated(related, drop) {
    const section = $('#relatedSection');
    const grid = $('#relatedGrid');
    const link = $('#relatedCatLink');
    if (!section || !grid) return;
    if (!related.length) {
      section.hidden = true;
      return;
    }
    grid.innerHTML = related.slice(0, 4).map((item) => RV.dropCard(item)).join('');
    if (link) link.href = `/category/${encodeURIComponent(drop.category?.slug || 'other')}`;
    section.hidden = false;
    RV.observeReveals(grid);
  }

  function renderBreadcrumb(drop) {
    const crumb = $('#dropBreadcrumb');
    if (!crumb) return;
    crumb.innerHTML = `
      <a href="/">Home</a>
      ${icon('chevron-right')}
      <a href="/category/${encodeURIComponent(drop.category?.slug || 'other')}">${esc(drop.category?.name || 'Drops')}</a>
      ${icon('chevron-right')}
      <span aria-current="page">${esc(drop.title)}</span>`;
  }

  function updateCounts(views, clicks) {
    const viewNode = document.querySelector('[data-view-count]');
    if (viewNode) viewNode.innerHTML = `${icon('eye')} ${RV.number(views)} views`;
    const statViews = document.querySelector('[data-stat-views]');
    if (statViews) statViews.textContent = RV.number(views);
    const statClicks = document.querySelector('[data-stat-clicks]');
    if (statClicks) statClicks.textContent = RV.number(clicks);
    const statCtr = document.querySelector('[data-stat-ctr]');
    if (statCtr) statCtr.textContent = ctr(views, clicks);
    const chip = document.querySelector('.drop-views');
    if (chip) chip.innerHTML = `${icon('eye')} ${RV.number(views)}`;
  }

  async function boot() {
    const layout = $('#dropLayout');
    try {
      const data = await RV.api.drop(slug);
      const { drop, related = [] } = data;
      renderBreadcrumb(drop);
      renderMain(drop);
      renderSidebar(drop, related);
      renderRelated(related, drop);
      if (layout) layout.setAttribute('aria-busy', 'false');
      RV.observeReveals();

      RV.api.track
        .view(slug)
        .then((result) => {
          if (result && result.views !== undefined) updateCounts(result.views, drop.clicks);
        })
        .catch(() => {});

      document.addEventListener('click', () => {
        // Refresh the click counter once a claim happens.
        setTimeout(() => {
          RV.api
            .drop(slug)
            .then((fresh) => updateCounts(fresh.drop.views, fresh.drop.clicks))
            .catch(() => {});
        }, 800);
      }, { once: true });
    } catch (error) {
      if (layout) {
        layout.setAttribute('aria-busy', 'false');
        layout.innerHTML = `<div class="empty-state error-state" style="grid-column:1/-1">${icon('alert')}
          <h3>This drop could not be loaded</h3>
          <p>${esc(error.message)}</p>
          <a class="btn btn-primary btn-sm" href="/#latest">Back to the feed</a>
        </div>`;
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
