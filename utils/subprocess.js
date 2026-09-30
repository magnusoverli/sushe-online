const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');

function processError(code) {
  return Object.assign(new Error(`Subprocess failed (${code})`), { code });
}

// No shell, no unbounded capture, and settlement waits for stdio closure.
/**
 * @param {string} command
 * @param {string[]} args
 * @param {{env?: NodeJS.ProcessEnv, signal?: AbortSignal, output?: import('node:stream').Writable,
 * maxOutputBytes?: number, timeoutMs?: number, killGraceMs?: number, diagnosticBytes?: number, spawnFn?: typeof spawn}} [options]
 */
async function runProcess(
  command,
  args,
  {
    env = process.env,
    signal,
    output,
    maxOutputBytes = Infinity,
    timeoutMs = 600000,
    killGraceMs = 1000,
    diagnosticBytes = 8192,
    spawnFn = spawn,
  } = {}
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error('A subprocess deadline is required');
  if (signal?.aborted) throw processError('SUBPROCESS_ABORTED');
  const startedAt = Date.now();
  let child;
  try {
    child = spawnFn(command, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
  } catch {
    throw processError('SUBPROCESS_SPAWN');
  }
  let failure;
  let escalation;
  let closed = false;
  let bytes = 0;
  let diagnostic = Buffer.alloc(0);
  const stop = (code) => {
    failure ||= processError(code);
    if (closed || escalation) return;
    child.kill('SIGTERM');
    escalation = setTimeout(() => {
      if (!closed) child.kill('SIGKILL');
    }, killGraceMs);
  };
  const onAbort = () => stop('SUBPROCESS_ABORTED');
  const timer = setTimeout(() => stop('SUBPROCESS_TIMEOUT'), timeoutMs);
  signal?.addEventListener('abort', onAbort, { once: true });
  const onError = () => stop('SUBPROCESS_SPAWN');
  const onStreamError = () => stop('SUBPROCESS_IO');
  child.on('error', onError);
  child.stderr.on('error', onStreamError);
  child.stderr.on('data', (chunk) => {
    diagnostic = Buffer.concat([
      diagnostic,
      Buffer.from(chunk).subarray(-diagnosticBytes),
    ]).subarray(-diagnosticBytes);
  });
  const limit = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) {
        stop('SUBPROCESS_OUTPUT_LIMIT');
        callback(processError('SUBPROCESS_OUTPUT_LIMIT'));
      } else callback(null, chunk);
    },
  });
  if (!output) limit.resume();
  const drain = (
    output
      ? pipeline(child.stdout, limit, output)
      : pipeline(child.stdout, limit)
  ).catch(() => {
    stop('SUBPROCESS_IO');
  });
  try {
    const exitCode = await new Promise((resolve) =>
      child.once('close', (code) => {
        closed = true;
        resolve(code);
      })
    );
    await drain;
    if (failure) throw failure;
    if (exitCode !== 0) throw processError('SUBPROCESS_EXIT');
    return {
      bytes,
      durationMs: Date.now() - startedAt,
      diagnostic: diagnostic.toString(),
    };
  } finally {
    clearTimeout(timer);
    clearTimeout(escalation);
    signal?.removeEventListener('abort', onAbort);
    child.removeListener('error', onError);
    child.stderr.removeListener('error', onStreamError);
    if (output && !output.destroyed) output.destroy();
  }
}

module.exports = { runProcess };
