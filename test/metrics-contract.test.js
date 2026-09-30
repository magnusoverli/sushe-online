const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const metrics = require('../utils/metrics');
const outbound = require('../utils/outbound-metrics');

test('metrics client migration preserves scrape names, labels, values and content type', async () => {
  metrics.register.resetMetrics();
  metrics.httpRequestsTotal.labels('GET', '/api/lists', '200').inc(2);
  metrics.httpRequestDuration.labels('GET', '/api/lists', '200').observe(0.25);
  outbound.events.labels('completed').inc();
  outbound.active.set(3);
  metrics.setPoolReference({
    totalCount: 2,
    idleCount: 1,
    waitingCount: 0,
    query: async () => ({ rows: [{ cnt: '4' }] }),
  });
  try {
    const output = await metrics.getMetrics();
    assert.match(metrics.getContentType(), /^text\/plain; version=0\.0\.4/);
    assert.match(
      output,
      /sushe_http_requests_total\{method="GET",route="\/api\/lists",status_code="200"\} 2/
    );
    assert.match(
      output,
      /sushe_http_request_duration_seconds_sum\{method="GET",route="\/api\/lists",status_code="200"\} 0\.25/
    );
    assert.match(output, /sushe_outbound_events_total\{kind="completed"\} 1/);
    assert.match(output, /sushe_outbound_queue_active 3/);
    assert.match(output, /sushe_db_pool_size\{state="total"\} 2/);
    assert.match(output, /sushe_user_sessions_active 4/);
    assert.match(output, /sushe_process_cpu_user_seconds_total/);
  } finally {
    metrics.setPoolReference(null);
  }
});

test('HTTP metrics still collapse arbitrary unmatched requests to bounded labels', async () => {
  metrics.register.resetMetrics();
  for (let i = 0; i < 3; i++) {
    const response = new EventEmitter();
    response.statusCode = 404;
    response.get = () => undefined;
    let nextCalled = false;
    metrics.metricsMiddleware()(
      { method: 'GET', url: `/unknown-${i}` },
      response,
      () => {
        nextCalled = true;
      }
    );
    assert.equal(nextCalled, true);
    response.emit('finish');
  }
  const result = await metrics.httpRequestsTotal.get();
  assert.equal(result.values.length, 1);
  assert.deepEqual(result.values[0].labels, {
    method: 'GET',
    route: 'unmatched',
    status_code: '404',
  });
  assert.equal(result.values[0].value, 3);
});
