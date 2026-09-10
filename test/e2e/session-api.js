// Headers for explicit API probes only. Browser-generated requests keep using
// the real application code, so this cannot hide missing frontend CSRF headers.
function sessionApi(page) {
  return Object.fromEntries(
    ['post', 'put', 'patch', 'delete'].map((method) => [
      method,
      async (url, options = {}) => {
        const headers = { ...options.headers };
        if (!headers['X-CSRF-Token']) {
          const response = await page.request.get('/api/auth/csrf');
          const payload = await response.json();
          if (payload.csrfToken) headers['X-CSRF-Token'] = payload.csrfToken;
        }
        if (
          method === 'put' &&
          /^\/api\/lists\/[^/?]+$/.test(url) &&
          !headers['If-Match']
        ) {
          const current = await page.request.get(url);
          const revision = current.headers()['x-list-revision'];
          if (revision !== undefined) headers['If-Match'] = `"${revision}"`;
        }
        return page.request[method](url, { ...options, headers });
      },
    ])
  );
}

module.exports = { sessionApi };
