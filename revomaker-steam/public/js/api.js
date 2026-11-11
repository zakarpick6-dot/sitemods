/* REVOMAKER STEAM — API client */
(function () {
  'use strict';

  const RV = (window.RV = window.RV || {});

  class ApiError extends Error {
    constructor(status, message, code, field, retryAfter) {
      super(message || 'Request failed.');
      this.name = 'ApiError';
      this.status = status;
      this.code = code || 'error';
      this.field = field || null;
      this.retryAfter = retryAfter || null;
    }
  }

  let csrfToken = null;

  function setCsrf(token) {
    csrfToken = typeof token === 'string' && token ? token : null;
  }

  function clearCsrf() {
    csrfToken = null;
  }

  async function request(path, options = {}) {
    const { method = 'GET', body, headers = {}, timeout = 20000 } = options;
    const init = {
      method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...headers },
    };

    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    if (method !== 'GET' && method !== 'HEAD' && csrfToken) {
      init.headers['X-CSRF-Token'] = csrfToken;
    }

    let controller = null;
    let timer = null;
    if (typeof AbortController !== 'undefined') {
      controller = new AbortController();
      init.signal = controller.signal;
      timer = setTimeout(() => controller.abort(), timeout);
    }

    let response;
    try {
      response = await fetch(path, init);
    } catch (error) {
      const aborted = error && error.name === 'AbortError';
      throw new ApiError(
        0,
        aborted ? 'The request timed out. Check your connection and try again.' : 'Network error. Check your connection and try again.',
        aborted ? 'timeout' : 'network'
      );
    } finally {
      if (timer) clearTimeout(timer);
    }

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    if (!response.ok) {
      const detail = data && data.error ? data.error : {};
      throw new ApiError(
        response.status,
        detail.message || `Request failed (${response.status}).`,
        detail.code,
        detail.field,
        detail.retryAfter
      );
    }

    return data;
  }

  function query(params) {
    const search = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      search.set(key, String(value));
    });
    const text = search.toString();
    return text ? `?${text}` : '';
  }

  const api = {
    request,
    get: (path) => request(path),
    post: (path, body) => request(path, { method: 'POST', body }),
    patch: (path, body) => request(path, { method: 'PATCH', body }),
    delete: (path, body) => request(path, { method: 'DELETE', body }),
    setCsrf,
    clearCsrf,
    get csrf() {
      return csrfToken;
    },

    /* ---------------------------- public ---------------------------- */
    stats: () => request('/api/stats/overview'),
    categories: () => request('/api/categories'),
    drops: (params) => request(`/api/drops${query(params)}`),
    drop: (slug) => request(`/api/drops/${encodeURIComponent(slug)}`),
    popular: (limit = 5) => request(`/api/popular?limit=${Number(limit) || 5}`),
    activity: (days = 14) => request(`/api/activity?days=${Number(days) || 14}`),
    health: () => request('/api/health'),
    setupStatus: () => request('/api/setup-status'),

    track: {
      visit: (path) => request('/api/visit', { method: 'POST', body: { path: path || location.pathname } }),
      view: (slug) => request(`/api/drops/${encodeURIComponent(slug)}/view`, { method: 'POST', body: {} }),
      click: (slug) => request(`/api/drops/${encodeURIComponent(slug)}/click`, { method: 'POST', body: {} }),
    },

    /* ----------------------------- auth ----------------------------- */
    auth: {
      async login(email, password) {
        const data = await request('/api/auth/login', { method: 'POST', body: { email, password } });
        setCsrf(data.csrfToken);
        return data;
      },
      me: () => request('/api/auth/me'),
      logout: () => request('/api/auth/logout', { method: 'POST', body: {} }),
      async changePassword(currentPassword, newPassword) {
        return request('/api/auth/password', {
          method: 'POST',
          body: { currentPassword, newPassword },
        });
      },
      sessions: () => request('/api/auth/sessions'),
      revokeSession: (id) => request(`/api/auth/sessions/${Number(id)}`, { method: 'DELETE' }),
    },

    /* ----------------------------- admin ---------------------------- */
    admin: {
      overview: () => request('/api/admin/overview'),
      analytics: (days = 30) => request(`/api/admin/analytics?days=${Number(days) || 30}`),
      drops: (params) => request(`/api/admin/drops${query(params)}`),
      drop: (id) => request(`/api/admin/drops/${Number(id)}`),
      dropStats: (id) => request(`/api/admin/drops/${Number(id)}/stats`),
      createDrop: (payload) => request('/api/admin/drops', { method: 'POST', body: payload }),
      updateDrop: (id, payload) => request(`/api/admin/drops/${Number(id)}`, { method: 'PATCH', body: payload }),
      deleteDrop: (id) => request(`/api/admin/drops/${Number(id)}`, { method: 'DELETE' }),
      categories: () => request('/api/admin/categories'),
      createCategory: (payload) => request('/api/admin/categories', { method: 'POST', body: payload }),
      updateCategory: (id, payload) =>
        request(`/api/admin/categories/${Number(id)}`, { method: 'PATCH', body: payload }),
      deleteCategory: (id) => request(`/api/admin/categories/${Number(id)}`, { method: 'DELETE' }),
      activity: () => request('/api/admin/activity'),
      owners: () => request('/api/admin/owners'),
    },
  };

  RV.ApiError = ApiError;
  RV.api = api;
})();
