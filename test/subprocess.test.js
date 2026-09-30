const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runProcess } = require('../utils/subprocess');
const { Writable } = require('node:stream');

test('drains pipe-sized stdout and bounds diagnostic capture', async () => {
  const result = await runProcess(
    process.execPath,
    [
      '-e',
      "process.stdout.write('a'.repeat(2e6)); process.stderr.write('b'.repeat(2e6))",
    ],
    { diagnosticBytes: 1024 }
  );
  assert.equal(result.bytes, 2000000);
  assert.equal(result.diagnostic.length, 1024);
});
test('kills children that ignore graceful termination on deadline or cancellation', async () => {
  const args = ['-e', "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"];
  await assert.rejects(
    runProcess(process.execPath, args, { timeoutMs: 150, killGraceMs: 50 }),
    { code: 'SUBPROCESS_TIMEOUT' }
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150);
  try {
    await assert.rejects(
      runProcess(process.execPath, args, {
        signal: controller.signal,
        killGraceMs: 50,
      }),
      { code: 'SUBPROCESS_ABORTED' }
    );
  } finally {
    clearTimeout(timer);
  }
});
test('spawn, nonzero exit and output sink errors fail without raw diagnostics', async () => {
  await assert.rejects(runProcess('/nonexistent/sushe-test', []), {
    code: 'SUBPROCESS_SPAWN',
  });
  await assert.rejects(
    runProcess(process.execPath, ['-e', 'process.exit(2)']),
    { code: 'SUBPROCESS_EXIT' }
  );
  const output = new Writable({
    write(_chunk, _encoding, cb) {
      cb(new Error('private disk error'));
    },
  });
  await assert.rejects(
    runProcess(process.execPath, ['-e', "process.stdout.write('data')"], {
      output,
    }),
    { code: 'SUBPROCESS_IO' }
  );
});
test('output limit terminates work rather than buffering beyond the budget', async () => {
  await assert.rejects(
    runProcess(
      process.execPath,
      ['-e', "process.stdout.write('a'.repeat(1e6))"],
      { maxOutputBytes: 1024 }
    ),
    { code: 'SUBPROCESS_OUTPUT_LIMIT' }
  );
});
