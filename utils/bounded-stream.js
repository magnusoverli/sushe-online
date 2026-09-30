const { Response, ReadableStream } = globalThis;

// Keep the transport deadline alive until EOF/cancel, while allowing SDK event
// streams to deliver progress. Count decoded bytes before the SDK accumulates them.
/** @param {Response} response @param {number} maxBytes
 * @param {AbortSignal} signal @param {() => void} cleanup */
function boundedStreamResponse(response, maxBytes, signal, cleanup) {
  if (!response.body) throw new Error('Streaming response has no body');
  const reader = response.body.getReader();
  let bytes = 0;
  let ended = false;
  let abort = () => {};
  const finish = () => {
    if (ended) return;
    ended = true;
    signal.removeEventListener('abort', abort);
    cleanup();
  };
  const body = new ReadableStream({
    start(controller) {
      abort = () => {
        if (ended) return;
        reader.cancel(signal.reason).catch(() => {});
        controller.error(signal.reason);
        finish();
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (ended) return;
        if (done) {
          controller.close();
          finish();
          reader.releaseLock();
          return;
        }
        bytes += value.byteLength;
        if (bytes > maxBytes)
          throw Object.assign(
            new Error('Provider response exceeds size limit'),
            { code: 'RESPONSE_TOO_LARGE' }
          );
        controller.enqueue(value);
      } catch (error) {
        if (ended) return;
        reader.cancel(error).catch(() => {});
        controller.error(error);
        finish();
      }
    },
    cancel(reason) {
      finish();
      return reader.cancel(reason);
    },
  });
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  headers.delete('transfer-encoding');
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

module.exports = { boundedStreamResponse };
