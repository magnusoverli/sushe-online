const { createBoundedFetch } = require('../utils/bounded-fetch');
const { Response } = globalThis;
const {
  publicRequest: defaultPublicRequest,
} = require('../utils/public-request');
const { shutdownSignal, callerSignal } = require('../utils/outbound-lifecycle');

/** @param {{fetch?: Function, publicRequest?: Function}} [deps] */
function createCoverTransport({
  fetch,
  publicRequest = defaultPublicRequest,
} = {}) {
  const jsonFetch = createBoundedFetch({ fetch, timeoutMs: 5000 });
  return async (url, options = {}) => {
    const target = new URL(url);
    if (
      (target.origin === 'https://itunes.apple.com' &&
        target.pathname === '/search') ||
      (target.origin === 'https://api.deezer.com' &&
        target.pathname === '/search/album')
    )
      return jsonFetch(url, options);
    const result = await publicRequest(url, {
      timeoutMs: 5000,
      maxBytes: 8 * 1024 * 1024,
      contentTypes: ['image/'],
      signal: AbortSignal.any([
        shutdownSignal,
        ...[options.signal, callerSignal()].filter(Boolean),
      ]),
    });
    return new Response(result.buffer, {
      headers: { 'content-type': result.contentType },
    });
  };
}
module.exports = { createCoverTransport };
