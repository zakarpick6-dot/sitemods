/* REVOMAKER STEAM — homepage */
(function () {
  'use strict';

  const RV = window.RV;
  if (!RV) return;

  const { $, esc, icon } = RV;

  const state = {
    q: '',
    category: '',
    page: 1,
    limit: 9,
    total: 0,
    loading: false,
    featured: [],
    latest: [],
  };

  /* --------------------------------- stats -------------------------------- */

  function renderStats(overview) {
    RV.$$('[data-counter], [data-stat]').forEach((node) => {
      const key = node.getAttribute('data-counter') || node.getAttribute('data-stat');
      const value = overview[
        { drops: 'totalDrops', views: 'totalViews', clicks: 'totalClicks', visitors: 'totalVisitors' }[key]
      ];
      if (value !== undefined) RV.countUp(node, value, { format: RV.number, duration: 1500 });
    });

    const heroDrops = $('[data-hero-drops]');
    if (heroDrops) heroDrops.textContent = RV.number(overview.totalDrops);
    const floatViews = $('[data-float-views]');
    if (floatViews) floatViews.textContent = RV.compact(overview.totalViews);

    RV.setText(
      '#statDropsFoot',
      `${RV.number(overview.totalCategories)} lanes · ${RV.number(state.featured.length)} featured`
    );
    RV.setText('#statViewsFoot', `${RV.number(overview.views)} views in the last 7 days`);
    RV.setText('#statClicksFoot', `${RV.number(overview.clicks)} claims in the last 7 days`);
    RV.setText('#statVisitorsFoot', `${RV.number(overview.visits)} visits this week`);

    const viewsSpark = $('#viewsSpark');
    if (viewsSpark) viewsSpark.innerHTML = RV.sparkline(overview.series, 'views', '#38bdf8');
    const clicksSpark = $('#clicksSpark');
    if (clicksSpark) clicksSpark.innerHTML = RV.sparkline(overview.series, 'clicks', '#8b5cf6');
  }

  /* ---------------------------------- hero -------------------------------- */

  function renderHero(drop) {
    if (!drop) return;
    const image = $('#heroDropImage');
    const title = $('#heroDropTitle');
    const category = $('#heroDropCategory');
    const views = $('#heroDropViews');
    const link = $('#heroDropLink');

    if (image) {
      image.src = RV.safeImage(drop.thumbnail);
      image.alt = `${drop.title} key art`;
    }
    if (title) title.textContent = drop.title;
    if (category) category.textContent = drop.category?.name || 'DROP';
    if (views) views.textContent = RV.number(drop.views);
    if (link) {
      link.href = `/go/${encodeURIComponent(drop.slug)}`;
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      link.setAttribute('data-get-drop', '');
      link.setAttribute('data-slug', drop.slug);
      link.setAttribute('data-title', drop.title);
      link.innerHTML = `GET DROP ${icon('arrow-up-right')}`;
    }

    const featured = $('#heroDrop');
    if (featured && drop.category?.accent && /^#[0-9a-f]{6}$/i.test(drop.category.accent)) {
      featured.style.setProperty('--accent', drop.category.accent);
    }
  }

  /* -------------------------------- sections ------------------------------ */

  function renderFeatured() {
    const grid = $('#featuredGrid');
    if (!grid) return;
    const picks = state.featured.slice(0, 3);
    if (picks.length < 3) {
      for (const drop of state.latest) {
        if (picks.length >= 3) break;
        if (!picks.some((item) => item.id === drop.id)) picks.push(drop);
      }
    }
    if (!picks.length) {
      grid.innerHTML = RV.emptyState('No featured drops yet', 'The owners have not pinned a drop to this shelf yet.', 'sparkles');
      return;
    }
    grid.innerHTML = picks.map((drop) => RV.featureCard(drop)).join('');
    RV.observeReveals(grid);
  }

  function categoryArt(slug) {
    const known = ['steam', 'xbox', 'cookies', 'other'];
    return `/assets/categories/${known.includes(slug) ? slug : 'other'}.svg`;
  }

  function renderCategories(categories) {
    const grid = $('#categoryGrid');
    if (!grid) return;
    if (!categories.length) {
      grid.innerHTML = RV.emptyState('No categories', 'Categories will appear once the owners create them.');
      return;
    }
    grid.innerHTML = categories
      .map(
        (category) => `<a class="category-tile reveal" href="/category/${encodeURIComponent(
          category.slug
        )}" style="--accent:${/^#[0-9a-f]{6}$/i.test(category.accent) ? category.accent : '#8b5cf6'}">
          <img src="${esc(categoryArt(category.slug))}" alt="" loading="lazy" width="800" height="400" />
          <div class="category-top">
            <span class="category-icon">${icon(RV.categoryIcon(category.icon))}</span>
            <span class="category-count">${RV.number(category.drops)} DROPS</span>
          </div>
          <div>
            <h3 class="category-name">${esc(category.name)}</h3>
            <p class="category-blurb">${esc(category.description)}</p>
            <span class="category-link">Explore lane ${icon('arrow-right')}</span>
          </div>
        </a>`
      )
      .join('');
    RV.observeReveals(grid);
  }

  function renderPopular(drops) {
    const panel = $('#popularList');
    if (!panel) return;
    if (!drops.length) {
      panel.innerHTML = RV.emptyState('No claims yet', 'Popular drops will appear here as visitors start claiming.', 'flame');
      return;
    }
    const max = Math.max(...drops.map((drop) => Number(drop.views) || 0), 1);
    panel.innerHTML = drops
      .map((drop, index) => {
        const accent = /^#[0-9a-f]{6}$/i.test(drop.category_accent || '') ? drop.category_accent : '#8b5cf6';
        const pct = Math.max(6, Math.round((Number(drop.views) / max) * 100));
        return `<div class="popular-row" style="--accent:${accent}">
          <div class="popular-rank">${String(index + 1).padStart(2, '0')}</div>
          <a class="popular-thumb" href="/drop/${encodeURIComponent(drop.slug)}" aria-label="Open ${esc(drop.title)}">
            <img src="${esc(RV.safeImage(drop.thumbnail))}" alt="" loading="lazy" width="84" height="53" />
          </a>
          <div>
            <a class="popular-title" href="/drop/${encodeURIComponent(drop.slug)}">${esc(drop.title)}</a>
            <div class="popular-sub"><span class="dot"></span><span>${esc(drop.category)}</span><span class="dot"></span><span>${RV.date(drop.published_at)}</span></div>
            <div class="popular-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
          </div>
          <div class="popular-metrics">
            <span class="popular-metric-row">${icon('eye')} ${RV.number(drop.views)} views</span>
            <span class="popular-metric-row">${icon('download')} ${RV.number(drop.clicks)} claims</span>
          </div>
          <div class="popular-action">
            <a class="btn btn-soft btn-sm" href="/go/${encodeURIComponent(drop.slug)}" target="_blank" rel="noopener noreferrer"
               data-get-drop data-slug="${encodeURIComponent(drop.slug)}" data-title="${esc(drop.title)}">
              GET DROP ${icon('arrow-up-right')}
            </a>
          </div>
        </div>`;
      })
      .join('');
  }

  /* ------------------------------ latest feed ----------------------------- */

  function feedSkeleton(count = 3) {
    return Array.from({ length: count }, () => '<div class="sk sk-card"></div>').join('');
  }

  function renderFeed(drops, { append = false } = {}) {
    const grid = $('#latestGrid');
    const more = $('#loadMore');
    if (!grid) return;

    if (!append) grid.innerHTML = '';
    if (!drops.length && !append) {
      grid.innerHTML = RV.emptyState(
        'No drops found',
        state.q || state.category
          ? 'Nothing matched that filter. Try a different phrase or lane.'
          : 'The vault is empty. The owners are preparing the first drop.'
      );
    } else {
      if (!append) grid.innerHTML = drops.map((drop) => RV.dropCard(drop)).join('');
      else grid.insertAdjacentHTML('beforeend', drops.map((drop) => RV.dropCard(drop)).join(''));
    }

    grid.setAttribute('aria-busy', 'false');
    RV.setText('#feedCount', RV.number(state.total));

    if (more) {
      const shown = grid.querySelectorAll('.drop-card').length;
      more.hidden = shown >= state.total;
      more.disabled = false;
      more.classList.remove('is-loading');
    }
    RV.observeReveals(grid);
  }

  function setFeedLoading() {
    const grid = $('#latestGrid');
    if (grid) grid.setAttribute('aria-busy', 'true');
    const more = $('#loadMore');
    if (more) {
      more.disabled = true;
      more.classList.add('is-loading');
    }
  }

  async function loadFeed({ append = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    if (!append) setFeedLoading();

    try {
      const data = await RV.api.drops({
        limit: state.limit,
        page: state.page,
        q: state.q || undefined,
        category: state.category || undefined,
        sort: 'latest',
      });
      state.total = data.total;
      if (!append) {
        state.latest = data.drops;
      }
      renderFeed(data.drops, { append });
      if (append) state.latest = state.latest.concat(data.drops);
    } catch (error) {
      const grid = $('#latestGrid');
      if (grid) {
        grid.setAttribute('aria-busy', 'false');
        grid.innerHTML = `<div class="empty-state error-state">${icon('alert')}<h3>Could not load the feed</h3><p>${esc(
          error.message
        )}</p><button class="btn btn-soft btn-sm" type="button" id="retryFeed">Try again</button></div>`;
        $('#retryFeed')?.addEventListener('click', () => loadFeed());
      }
    } finally {
      state.loading = false;
    }
  }

  function initFeed() {
    const search = $('#feedSearch');
    if (search) {
      const onSearch = RV.debounce(() => {
        state.q = search.value.trim();
        state.page = 1;
        loadFeed();
      }, 320);
      search.addEventListener('input', onSearch);
      search.addEventListener('search', () => {
        onSearch.cancel();
        state.q = search.value.trim();
        state.page = 1;
        loadFeed();
      });
    }

    const filters = $('#feedFilters');
    if (filters) {
      filters.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-category]');
        if (!button) return;
        RV.$$('button', filters).forEach((node) => node.classList.toggle('active', node === button));
        state.category = button.getAttribute('data-category') || '';
        state.page = 1;
        loadFeed();
      });
    }

    const more = $('#loadMore');
    if (more) {
      more.addEventListener('click', () => {
        state.page += 1;
        loadFeed({ append: true });
      });
    }
  }

  /* --------------------------------- boot --------------------------------- */

  async function boot() {
    initFeed();

    const overviewTask = RV.api.stats();
    const categoriesTask = RV.api.categories();
    const featuredTask = RV.api.drops({ featured: 1, limit: 3, sort: 'latest' });
    const popularTask = RV.api.popular(5);

    const [overview, categories, featured] = await Promise.allSettled([
      overviewTask,
      categoriesTask,
      featuredTask,
      popularTask,
    ]).then((results) => results);

    if (featured.status === 'fulfilled' && featured.value) {
      state.featured = featured.value.drops || [];
    }

    if (overview.status === 'fulfilled' && overview.value) {
      renderStats(overview.value);
    }

    if (categories.status === 'fulfilled' && categories.value) {
      renderCategories(categories.value.categories || []);
    }

    if (popularTask) {
      popularTask
        .then((data) => renderPopular(data.drops || []))
        .catch(() => renderPopular([]));
    }

    await loadFeed();
    renderFeatured();

    if (state.latest.length) {
      const heroPick =
        state.featured.find((drop) => drop.featured) || state.latest.find((drop) => drop.featured) || state.latest[0];
      renderHero(heroPick);
    }

    // Keep the numbers honest without a full reload.
    setInterval(() => {
      RV.api
        .stats()
        .then((next) => {
          if (!next) return;
          RV.setText('[data-counter="drops"]', RV.number(next.totalDrops));
          RV.setText('[data-counter="views"]', RV.number(next.totalViews));
          RV.setText('[data-counter="clicks"]', RV.number(next.totalClicks));
          RV.setText('[data-counter="visitors"]', RV.number(next.totalVisitors));
          RV.setText('#statVisitorsFoot', `${RV.number(next.visits)} visits this week`);
        })
        .catch(() => {});
    }, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
