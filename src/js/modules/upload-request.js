// Fetch still has no interoperable upload-progress events. Adapt XHR to the
// response interface used by the API client so auth/CSRF/error policy stays there.
export function requestWithUploadProgress(
  url,
  options,
  createXHR = () => new window.XMLHttpRequest()
) {
  return new Promise((resolve, reject) => {
    const xhr = createXHR();
    const { signal, onUploadProgress } = options;
    const abortError = () => new DOMException('Upload aborted', 'AbortError');
    const abort = () => xhr.abort();
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const fail = (error) => {
      cleanup();
      reject(error);
    };

    if (signal?.aborted) {
      reject(signal.reason || abortError());
      return;
    }

    // Register before open/send for consistent browser upload-event support.
    xhr.upload.onprogress = (event) =>
      onUploadProgress({
        loaded: event.loaded,
        total: event.lengthComputable ? event.total : 0,
        complete: false,
      });
    xhr.upload.onload = () => onUploadProgress({ complete: true });
    xhr.onerror = () =>
      fail(
        new TypeError(
          'Upload connection interrupted. Check restore status before retrying.'
        )
      );
    xhr.onabort = () => fail(signal?.reason || abortError());
    xhr.ontimeout = () =>
      fail(
        new Error('Upload timed out. Check restore status before retrying.')
      );
    xhr.onload = () => {
      cleanup();
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        url: xhr.responseURL,
        redirected:
          !!xhr.responseURL &&
          new URL(url, xhr.responseURL).href !== xhr.responseURL,
        headers: { get: (name) => xhr.getResponseHeader(name) },
        json: async () => JSON.parse(xhr.responseText),
      });
    };

    try {
      xhr.open(options.method || 'POST', url);
      // XHR sends same-origin cookies by default; never opt into cross-origin cookies.
      for (const [name, value] of Object.entries(options.headers || {})) {
        xhr.setRequestHeader(name, value);
      }
      signal?.addEventListener('abort', abort, { once: true });
      onUploadProgress({ loaded: 0, total: 0, complete: false });
      xhr.send(options.body);
    } catch (error) {
      fail(error);
    }
  });
}
