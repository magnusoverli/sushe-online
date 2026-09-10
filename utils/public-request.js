const http = require('node:http');
const https = require('node:https');
const { lookup: defaultLookup } = require('node:dns/promises');
const { isIP } = require('node:net');
const { isPublicAddress, normalizeHostname } = require('./public-address');
const { validateUnfurlTarget } = require('./unfurl-url');

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 5;

function waitWithSignal(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

function createPublicRequest({ lookup = defaultLookup, request = null } = {}) {
  return async function publicRequest(rawUrl, options = {}) {
    const {
      timeoutMs = DEFAULT_TIMEOUT_MS,
      maxBytes = DEFAULT_MAX_BYTES,
      allowedHosts,
      contentTypes,
    } = options;
    const timeout = globalThis.AbortSignal.timeout(timeoutMs);
    const signal = options.signal
      ? globalThis.AbortSignal.any([timeout, options.signal])
      : timeout;
    let url = rawUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      signal.throwIfAborted();
      const validation = validateUnfurlTarget(url);
      if (!validation.valid) throw new Error(validation.error);
      const target = new URL(validation.url);
      const host = normalizeHostname(target.hostname);
      if (
        allowedHosts &&
        !allowedHosts.some(
          (allowed) => host === allowed || host.endsWith(`.${allowed}`)
        )
      ) {
        throw new Error('URL host not allowed');
      }
      // User-controlled requests are restricted to standard HTTP(S) ports.
      if (
        target.port &&
        target.port !== (target.protocol === 'https:' ? '443' : '80')
      ) {
        throw new Error('URL port not allowed');
      }
      const addresses = isIP(host)
        ? [{ address: host, family: isIP(host) }]
        : await waitWithSignal(
            lookup(host, { all: true, verbatim: true }),
            signal
          );
      if (
        !addresses.length ||
        addresses.some(({ address }) => !isPublicAddress(address))
      ) {
        throw new Error('URL resolves to a non-public address');
      }
      const selected = addresses[0];
      const result = await new Promise((resolve, reject) => {
        const send =
          request ||
          (target.protocol === 'https:' ? https.request : http.request);
        const req = send(
          target,
          {
            method: 'GET',
            agent: false,
            signal,
            headers: { ...options.headers, 'Accept-Encoding': 'identity' },
            // Preserve the original Host/SNI while pinning the validated IP.
            lookup: (_hostname, lookupOptions, callback) => {
              if (lookupOptions.all) callback(null, [selected]);
              else callback(null, selected.address, selected.family);
            },
          },
          (res) => {
            const status = res.statusCode || 502;
            if (REDIRECTS.has(status)) {
              const location = res.headers.location;
              res.destroy();
              if (!location)
                return reject(new Error('Redirect has no location'));
              resolve({ location: new URL(location, target).href });
              return;
            }
            const type = String(
              res.headers['content-type'] || ''
            ).toLowerCase();
            const encoding = res.headers['content-encoding'];
            if (
              status < 200 ||
              status >= 300 ||
              (encoding && encoding !== 'identity') ||
              (contentTypes &&
                !contentTypes.some((prefix) => type.startsWith(prefix)))
            ) {
              res.destroy();
              reject(new Error('Target returned an unsupported response'));
              return;
            }
            const chunks = [];
            let size = 0;
            res.on('error', reject);
            res.on('aborted', () =>
              reject(new Error('Target response was interrupted'))
            );
            res.on('data', (chunk) => {
              size += chunk.length;
              if (size > maxBytes) {
                res.destroy(new Error('Target response exceeds size limit'));
                return;
              }
              chunks.push(chunk);
            });
            res.on('end', () =>
              resolve({ buffer: Buffer.concat(chunks), contentType: type })
            );
          }
        );
        req.on('error', reject);
        req.end();
      });
      if (!result.location) return result;
      url = result.location;
    }
    throw new Error('Too many redirects');
  };
}

module.exports = { createPublicRequest, publicRequest: createPublicRequest() };
