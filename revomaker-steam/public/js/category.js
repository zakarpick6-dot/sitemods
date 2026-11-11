/* REVOMAKER STEAM — category feed */
(function () {
  'use strict';

  const RV = window.RV;
  if (!RV) return;

  const { $, $$, esc, icon } = RV;

  const slug = decodeURIComponent((window.location.pathname.match(/^\/category\/([a-z0-9-]+)/i) || [])[1] || '');
  const params = new URLSearchParams(window.location.search);

  const state = {
    q: params.get('q') || '',
    sort: params.get('sort') || 'latest',
    page: 1,
    limit: 9,
    total: 0,
    loading: false,
    category: null,
    categories: [],
  };

  const ART = (categorySlug) =>
    `/assets/categories/${['steam', 'xbox', 'cookies', 'other'].includes(categorySlug) ? categorySlug : 'other'}.svg`;

  function syncUrl() {
    const next = new URLSearchParams();
    if (state.q) next.set('q', state.q);
    if (state.sort !== 'latest') next.set('sort', state.sort);
    const text = next.toString();
    try {
      window.history.replaceState(null, '', `${window.location.pathname}${text ? `?${text}` : ''}`);
    } catch {
      /* ignore */
    }
  }

  function renderHeader() {
    const category = state.category;
    if (!category) return;
    const accent = /^#[0-9a-f]{6}$/i.test(category.accent || '') ? category.accent : '#8b5cf6';

    document.title = `${category.name} Drops — REVOMAKER STEAM`;

    const hero = $('#catHero');
    if (hero) hero.style.setProperty('--accent', accent);
    const art = $('#catArt');
    if (art) {
      art.src = ART(category.slug);
      art.alt = `${category.name} category artwork`;
    }
    const iconNode = $('#catIcon');
    if (iconNode) iconNode.innerHTML = icon(RV.categoryIcon(category.icon));
    const title = $('#catTitle');
    if (title) title.textContent = `${category.name} drops`;
    const desc = $('#catDesc');
    if (desc) desc.textContent = category.description;
    const crumb = $('#crumbCategory');
    if (crumb) crumb.textContent = category.name;

    const meta = $$('#catMeta .cat-meta-item strong');
    if (meta[0]) meta[0].textContent = RV.number(category.drops);
    if (meta[1]) meta[1].textContent = RV.number(category.views);
    if (meta[2]) meta[2].textContent = RV.number(category.clicks);

    const badge = $('#catBadge');
    if (badge) badge.innerHTML = `<span class="live-dot" aria-hidden="true"></span> ${RV.number(category.drops)} live drops`;

    if (state.q) {
      const search = $('#catSearch');
      if (search) search.value = state.q;
    }
    const sort = $('#catSort');
    if (sort) sort.value = ['latest', 'popular', 'clicks', 'az'].includes(state.sort) ? state.sort : 'latest';

    $$('.nav-link').forEach((link) => {
      if ((link.getAttribute('href') || '') === `/category/${category.slug}`) link.classList.add('active');
    });
  }

  function renderGrid(drops, { append = false } = {}) {
    const grid = $('#catGrid');
    const more = $('#catLoadMore');
    if (!grid) return;

    if (!append) grid.innerHTML = '';
    if (!drops.length && !append) {
      grid.innerHTML = RV.emptyState(
        'No drops in this lane yet',
        state.q ? 'No drops matched that search. Try a shorter phrase.' : 'The owners are preparing the next drop for this category.',
        'layers'
      );
    } else if (!append) {
      grid.innerHTML = drops.map((drop) => RV.dropCard(drop)).join('');
    } else {
      grid.insertAdjacentHTML('beforeend', drops.map((drop) => RV.dropCard(drop)).join(''));
    }

    grid.setAttribute('aria-busy', 'false');
    RV.setText('#catCount', RV.number(state.total));
    if (more) {
      more.hidden = grid.querySelectorAll('.drop-card').length >= state.total;
      more.disabled = false;
      more.classList.remove('is-loading');
    }
    RV.observeReveals(grid);
  }

  async function loadDrops({ append = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    const grid = $('#catGrid');
    const more = $('#catLoadMore');
    if (!append) {
      if (grid) grid.setAttribute('aria-busy', 'true');
      if (more) {
        more.disabled = true;
        more.classList.add('is-loading');
      }
    }

    try {
      const data = await RV.api.drops({
        category: state.category ? state.category.slug : slug,
        q: state.q || undefined,
        sort: state.sort,
        page: state.page,
        limit: state.limit,
      });
      state.total = data.total;
      renderGrid(data.drops, { append });
    } catch (error) {
      if (grid) {
        grid.setAttribute('aria-busy', 'false');
        grid.innerHTML = `<div class="empty-state error-state">${icon('alert')}<h3>Could not load this lane</h3><p>${esc(
          error.message
        )}</p><button class="btn btn-soft btn-sm" type="button" id="retryCat">Try again</button></div>`;
        $('#retryCat')?.addEventListener('click', () => loadDrops());
      }
    } finally {
      state.loading = false;
    }
  }

  function renderOtherCategories() {
    const holder = $('#otherCats');
    if (!holder) return;
    const others = state.categories.filter((category) => category.slug !== slug);
    if (!others.length) {
      holder.innerHTML = RV.emptyState('One lane only', 'More categories will appear here as the vault grows.', 'grid');
      return;
    }
    holder.innerHTML = others
      .map(
        (category) => `<a class="other-cat reveal" href="/category/${encodeURIComponent(category.slug)}"
          style="--accent:${/^#[0-9a-f]{6}$/i.test(category.accent) ? category.accent : '#8b5cf6'}">
          <div class="other-cat-left">
            ${icon(RV.categoryIcon(category.icon))}
            <div><strong>${esc(category.name)}</strong><span>${RV.number(category.drops)} drops · ${RV.compact(
          category.views
        )} views</span></div>
          </div>
          ${icon('arrow-up-right')}
        </a>`
      )
      .join('');
    RV.observeReveals(holder);
  }

  function initEvents() {
    const search = $('#catSearch');
    if (search) {
      const run = RV.debounce(() => {
        state.q = search.value.trim();
        state.page = 1;
        syncUrl();
        loadDrops();
      }, 320);
      search.addEventListener('input', run);
      search.addEventListener('search', () => {
        run.cancel();
        state.q = search.value.trim();
        state.page = 1;
        syncUrl();
        loadDrops();
      });
    }

    const sort = $('#catSort');
    if (sort) {
      sort.addEventListener('change', () => {
        state.sort = sort.value;
        state.page = 1;
        syncUrl();
        loadDrops();
      });
    }

    const more = $('#catLoadMore');
    if (more) {
      more.addEventListener('click', () => {
        state.page += 1;
        loadDrops({ append: true });
      });
    }
  }

  async function boot() {
    initEvents();
    try {
      const data = await RV.api.categories();
      state.categories = data.categories || [];
      state.category = state.categories.find((category) => category.slug === slug) || null;
      if (!state.category) {
        const grid = $('#catGrid');
        if (grid) {
          grid.setAttribute('aria-busy', 'false');
          grid.innerHTML = RV.emptyState('Category not found', 'That lane does not exist. Head back to the vault.', 'search');
        }
        return;
      }
      renderHeader();
      renderOtherCategories();
      await loadDrops();
    } catch (error) {
      const grid = $('#catGrid');
      if (grid) {
        grid.setAttribute('aria-busy', 'false');
        grid.innerHTML = RV.emptyState('Could not load this category', error.message, 'alert');
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
