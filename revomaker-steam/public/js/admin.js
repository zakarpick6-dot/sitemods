/* REVOMAKER STEAM — owner console */
(function () {
  'use strict';

  const RV = window.RV;
  if (!RV) return;

  const { $, $$, esc, icon } = RV;

  const VIEW_META = {
    overview: ['Overview', 'The vault at a glance.'],
    drops: ['Drops', 'Create, publish and retire every drop.'],
    categories: ['Categories', 'The four lanes that organise the vault.'],
    analytics: ['Analytics', 'Real traffic, straight from SQLite.'],
    activity: ['Activity', 'Live events and the owner audit trail.'],
    security: ['Security', 'Owners, sessions and account hardening.'],
  };

  const state = {
    user: null,
    view: 'overview',
    categories: [],
    overview: null,
    analytics: null,
    analyticsDays: 30,
    drops: {
      items: [],
      page: 1,
      limit: 8,
      total: 0,
      pages: 1,
      q: '',
      status: '',
      category: '',
      loaded: false,
    },
    activity: null,
    owners: [],
    ownerLimit: 3,
    sessions: [],
  };

  const dropCache = new Map();

  /* -------------------------------- helpers ------------------------------- */

  function canView(view) {
    return Object.prototype.hasOwnProperty.call(VIEW_META, view);
  }

  function handleError(error, fallback = 'Something went wrong.') {
    if (error && error.status === 401) {
      window.location.replace('/admin/login?expired=1');
      return;
    }
    RV.toast(error && error.message ? error.message : fallback, 'error');
  }

  function setSync(mode) {
    const node = $('#syncStatus');
    if (!node) return;
    node.classList.toggle('stale', mode === 'stale');
    node.innerHTML =
      mode === 'syncing'
        ? '<span class="live-dot" aria-hidden="true"></span> Syncing…'
        : mode === 'stale'
          ? '<span class="live-dot" aria-hidden="true"></span> Stale'
          : '<span class="live-dot" aria-hidden="true"></span> Synced';
  }

  function fmt(value) {
    return RV.number(Number(value) || 0);
  }

  function ctr(views, clicks) {
    const total = Number(views) || 0;
    if (!total) return '0.0%';
    return `${(((Number(clicks) || 0) / total) * 100).toFixed(1)}%`;
  }

  function delta(current, previous) {
    const a = Number(current) || 0;
    const b = Number(previous) || 0;
    if (!b) return a ? '<span class="admin-delta up">new</span>' : '<span class="admin-delta">—</span>';
    const pct = ((a - b) / b) * 100;
    const cls = pct >= 0 ? 'up' : 'down';
    const sign = pct >= 0 ? '+' : '';
    return `<span class="admin-delta ${cls}">${sign}${pct.toFixed(0)}%</span>`;
  }

  function statCard({ label, value, iconName, accent = '#8b5cf6', foot = '', deltaHtml = '' }) {
    return `<article class="admin-stat" style="--stat-accent:${accent}">
      <div class="admin-stat-top">
        <span class="admin-stat-icon">${icon(iconName)}</span>
        ${deltaHtml || '<span class="admin-delta">live</span>'}
      </div>
      <div class="admin-stat-value">${value}</div>
      <div class="admin-stat-label">${esc(label)}</div>
      <div class="admin-stat-foot">${foot}</div>
    </article>`;
  }

  function categoryIcon(iconName) {
    return icon(RV.categoryIcon(iconName));
  }

  function catAccent(category) {
    return category && /^#[0-9a-f]{6}$/i.test(category.accent || '') ? category.accent : '#8b5cf6';
  }

  function fallbackThumb(slug) {
    const known = ['steam', 'xbox', 'cookies', 'other'];
    return `/assets/drops/fallback-${known.includes(slug) ? slug : 'other'}.svg`;
  }

  function eventLabel(event) {
    if (event.type === 'click') return event.drop_title ? `Claim · ${event.drop_title}` : 'Claim opened';
    if (event.type === 'view') return event.drop_title ? `View · ${event.drop_title}` : 'Drop view';
    return `Visit · ${event.path || '/'}`;
  }

  function eventIcon(type) {
    return type === 'click' ? 'download' : type === 'view' ? 'eye' : 'users';
  }

  function humanAction(action) {
    return String(action || 'action')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function emptyBox(message, iconName = 'layers') {
    return `<div class="admin-empty">${icon(iconName)}<span>${esc(message)}</span></div>`;
  }

  /* --------------------------------- charts ------------------------------- */

  let chartSeq = 0;

  function chartSvg(series, { height = 240, label = 'Traffic chart' } = {}) {
    if (!Array.isArray(series) || !series.length) {
      return '<div class="chart-empty">No traffic recorded in this window yet.</div>';
    }
    const max = Math.max(...series.map((p) => Math.max(p.views || 0, p.clicks || 0, p.visits || 0)), 1);
    const niceMax = Math.max(4, Math.ceil(max / 4) * 4);
    const w = 820;
    const h = height;
    const pad = { l: 38, r: 8, t: 10, b: 26 };
    const innerW = w - pad.l - pad.r;
    const innerH = h - pad.t - pad.b;
    const step = series.length > 1 ? innerW / (series.length - 1) : 0;
    const x = (index) => pad.l + index * step;
    const y = (value) => pad.t + innerH - (Math.min(value, niceMax) / niceMax) * innerH;
    const id = `chart-${++chartSeq}`;

    const line = (key) =>
      series
        .map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${y(Number(point[key]) || 0).toFixed(1)}`)
        .join(' ');

    const viewLine = line('views');
    const area = `${viewLine} L${x(series.length - 1).toFixed(1)} ${(pad.t + innerH).toFixed(1)} L${pad.l} ${(
      pad.t + innerH
    ).toFixed(1)} Z`;

    const grid = [0, 0.25, 0.5, 0.75, 1]
      .map((fraction) => {
        const gy = pad.t + innerH - fraction * innerH;
        const value = Math.round(fraction * niceMax);
        return `<line x1="${pad.l}" y1="${gy}" x2="${w - pad.r}" y2="${gy}" stroke="rgba(255,255,255,.06)" stroke-width="1" />
          <text x="${pad.l - 6}" y="${gy + 3}" text-anchor="end">${value}</text>`;
      })
      .join('');

    const labelCount = Math.min(7, series.length);
    const labelEvery = Math.max(1, Math.floor((series.length - 1) / Math.max(1, labelCount - 1)));
    const xLabels = series
      .map((point, index) => {
        if (index % labelEvery !== 0 && index !== series.length - 1) return '';
        const lx = x(index);
        const text = String(point.day || '').slice(5);
        return `<text x="${lx}" y="${h - 7}" text-anchor="middle">${esc(text)}</text>`;
      })
      .join('');

    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">
      <defs>
        <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#38bdf8" stop-opacity=".26" />
          <stop offset="1" stop-color="#38bdf8" stop-opacity="0" />
        </linearGradient>
      </defs>
      ${grid}
      <path d="${area}" fill="url(#${id})" />
      <path d="${viewLine}" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <path d="${line('clicks')}" fill="none" stroke="#8b5cf6" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" opacity=".9" />
      <path d="${line('visits')}" fill="none" stroke="#22c55e" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" opacity=".75" stroke-dasharray="3 3" />
      ${xLabels}
    </svg>`;
  }

  function barChart(buckets) {
    if (!Array.isArray(buckets) || !buckets.length) {
      return '<div class="chart-empty">No buckets yet.</div>';
    }
    const max = Math.max(...buckets.map((bucket) => Number(bucket.views) || 0), 1);
    return buckets
      .map((bucket) => {
        const value = Number(bucket.views) || 0;
        const pct = Math.max(2, Math.round((value / max) * 100));
        const label = String(bucket.start || '').slice(5) || '—';
        return `<div class="admin-bar-col" title="${esc(bucket.start || '')} → ${esc(
          bucket.end || ''
        )} · ${value} views">
          <strong>${RV.compact(value)}</strong>
          <div class="admin-bar-track"><span class="admin-bar-fill" style="height:${pct}%"></span></div>
          <small>${esc(label)}</small>
        </div>`;
      })
      .join('');
  }

  function breakdownList(rows, key) {
    if (!rows || !rows.length) return '<p class="admin-muted">No data recorded yet.</p>';
    const max = Math.max(...rows.map((row) => Number(row.total) || 0), 1);
    return rows
      .map((row) => {
        const total = Number(row.total) || 0;
        const pct = Math.max(4, Math.round((total / max) * 100));
        return `<div class="admin-breakdown-row">
          <span title="${esc(row[key])}">${esc(row[key])}</span>
          <div class="mini-bar"><i style="width:${pct}%"></i></div>
          <strong>${fmt(total)}</strong>
        </div>`;
      })
      .join('');
  }

  /* -------------------------------- overview ------------------------------ */

  function eventList(events) {
    if (!events || !events.length) return emptyBox('Nothing tracked yet.', 'activity');
    return events
      .map((event) => {
        const type = ['view', 'click', 'visit'].includes(event.type) ? event.type : 'visit';
        const link = event.drop_slug
          ? `<a class="admin-activity-link" href="/drop/${encodeURIComponent(event.drop_slug)}" target="_blank" rel="noopener">Open drop ${icon(
              'arrow-up-right'
            )}</a>`
          : '';
        return `<div class="admin-event-item">
          <span class="admin-event-icon ${type}">${icon(eventIcon(type))}</span>
          <div class="admin-event-body">
            <strong>${esc(eventLabel(event))}</strong>
            <span>${esc(type)} · ${esc(event.device || 'desktop')} · ${esc(event.category || 'general')}</span>
            ${link}
          </div>
          <time class="admin-event-time" datetime="${esc(event.created_at)}">${RV.timeAgo(event.created_at)}</time>
        </div>`;
      })
      .join('');
  }

  function topDropList(drops) {
    if (!drops || !drops.length) return emptyBox('No drops yet.', 'layers');
    return drops
      .map((drop, index) => {
        const category =
          drop.category ||
          drop.category_name ||
          (state.categories.find((item) => Number(item.id) === Number(drop.category_id)) || {}).name ||
          'DROP';
        return `<div class="admin-list-row">
          <span class="admin-list-rank">${String(index + 1).padStart(2, '0')}</span>
          <a class="admin-list-thumb" href="/drop/${encodeURIComponent(drop.slug)}" target="_blank" rel="noopener" aria-label="Open ${esc(
            drop.title
          )}">
            <img src="${esc(RV.safeImage(drop.thumbnail))}" alt="" loading="lazy" width="46" height="29" />
          </a>
          <div class="admin-list-info">
            <strong>${esc(drop.title)}</strong>
            <span>${esc(category)} · ${RV.number(drop.views || 0)} views</span>
          </div>
          <div class="admin-list-metrics">
            <span class="inline">${icon('eye')} ${RV.compact(drop.views)}</span>
            <span class="inline">${icon('download')} ${RV.compact(drop.clicks)}</span>
          </div>
        </div>`;
      })
      .join('');
  }

  function renderOverview(data) {
    state.overview = data;
    const published = Number(data.published) || 0;
    const drafts = Number(data.drafts) || 0;
    const views = Number(data.totalViews) || 0;
    const clicks = Number(data.totalClicks) || 0;
    const visitors = Number(data.totalVisitors) || 0;
    const week = data.week || {};
    const previous = data.previous || {};

    $('#overviewStats').innerHTML = [
      statCard({
        label: 'Published drops',
        value: fmt(published),
        iconName: 'layers',
        accent: '#8b5cf6',
        foot: `${fmt(drafts)} draft${drafts === 1 ? '' : 's'} waiting`,
      }),
      statCard({
        label: 'Total views',
        value: fmt(views),
        iconName: 'eye',
        accent: '#38bdf8',
        foot: `${fmt(week.views)} in the last 7 days`,
        deltaHtml: delta(week.views, previous.views),
      }),
      statCard({
        label: 'Claim clicks',
        value: fmt(clicks),
        iconName: 'download',
        accent: '#22c55e',
        foot: `${fmt(week.clicks)} in the last 7 days`,
        deltaHtml: delta(week.clicks, previous.clicks),
      }),
      statCard({
        label: 'Visitors',
        value: fmt(visitors),
        iconName: 'users',
        accent: '#d946ef',
        foot: `${fmt(week.visits)} visits this week`,
        deltaHtml: delta(week.visits, previous.visits),
      }),
      statCard({
        label: 'View → claim rate',
        value: ctr(views, clicks),
        iconName: 'activity',
        accent: '#f59e0b',
        foot: 'All time, published + drafts',
      }),
      statCard({
        label: 'Categories',
        value: fmt(Array.isArray(data.categories) ? data.categories.length : data.categories),
        iconName: 'tag',
        accent: '#6366f1',
        foot: 'Owner-managed lanes',
      }),
    ].join('');

    const chart = $('#overviewChart');
    if (chart) chart.innerHTML = chartSvg(data.series || [], { height: 240, label: '14 day traffic' });

    const activity = $('#overviewActivity');
    if (activity) activity.innerHTML = eventList(data.recent || []);

    const tops = $('#overviewTopDrops');
    if (tops) tops.innerHTML = topDropList(data.topDrops || []);

    const catHolder = $('#overviewCategories');
    if (catHolder) {
      const categories = data.categories || [];
      const max = Math.max(...categories.map((category) => Number(category.views) || 0), 1);
      catHolder.innerHTML = categories.length
        ? categories
            .map(
              (category) => `<div class="admin-cat-bar" style="--cat-accent:${catAccent(category)}">
                <span>${esc(category.name)}</span>
                <div class="admin-cat-bar-track"><i style="width:${Math.max(
                  4,
                  Math.round(((Number(category.views) || 0) / max) * 100)
                )}%"></i></div>
                <strong>${fmt(category.drops)}</strong>
              </div>`
            )
            .join('')
        : emptyBox('No categories yet.', 'tag');
    }

    const navCount = $('#navDropCount');
    if (navCount) navCount.textContent = fmt(data.allDrops);
  }

  async function loadOverview() {
    try {
      const data = await RV.api.admin.overview();
      renderOverview(data);
    } catch (error) {
      handleError(error, 'Could not load the overview.');
    }
  }

  /* --------------------------------- drops -------------------------------- */

  function dropRow(drop) {
    const category = drop.category || {};
    const featured = drop.featured ? ' <span class="status-pill featured">Featured</span>' : '';
    return `<tr data-drop-row="${drop.id}">
      <td>
        <div class="admin-drop-cell">
          <span class="admin-drop-thumb"><img src="${esc(RV.safeImage(drop.thumbnail))}" alt="" loading="lazy" width="58" height="36" /></span>
          <div class="admin-drop-info">
            <strong title="${esc(drop.title)}">${esc(drop.title)}</strong>
            <span>/${esc(drop.slug)}</span>
          </div>
        </div>
      </td>
      <td>
        <span class="cat-chip" style="--cat-accent:${catAccent(category)}">${categoryIcon(category.icon)} ${esc(
      category.name || 'DROP'
    )}</span>
      </td>
      <td><span class="status-pill ${drop.status}">${esc(drop.status)}</span>${featured}</td>
      <td class="num">${fmt(drop.views)}</td>
      <td class="num">${fmt(drop.clicks)}</td>
      <td><span class="admin-muted" title="${esc(RV.dateTime(drop.updatedAt))}">${RV.timeAgo(drop.updatedAt)}</span></td>
      <td class="actions">
        <span class="admin-actions">
          <a class="btn-icon" href="/drop/${encodeURIComponent(drop.slug)}" target="_blank" rel="noopener" aria-label="View ${esc(
      drop.title
    )} live" title="View live">${icon('globe')}</a>
          <button class="btn-icon" type="button" data-drop-stats="${drop.id}" aria-label="Stats for ${esc(
      drop.title
    )}" title="Statistics">${icon('chart')}</button>
          <button class="btn-icon" type="button" data-drop-edit="${drop.id}" aria-label="Edit ${esc(
      drop.title
    )}" title="Edit">${icon('pencil')}</button>
          <button class="btn-icon danger" type="button" data-drop-delete="${drop.id}" aria-label="Delete ${esc(
      drop.title
    )}" title="Delete">${icon('trash')}</button>
        </span>
      </td>
    </tr>`;
  }

  function renderDrops(data) {
    state.drops.items = data.drops || [];
    state.drops.total = data.total || 0;
    state.drops.page = data.page || 1;
    state.drops.pages = data.pages || 1;
    state.drops.loaded = true;
    dropCache.clear();
    state.drops.items.forEach((drop) => dropCache.set(String(drop.id), drop));

    const body = $('#dropsTableBody');
    if (body) {
      body.innerHTML = state.drops.items.length
        ? state.drops.items.map((drop) => dropRow(drop)).join('')
        : `<tr><td colspan="7">${emptyBox('No drops matched those filters.', 'search')}</td></tr>`;
    }

    const start = state.drops.total ? (state.drops.page - 1) * state.drops.limit + 1 : 0;
    const end = Math.min(state.drops.page * state.drops.limit, state.drops.total);
    RV.setText('#dropsRange', `${fmt(start)}–${fmt(end)} of ${fmt(state.drops.total)} drops`);
    RV.setText('#dropsPage', `${state.drops.page} / ${state.drops.pages}`);
    const prev = $('#dropsPrev');
    const next = $('#dropsNext');
    if (prev) prev.disabled = state.drops.page <= 1;
    if (next) next.disabled = state.drops.page >= state.drops.pages;
    const navCount = $('#navDropCount');
    if (navCount && state.overview) navCount.textContent = fmt(state.overview.allDrops);
  }

  async function loadDrops() {
    try {
      const data = await RV.api.admin.drops({
        page: state.drops.page,
        limit: state.drops.limit,
        q: state.drops.q || undefined,
        status: state.drops.status || undefined,
        category: state.drops.category || undefined,
      });
      renderDrops(data);
    } catch (error) {
      handleError(error, 'Could not load drops.');
    }
  }

  /* ------------------------------- categories ----------------------------- */

  function renderCategories(categories) {
    state.categories = categories;
    const grid = $('#categoriesGrid');
    if (grid) {
      grid.innerHTML = categories.length
        ? categories
            .map(
              (category) => `<article class="admin-cat-card" style="--cat-accent:${catAccent(category)}">
                <div class="admin-cat-card-top">
                  <span class="admin-cat-icon">${categoryIcon(category.icon)}</span>
                  <span class="badge">${esc(category.slug)}</span>
                </div>
                <h3>${esc(category.name)}</h3>
                <p>${esc(category.description)}</p>
                <div class="admin-cat-stats">
                  <span><strong>${fmt(category.publishedDrops)}</strong>live drops</span>
                  <span><strong>${fmt(category.totalDrops)}</strong>total</span>
                  <span><strong>${RV.compact(category.views)}</strong>views</span>
                </div>
                <div class="admin-cat-actions">
                  <button class="btn-icon" type="button" data-cat-edit="${category.id}" aria-label="Edit ${esc(
                category.name
              )}" title="Edit">${icon('pencil')}</button>
                  <button class="btn-icon" type="button" data-cat-delete="${category.id}" aria-label="Delete ${esc(
                category.name
              )}" title="Delete">${icon('trash')}</button>
                </div>
              </article>`
            )
            .join('')
        : emptyBox('No categories yet. Create the first lane.', 'tag');
    }

    const select = $('#dropsCategory');
    if (select) {
      const current = state.drops.category;
      select.innerHTML =
        '<option value="">All categories</option>' +
        categories
          .map((category) => `<option value="${esc(category.slug)}">${esc(category.name)}</option>`)
          .join('');
      select.value = current;
    }
  }

  async function loadCategories() {
    try {
      const data = await RV.api.admin.categories();
      renderCategories(data.categories || []);
    } catch (error) {
      handleError(error, 'Could not load categories.');
    }
  }

  /* -------------------------------- analytics ----------------------------- */

  function renderAnalytics(data) {
    state.analytics = data;
    const totals = data.totals || {};
    const allTime = data.allTime || {};
    $('#analyticsStats').innerHTML = [
      statCard({
        label: 'Views in range',
        value: fmt(totals.views),
        iconName: 'eye',
        accent: '#38bdf8',
        foot: `${fmt(allTime.views)} all time`,
      }),
      statCard({
        label: 'Claims in range',
        value: fmt(totals.clicks),
        iconName: 'download',
        accent: '#8b5cf6',
        foot: `${fmt(allTime.clicks)} all time`,
      }),
      statCard({
        label: 'Click-through rate',
        value: `${(Number(totals.ctr) || 0).toFixed(1)}%`,
        iconName: 'activity',
        accent: '#22c55e',
        foot: 'Claims ÷ views',
      }),
      statCard({
        label: 'Visitors in range',
        value: fmt(totals.visitors),
        iconName: 'users',
        accent: '#d946ef',
        foot: `${fmt(allTime.visitors)} all-time visitors`,
      }),
      statCard({
        label: 'Visits in range',
        value: fmt(totals.visits),
        iconName: 'monitor',
        accent: '#f59e0b',
        foot: 'Page views tracked',
      }),
    ].join('');

    $('#analyticsChart').innerHTML = chartSvg(data.series || [], {
      height: 260,
      label: `${data.days} day analytics`,
    });
    RV.setText('#analyticsChartSub', `Daily performance across the last ${data.days} days.`);
    RV.setText('#analyticsRangeLabel', `Last ${data.days} days`);

    const top = $('#analyticsTop');
    if (top) top.innerHTML = topDropList(data.topDrops || []);
    const devices = $('#devicesList');
    if (devices) devices.innerHTML = breakdownList(data.devices || [], 'device');
    const referrers = $('#referrersList');
    if (referrers) referrers.innerHTML = breakdownList(data.referrers || [], 'source');
    const weekly = $('#weeklyChart');
    if (weekly) weekly.innerHTML = barChart(data.weekly || []);
    const monthly = $('#monthlyChart');
    if (monthly) monthly.innerHTML = barChart(data.monthly || []);
  }

  async function loadAnalytics(days = state.analyticsDays) {
    state.analyticsDays = [7, 30, 90].includes(Number(days)) ? Number(days) : 30;
    $$('#view-analytics [data-days]').forEach((button) => {
      button.classList.toggle('active', Number(button.dataset.days) === state.analyticsDays);
    });
    try {
      const data = await RV.api.admin.analytics(state.analyticsDays);
      renderAnalytics(data);
    } catch (error) {
      handleError(error, 'Could not load analytics.');
    }
  }

  /* -------------------------------- activity ------------------------------ */

  function renderActivity(data) {
    state.activity = data;
    const live = $('#liveEvents');
    if (live) live.innerHTML = eventList(data.recent || []);
    const audit = $('#auditLog');
    if (audit) {
      audit.innerHTML = (data.audit || []).length
        ? data.audit
            .map(
              (item) => `<div class="admin-audit-item">
                <span class="admin-audit-dot"></span>
                <div>
                  <strong>${esc(humanAction(item.action))}${item.detail ? ` · ${esc(item.detail)}` : ''}</strong>
                  <span>${esc(item.owner || 'system')} · ${esc(item.entity || 'console')}${
                item.entity_id ? ` #${esc(item.entity_id)}` : ''
              }</span>
                </div>
                <time datetime="${esc(item.created_at)}">${RV.timeAgo(item.created_at)}</time>
              </div>`
            )
            .join('')
        : emptyBox('No console actions recorded yet.', 'shield');
    }
  }

  async function loadActivity() {
    try {
      const data = await RV.api.admin.activity();
      renderActivity(data);
    } catch (error) {
      handleError(error, 'Could not load activity.');
    }
  }

  /* -------------------------------- security ------------------------------ */

  function renderSecurity() {
    const owners = state.owners;
    const holder = $('#ownerCards');
    if (holder) {
      holder.innerHTML = owners.length
        ? owners
            .map(
              (owner) => `<div class="admin-owner-item">
                <span class="admin-avatar">${esc(RV.initials(owner.name))}</span>
                <div>
                  <strong>${esc(owner.name)}${owner.current ? ' (you)' : ''}</strong>
                  <span>${esc(owner.email)} · joined ${RV.date(owner.created_at)}</span>
                </div>
                <span class="badge ${owner.current ? 'badge-live' : ''}">${esc(owner.role)}</span>
              </div>`
            )
            .join('')
        : emptyBox('No owners found.', 'user');
    }
    const badge = $('#ownerCountBadge');
    if (badge) {
      badge.innerHTML = `<span class="live-dot"></span> ${owners.length} / ${state.ownerLimit || 3}`;
    }

    const sessions = state.sessions;
    const list = $('#sessionList');
    if (list) {
      list.innerHTML = sessions.length
        ? sessions
            .map(
              (session) => `<div class="admin-session">
                <span class="admin-session-icon">${icon(
                  session.device === 'Mobile' ? 'smartphone' : 'monitor'
                )}</span>
                <div class="admin-session-info">
                  <strong>${esc(session.device)} ${session.current ? '<span class="badge badge-live">Current</span>' : ''}</strong>
                  <span>Started ${RV.dateTime(session.createdAt)} · expires ${RV.dateTime(session.expiresAt)}</span>
                </div>
                ${
                  session.current
                    ? ''
                    : `<button class="btn btn-soft btn-sm" type="button" data-revoke="${session.id}">Revoke</button>`
                }
              </div>`
            )
            .join('')
        : emptyBox('No sessions found.', 'key');
    }
  }

  async function loadSecurity() {
    try {
      const [owners, sessions] = await Promise.all([RV.api.admin.owners(), RV.api.auth.sessions()]);
      state.owners = owners.owners || [];
      state.ownerLimit = owners.limit || 3;
      state.sessions = sessions.sessions || [];
      renderSecurity();
    } catch (error) {
      handleError(error, 'Could not load security details.');
    }
  }

  /* ------------------------------ drop modal ------------------------------ */

  const ICON_OPTIONS = ['steam', 'xbox', 'cookie', 'grid', 'spark', 'shield', 'bolt', 'star'];

  function colorOptions(selected) {
    return ICON_OPTIONS.map(
      (name) => `<option value="${name}" ${name === selected ? 'selected' : ''}>${name}</option>`
    ).join('');
  }

  function openDropModal(drop = null) {
    const editing = Boolean(drop);
    const categories = state.categories;
    if (!categories.length) {
      RV.toast('Create a category before adding a drop.', 'warning');
      return;
    }

    let thumbData = null;
    let removeThumb = false;
    let currentCategory = drop ? drop.category.slug : categories[0].slug;

    const categoryOptions = categories
      .map(
        (category) =>
          `<option value="${esc(category.slug)}" ${drop && drop.category.slug === category.slug ? 'selected' : ''}>${esc(
            category.name
          )}</option>`
      )
      .join('');

    const previewSrc = drop && drop.thumbnail ? RV.safeImage(drop.thumbnail) : fallbackThumb(currentCategory);

    const body = `<form class="admin-modal-form" id="dropForm" novalidate>
      <div class="admin-form-row">
        <div class="field">
          <label class="field-label" for="dropTitle">Title</label>
          <input class="input" id="dropTitle" name="title" type="text" maxlength="100" required value="${esc(
            drop ? drop.title : ''
          )}" placeholder="Neon Circuit — Free Weekend" />
        </div>
        <div class="field">
          <label class="field-label" for="dropSlug">Slug <span class="field-hint">optional</span></label>
          <input class="input" id="dropSlug" name="slug" type="text" maxlength="64" value="${esc(
            drop ? drop.slug : ''
          )}" placeholder="auto-generated" />
        </div>
      </div>

      <div class="admin-form-row">
        <div class="field">
          <label class="field-label" for="dropCategory">Category</label>
          <select class="select" id="dropCategory" name="category" required>${categoryOptions}</select>
        </div>
        <div class="field">
          <label class="field-label" for="dropStatus">Status</label>
          <select class="select" id="dropStatus" name="status">
            <option value="draft" ${!drop || drop.status === 'draft' ? 'selected' : ''}>Draft — hidden from the feed</option>
            <option value="published" ${drop && drop.status === 'published' ? 'selected' : ''}>Published — live on the site</option>
          </select>
        </div>
      </div>

      <div class="field">
        <label class="field-label" for="dropUrl">Destination URL</label>
        <input class="input" id="dropUrl" name="externalUrl" type="url" maxlength="2048" required value="${esc(
          drop ? drop.externalUrl : ''
        )}" placeholder="https://store.steampowered.com/…" />
        <span class="field-hint">Official HTTPS destination only. Credentials and private hosts are rejected.</span>
      </div>

      <div class="field">
        <label class="field-label" for="dropDescription">Description <span class="field-hint">20–1500 characters</span></label>
        <textarea class="textarea" id="dropDescription" name="description" maxlength="1500" required placeholder="What is this drop, and where does it live?">${esc(
          drop ? drop.description : ''
        )}</textarea>
      </div>

      <div class="alert alert-warn" id="cookieHint" hidden>
        ${icon('cookie')}
        <span>Cookie-category drops may only be documentation or harmless text resources. Authentication cookies, session tokens, credential dumps and account logins are rejected automatically. Use an HTTPS destination and a 40+ character description.</span>
      </div>

      <div class="admin-upload">
        <div class="admin-upload-preview"><img id="thumbPreview" src="${esc(
          previewSrc
        )}" alt="Thumbnail preview" width="96" height="60" /></div>
        <div class="admin-upload-info">
          <strong>Thumbnail</strong>
          <span>PNG, JPEG, WebP or GIF · up to 4 MB · best at 1200 × 750.</span>
          <div class="btn-row" style="margin-top:.5rem">
            <button class="btn btn-soft btn-sm" type="button" id="pickThumb">${icon('upload')} Upload image</button>
            <button class="btn btn-ghost btn-sm" type="button" id="resetThumb">Use vault art</button>
          </div>
        </div>
        <input id="thumbInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Upload thumbnail" />
      </div>

      <div class="admin-toggle-row">
        <div>
          <strong>Featured drop</strong>
          <span>Pin this drop to the homepage curator shelf and hero slot.</span>
        </div>
        <button class="switch" type="button" id="featuredToggle" role="switch" aria-checked="${
          drop && drop.featured ? 'true' : 'false'
        }" aria-label="Feature this drop"></button>
      </div>

      <div class="admin-modal-error" id="dropFormError"></div>
    </form>`;

    const footer = `<div class="admin-modal-footer">
      ${editing ? `<button class="btn btn-danger btn-sm" type="button" id="modalDelete">${icon('trash')} Delete drop</button>` : ''}
      <button class="btn btn-ghost btn-sm" type="button" data-modal-close>Cancel</button>
      <button class="btn btn-primary btn-sm" type="submit" form="dropForm" id="saveDrop">${icon(
        'check'
      )} ${editing ? 'Save changes' : 'Create drop'}</button>
    </div>`;

    const modal = RV.openModal({
      title: editing ? 'Edit drop' : 'New drop',
      subtitle: editing ? `Editing /${drop.slug}` : 'Publish a new destination to the vault.',
      size: 'modal-lg',
      body,
      footer,
      onMount(root, close) {
        const form = $('#dropForm', root);
        const categorySelect = $('#dropCategory', root);
        const cookieHint = $('#cookieHint', root);
        const featuredToggle = $('#featuredToggle', root);
        const preview = $('#thumbPreview', root);
        const fileInput = $('#thumbInput', root);
        const errorBox = $('#dropFormError', root);

        const syncHint = () => {
          cookieHint.hidden = categorySelect.value !== 'cookies';
          if (!thumbData && !reverseRemoved()) {
            preview.src = fallbackThumb(categorySelect.value);
          }
        };
        const reverseRemoved = () => removeThumb || editing;

        categorySelect.addEventListener('change', () => {
          currentCategory = categorySelect.value;
          if (!thumbData && removeThumb) preview.src = fallbackThumb(currentCategory);
          if (!thumbData && !removeThumb && !(drop && drop.thumbnail)) {
            preview.src = fallbackThumb(currentCategory);
          }
          syncHint();
        });
        syncHint();

        featuredToggle.addEventListener('click', () => {
          const next = featuredToggle.getAttribute('aria-checked') !== 'true';
          featuredToggle.setAttribute('aria-checked', next ? 'true' : 'false');
        });

        $('#pickThumb', root).addEventListener('click', () => fileInput.click());
        $('#resetThumb', root).addEventListener('click', () => {
          thumbData = null;
          removeThumb = true;
          fileInput.value = '';
          preview.src = fallbackThumb(categorySelect.value);
        });

        fileInput.addEventListener('change', () => {
          const file = fileInput.files && fileInput.files[0];
          if (!file) return;
          const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
          if (!allowed.includes(file.type)) {
            RV.toast('Use a PNG, JPEG, WebP or GIF image.', 'error');
            fileInput.value = '';
            return;
          }
          if (file.size > 4 * 1024 * 1024) {
            RV.toast('That image is larger than 4 MB. Compress it first.', 'error');
            fileInput.value = '';
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            thumbData = String(reader.result);
            removeThumb = false;
            preview.src = thumbData;
          };
          reader.onerror = () => RV.toast('Could not read that image.', 'error');
          reader.readAsDataURL(file);
        });

        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          errorBox.classList.remove('show');

          const title = $('#dropTitle', root).value.trim();
          const slugValue = $('#dropSlug', root).value.trim();
          const description = $('#dropDescription', root).value.trim();
          const externalUrl = $('#dropUrl', root).value.trim();
          const category = categorySelect.value;
          const status = $('#dropStatus', root).value;
          const featured = featuredToggle.getAttribute('aria-checked') === 'true';

          if (title.length < 3) {
            errorBox.textContent = 'Title must be at least 3 characters.';
            errorBox.classList.add('show');
            return;
          }
          if (description.length < 20) {
            errorBox.textContent = 'Description must be at least 20 characters.';
            errorBox.classList.add('show');
            return;
          }
          if (!/^https?:\/\/[^\s]+$/i.test(externalUrl)) {
            errorBox.textContent = 'Destination must be a valid http:// or https:// URL.';
            errorBox.classList.add('show');
            return;
          }
          if (category === 'cookies' && (!/^https:\/\//i.test(externalUrl) || description.length < 40)) {
            errorBox.textContent =
              'Cookie drops need an HTTPS destination and a description of at least 40 characters.';
            errorBox.classList.add('show');
            return;
          }

          const payload = {
            title,
            description,
            category,
            externalUrl,
            status,
            featured,
          };
          if (slugValue && (!drop || slugValue !== drop.slug)) payload.slug = slugValue;
          if (thumbData) payload.thumbnail = thumbData;
          if (removeThumb) payload.removeThumbnail = true;

          const save = $('#saveDrop', root);
          save.classList.add('is-loading');
          save.disabled = true;
          try {
            if (editing) {
              await RV.api.admin.updateDrop(drop.id, payload);
              RV.toast('Drop updated.', 'success');
            } else {
              await RV.api.admin.createDrop(payload);
              RV.toast(status === 'published' ? 'Drop published to the vault.' : 'Draft saved.', 'success');
            }
            close();
            await Promise.all([loadDrops(), loadOverview(), loadCategories()]);
          } catch (error) {
            save.classList.remove('is-loading');
            save.disabled = false;
            errorBox.textContent = error.message || 'Could not save this drop.';
            errorBox.classList.add('show');
            if (error.status === 401) handleError(error);
          }
        });

        const deleteBtn = $('#modalDelete', root);
        if (deleteBtn) {
          deleteBtn.addEventListener('click', async () => {
            const confirmed = await RV.confirm({
              title: 'Delete this drop?',
              message: `“${drop.title}” will be removed permanently, along with its analytics events. This cannot be undone.`,
              confirmLabel: 'Delete drop',
              danger: true,
            });
            if (!confirmed) return;
            deleteBtn.classList.add('is-loading');
            try {
              await RV.api.admin.deleteDrop(drop.id);
              RV.toast('Drop deleted.', 'success');
              close();
              await Promise.all([loadDrops(), loadOverview(), loadCategories()]);
            } catch (error) {
              deleteBtn.classList.remove('is-loading');
              RV.toast(error.message || 'Could not delete this drop.', 'error');
            }
          });
        }
      },
    });

    void modal;
  }

  /* ----------------------------- drop statistics -------------------------- */

  async function openDropStats(drop) {
    let stats;
    try {
      stats = await RV.api.admin.dropStats(drop.id);
    } catch (error) {
      handleError(error, 'Could not load drop statistics.');
      return;
    }
    const range = stats.range || {};
    const body = `<div class="admin-stat-strip">
        <div><small>Lifetime views</small><strong>${fmt(stats.views)}</strong></div>
        <div><small>Lifetime claims</small><strong>${fmt(stats.clicks)}</strong></div>
        <div><small>Views · 30d</small><strong>${fmt(range.views)}</strong></div>
        <div><small>Claims · 30d</small><strong>${fmt(range.clicks)}</strong></div>
      </div>
      <div class="admin-chart" style="margin-bottom:.8rem">${chartSvg(stats.series || [], {
        height: 180,
        label: `${stats.title} 30 day traffic`,
      })}</div>
      <h3 class="admin-mini-title">Latest events</h3>
      <div class="admin-event-list">${
        (stats.lastEvents || []).length
          ? stats.lastEvents
              .map(
                (event) => `<div class="admin-event-item">
                  <span class="admin-event-icon ${event.type}">${icon(eventIcon(event.type))}</span>
                  <div class="admin-event-body"><strong>${esc(humanAction(event.type))}</strong><span>${RV.dateTime(
                  event.created_at
                )}</span></div>
                  <time class="admin-event-time">${RV.timeAgo(event.created_at)}</time>
                </div>`
              )
              .join('')
          : emptyBox('No events for this drop yet.', 'activity')
      }</div>`;

    RV.openModal({
      title: drop.title,
      subtitle: `Drop statistics · /${drop.slug}`,
      size: 'modal-lg',
      body,
      footer: `<div class="admin-modal-footer">
        <button class="btn btn-ghost btn-sm" type="button" data-modal-close>Close</button>
        <a class="btn btn-soft btn-sm" href="/drop/${encodeURIComponent(drop.slug)}" target="_blank" rel="noopener">${icon(
          'globe'
        )} Open live page</a>
        <button class="btn btn-primary btn-sm" type="button" id="statsEdit">${icon('pencil')} Edit drop</button>
      </div>`,
      onMount(root, close) {
        $('#statsEdit', root).addEventListener('click', () => {
          close();
          openDropModal(drop);
        });
      },
    });
  }

  /* ---------------------------- category modal ---------------------------- */

  function openCategoryModal(category = null) {
    const editing = Boolean(category);
    const body = `<form class="admin-modal-form" id="categoryForm" novalidate>
      <div class="admin-form-row">
        <div class="field">
          <label class="field-label" for="catName">Name</label>
          <input class="input" id="catName" name="name" type="text" maxlength="32" required value="${esc(
            category ? category.name : ''
          )}" placeholder="NINTENDO" />
        </div>
        <div class="field">
          <label class="field-label" for="catSlug">Slug <span class="field-hint">optional</span></label>
          <input class="input" id="catSlug" name="slug" type="text" maxlength="64" value="${esc(
            category ? category.slug : ''
          )}" placeholder="auto-generated" />
        </div>
      </div>
      <div class="field">
        <label class="field-label" for="catDescription">Description</label>
        <textarea class="textarea" id="catDescription" name="description" maxlength="500" required style="min-height:110px" placeholder="What belongs in this lane?">${esc(
          category ? category.description : ''
        )}</textarea>
      </div>
      <div class="admin-form-row">
        <div class="field">
          <label class="field-label" for="catAccent">Accent colour</label>
          <div style="display:flex;gap:.5rem">
            <input type="color" id="catAccentPicker" value="${esc(
              category ? category.accent : '#8B5CF6'
            )}" style="width:52px;height:46px;border-radius:10px;border:1px solid var(--line);background:#0b0b12;padding:3px" aria-label="Pick accent colour" />
            <input class="input" id="catAccent" name="accent" type="text" maxlength="7" value="${esc(
              category ? category.accent : '#8B5CF6'
            )}" placeholder="#8B5CF6" />
          </div>
        </div>
        <div class="field">
          <label class="field-label" for="catIcon">Icon</label>
          <select class="select" id="catIcon" name="icon">${colorOptions(category ? category.icon : 'grid')}</select>
        </div>
      </div>
      <div class="admin-modal-error" id="catFormError"></div>
    </form>`;

    const footer = `<div class="admin-modal-footer">
      ${editing ? `<button class="btn btn-danger btn-sm" type="button" id="catDelete">${icon('trash')} Delete category</button>` : ''}
      <button class="btn btn-ghost btn-sm" type="button" data-modal-close>Cancel</button>
      <button class="btn btn-primary btn-sm" type="submit" form="categoryForm" id="saveCategory">${icon(
        'check'
      )} ${editing ? 'Save category' : 'Create category'}</button>
    </div>`;

    RV.openModal({
      title: editing ? 'Edit category' : 'New category',
      subtitle: 'Lanes organise the public feed and every drop belongs to one.',
      size: 'modal-lg',
      body,
      footer,
      onMount(root, close) {
        const form = $('#categoryForm', root);
        const picker = $('#catAccentPicker', root);
        const accent = $('#catAccent', root);
        const errorBox = $('#catFormError', root);

        picker.addEventListener('input', () => {
          accent.value = picker.value.toUpperCase();
        });
        accent.addEventListener('input', () => {
          if (/^#[0-9a-f]{6}$/i.test(accent.value)) picker.value = accent.value;
        });

        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          errorBox.classList.remove('show');
          const name = $('#catName', root).value.trim();
          const slug = $('#catSlug', root).value.trim();
          const description = $('#catDescription', root).value.trim();
          const accentValue = accent.value.trim().toUpperCase();
          const iconName = $('#catIcon', root).value;

          if (name.length < 2) {
            errorBox.textContent = 'Name must be at least 2 characters.';
            errorBox.classList.add('show');
            return;
          }
          if (description.length < 10) {
            errorBox.textContent = 'Description must be at least 10 characters.';
            errorBox.classList.add('show');
            return;
          }
          if (!/^#[0-9A-F]{6}$/.test(accentValue)) {
            errorBox.textContent = 'Accent must be a hex colour like #8B5CF6.';
            errorBox.classList.add('show');
            return;
          }

          const payload = { name, description, accent: accentValue, icon: iconName };
          if (slug && (!category || slug !== category.slug)) payload.slug = slug;

          const save = $('#saveCategory', root);
          save.classList.add('is-loading');
          save.disabled = true;
          try {
            if (editing) await RV.api.admin.updateCategory(category.id, payload);
            else await RV.api.admin.createCategory(payload);
            RV.toast(editing ? 'Category updated.' : 'Category created.', 'success');
            close();
            await Promise.all([loadCategories(), loadOverview()]);
          } catch (error) {
            save.classList.remove('is-loading');
            save.disabled = false;
            errorBox.textContent = error.message || 'Could not save this category.';
            errorBox.classList.add('show');
          }
        });

        const deleteBtn = $('#catDelete', root);
        if (deleteBtn) {
          deleteBtn.addEventListener('click', async () => {
            const confirmed = await RV.confirm({
              title: 'Delete this category?',
              message: `“${category.name}” can only be deleted when it has no drops. Drops in this lane must be moved or removed first.`,
              confirmLabel: 'Delete category',
              danger: true,
            });
            if (!confirmed) return;
            deleteBtn.classList.add('is-loading');
            try {
              await RV.api.admin.deleteCategory(category.id);
              RV.toast('Category deleted.', 'success');
              close();
              await Promise.all([loadCategories(), loadOverview()]);
            } catch (error) {
              deleteBtn.classList.remove('is-loading');
              RV.toast(error.message || 'Could not delete this category.', 'error');
            }
          });
        }
      },
    });
  }

  /* --------------------------------- views -------------------------------- */

  async function switchView(view) {
    if (!canView(view)) view = 'overview';
    state.view = view;
    const [title, subtitle] = VIEW_META[view];
    RV.setText('#pageTitle', title);
    RV.setText('#pageSubtitle', subtitle);
    $$('.admin-view').forEach((section) => {
      section.hidden = section.id !== `view-${view}`;
    });
    $$('.admin-nav-link').forEach((button) => {
      button.classList.toggle('active', button.dataset.view === view);
    });
    if (view === 'overview' || view === 'drops') {
      const navCount = $('#navDropCount');
      if (navCount && state.overview) navCount.textContent = fmt(state.overview.allDrops);
    }
    try {
      window.history.replaceState(null, '', `#${view}`);
    } catch {
      /* ignore */
    }

    setSync('syncing');
    if (view === 'overview') await loadOverview();
    else if (view === 'drops') await loadDrops();
    else if (view === 'categories') await loadCategories();
    else if (view === 'analytics') await loadAnalytics(state.analyticsDays);
    else if (view === 'activity') await loadActivity();
    else if (view === 'security') await loadSecurity();
    setSync('synced');
  }

  /* --------------------------------- events ------------------------------- */

  function bindEvents() {
    const openSidebar = () => {
      $('#adminSidebar').classList.add('open');
      $('#adminOverlay').hidden = false;
      $('#sidebarOpen').setAttribute('aria-expanded', 'true');
    };
    const closeSidebar = () => {
      $('#adminSidebar').classList.remove('open');
      $('#adminOverlay').hidden = true;
      const btn = $('#sidebarOpen');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    };

    document.addEventListener('click', (event) => {
      const viewBtn = event.target.closest('[data-view]');
      if (viewBtn) {
        event.preventDefault();
        switchView(viewBtn.dataset.view);
        closeSidebar();
      }
    });

    $('#sidebarOpen')?.addEventListener('click', openSidebar);
    $('#sidebarClose')?.addEventListener('click', closeSidebar);
    $('#adminOverlay')?.addEventListener('click', closeSidebar);

    $('#logoutSidebar')?.addEventListener('click', logout);

    $('#refreshBtn')?.addEventListener('click', async () => {
      setSync('syncing');
      await switchView(state.view);
      RV.toast('Console refreshed.', 'success');
    });

    $('#newDropBtn')?.addEventListener('click', () => openDropModal(null));
    $$('[data-new-drop]').forEach((button) => button.addEventListener('click', () => openDropModal(null)));
    $('#newCategoryBtn')?.addEventListener('click', () => openCategoryModal(null));

    /* drops */
    const search = $('#dropsSearch');
    if (search) {
      const run = RV.debounce(() => {
        state.drops.q = search.value.trim();
        state.drops.page = 1;
        loadDrops();
      }, 300);
      search.addEventListener('input', run);
    }
    $('#dropsStatus')?.addEventListener('change', (event) => {
      state.drops.status = event.target.value;
      state.drops.page = 1;
      loadDrops();
    });
    $('#dropsCategory')?.addEventListener('change', (event) => {
      state.drops.category = event.target.value;
      state.drops.page = 1;
      loadDrops();
    });
    $('#dropsPrev')?.addEventListener('click', () => {
      if (state.drops.page <= 1) return;
      state.drops.page -= 1;
      loadDrops();
    });
    $('#dropsNext')?.addEventListener('click', () => {
      if (state.drops.page >= state.drops.pages) return;
      state.drops.page += 1;
      loadDrops();
    });

    $('#dropsTableBody')?.addEventListener('click', async (event) => {
      const editBtn = event.target.closest('[data-drop-edit]');
      if (editBtn) {
        const drop = dropCache.get(editBtn.dataset.dropEdit);
        if (drop) openDropModal(drop);
        return;
      }
      const statsBtn = event.target.closest('[data-drop-stats]');
      if (statsBtn) {
        const drop = dropCache.get(statsBtn.dataset.dropStats);
        if (drop) openDropStats(drop);
        return;
      }
      const deleteBtn = event.target.closest('[data-drop-delete]');
      if (deleteBtn) {
        const drop = dropCache.get(deleteBtn.dataset.dropDelete);
        if (!drop) return;
        const confirmed = await RV.confirm({
          title: 'Delete this drop?',
          message: `“${drop.title}” will be removed permanently, along with its analytics events.`,
          confirmLabel: 'Delete drop',
          danger: true,
        });
        if (!confirmed) return;
        try {
          await RV.api.admin.deleteDrop(drop.id);
          RV.toast('Drop deleted.', 'success');
          state.drops.page = Math.min(state.drops.page, state.drops.pages);
          await Promise.all([loadDrops(), loadOverview(), loadCategories()]);
        } catch (error) {
          handleError(error, 'Could not delete this drop.');
        }
      }
    });

    /* categories */
    $('#categoriesGrid')?.addEventListener('click', (event) => {
      const editBtn = event.target.closest('[data-cat-edit]');
      if (editBtn) {
        const category = state.categories.find((item) => String(item.id) === editBtn.dataset.catEdit);
        if (category) openCategoryModal(category);
        return;
      }
      const deleteBtn = event.target.closest('[data-cat-delete]');
      if (deleteBtn) {
        const category = state.categories.find((item) => String(item.id) === deleteBtn.dataset.catDelete);
        if (category) openCategoryModal(category);
      }
    });

    /* analytics range */
    $$('#view-analytics [data-days]').forEach((button) => {
      button.addEventListener('click', () => loadAnalytics(Number(button.dataset.days)));
    });

    /* activity */
    $('#refreshActivity')?.addEventListener('click', loadActivity);

    /* security */
    $('#refreshSessions')?.addEventListener('click', loadSecurity);
    $('#sessionList')?.addEventListener('click', async (event) => {
      const revokeBtn = event.target.closest('[data-revoke]');
      if (!revokeBtn) return;
      const confirmed = await RV.confirm({
        title: 'Revoke this session?',
        message: 'That browser will be signed out immediately.',
        confirmLabel: 'Revoke session',
        danger: true,
      });
      if (!confirmed) return;
      try {
        const result = await RV.api.auth.revokeSession(revokeBtn.dataset.revoke);
        if (result.current) {
          window.location.replace('/admin/login');
          return;
        }
        RV.toast('Session revoked.', 'success');
        await loadSecurity();
      } catch (error) {
        handleError(error, 'Could not revoke that session.');
      }
    });

    const passwordForm = $('#passwordForm');
    passwordForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const current = $('#currentPassword').value;
      const next = $('#newPassword').value;
      const confirm = $('#confirmPassword').value;
      const errorBox = $('#passwordError');
      const showError = (message) => {
        errorBox.textContent = message;
        errorBox.hidden = false;
      };
      errorBox.hidden = true;

      if (next.length < 12) return showError('New password must be at least 12 characters.');
      if (!/[a-zA-Z]/.test(next) || !/[0-9]/.test(next)) {
        return showError('New password must include both letters and numbers.');
      }
      if (next !== confirm) return showError('New password and confirmation do not match.');
      if (next === current) return showError('Choose a password you have not used before.');

      const submit = $('#passwordSubmit');
      submit.classList.add('is-loading');
      submit.disabled = true;
      try {
        await RV.api.auth.changePassword(current, next);
        RV.toast('Password updated. Other sessions were signed out.', 'success');
        passwordForm.reset();
        await loadSecurity();
      } catch (error) {
        if (error.field === 'newPassword') showError(error.message);
        else if (error.field === 'currentPassword') showError('Current password is incorrect.');
        else showError(error.message || 'Could not update the password.');
      } finally {
        submit.classList.remove('is-loading');
        submit.disabled = false;
      }
    });
  }

  async function logout() {
    const confirmed = await RV.confirm({
      title: 'Sign out of the console?',
      message: 'Your session will be revoked on this browser.',
      confirmLabel: 'Sign out',
    });
    if (!confirmed) return;
    try {
      await RV.api.auth.logout();
    } catch {
      /* still clear the local session */
    }
    RV.api.clearCsrf();
    window.location.replace('/admin/login');
  }

  /* --------------------------------- boot --------------------------------- */

  async function boot() {
    setSync('syncing');
    let me;
    try {
      me = await RV.api.auth.me();
    } catch (error) {
      if (error.status === 401) {
        window.location.replace('/admin/login');
        return;
      }
      handleError(error, 'Could not verify your session.');
      return;
    }

    state.user = me.user;
    RV.api.setCsrf(me.csrfToken);

    const name = state.user.name || 'Owner';
    const initials = RV.initials(name);
    $('#sidebarAvatar').textContent = initials;
    $('#topAvatar').textContent = initials;
    $('#sidebarOwner').textContent = name;
    $('#sidebarEmail').textContent = state.user.email;
    $('#topOwner').textContent = name;
    $('#topRole').textContent = state.user.role || 'Owner';

    bindEvents();
    await loadCategories();

    const requested = (window.location.hash || '').replace(/^#/, '');
    const initial = canView(requested) ? requested : 'overview';
    await switchView(initial);

    if (initial !== 'overview') {
      loadOverview();
    }

    window.addEventListener('hashchange', () => {
      const next = (window.location.hash || '').replace(/^#/, '');
      if (canView(next) && next !== state.view) switchView(next);
    });

    setSync('synced');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
