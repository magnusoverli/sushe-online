const { Counter, Gauge } = require('prom-client');
const { register } = require('./metrics');
const events = new Counter({
  name: 'sushe_outbound_events_total',
  help: 'Bounded outbound queue/transport outcomes',
  labelNames: ['kind'],
  registers: [register],
});
const waiting = new Gauge({
  name: 'sushe_outbound_queue_waiting',
  help: 'Total waiting outbound work',
  registers: [register],
});
const active = new Gauge({
  name: 'sushe_outbound_queue_active',
  help: 'Total active outbound work',
  registers: [register],
});
module.exports = { events, waiting, active };
