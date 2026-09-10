export function csrfHeaders(token = globalThis.window?.csrfToken) {
  return typeof token === 'string' && token ? { 'X-CSRF-Token': token } : {};
}
