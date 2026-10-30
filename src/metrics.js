const os = require('os');
const config = require('./config.js');

// How often collected metrics are pushed to Grafana.
const REPORT_PERIOD_MS = 10000;

// A user counts as "active" if we have seen an authenticated request from them
// inside this window.
const ACTIVE_USER_WINDOW_MS = 5 * 60 * 1000;

// Cumulative counters. These are reported as monotonic sums, so they are never
// reset while the process is alive.
const requestsByMethod = {};
const authAttempts = { success: 0, failure: 0 };
const pizzas = { sold: 0, failures: 0, revenue: 0 };

// Latency is reported as the mean over each reporting period, so these are
// snapshotted and cleared every time metrics are sent.
let endpointLatency = { totalMs: 0, count: 0 };
let pizzaLatency = { totalMs: 0, count: 0 };

// userId -> epoch ms of the last authenticated request.
const activeUsers = new Map();

// Express middleware that records every request's method and duration.
// Mount it after setAuthUser so that req.user is populated.
function requestTracker(req, res, next) {
  const start = process.hrtime.bigint();
  requestsByMethod[req.method] = (requestsByMethod[req.method] || 0) + 1;

  res.on('finish', () => {
    endpointLatency.totalMs += Number(process.hrtime.bigint() - start) / 1e6;
    endpointLatency.count++;

    if (req.user?.id) {
      activeUsers.set(req.user.id, Date.now());
    }
  });

  next();
}

// Express middleware for the auth router. A registration or login that comes
// back 200 is a successful attempt; anything else failed.
function authTracker(req, res, next) {
  if (req.method === 'POST' || req.method === 'PUT') {
    res.on('finish', () => {
      if (res.statusCode === 200) {
        authAttempts.success++;
      } else {
        authAttempts.failure++;
      }
    });
  }

  next();
}

// Called by the order router once the factory has answered.
function pizzaPurchase({ success, latencyMs, pizzaCount, revenue }) {
  if (success) {
    pizzas.sold += pizzaCount;
    pizzas.revenue += revenue;
  } else {
    pizzas.failures++;
  }

  pizzaLatency.totalMs += latencyMs;
  pizzaLatency.count++;
}

function getCpuUsagePercentage() {
  const cpuUsage = os.loadavg()[0] / os.cpus().length;
  return Number((cpuUsage * 100).toFixed(2));
}

function getMemoryUsagePercentage() {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  return Number(((usedMemory / totalMemory) * 100).toFixed(2));
}

function countActiveUsers() {
  const cutoff = Date.now() - ACTIVE_USER_WINDOW_MS;
  for (const [userId, lastSeen] of activeUsers) {
    if (lastSeen < cutoff) {
      activeUsers.delete(userId);
    }
  }
  return activeUsers.size;
}

// Builds a single OTel payload out of many individual metrics.
class OtelMetricBuilder {
  constructor() {
    this.metrics = [];
  }

  // `unit` is omitted for plain counts so that Prometheus does not append a
  // unit suffix to the metric name.
  add(name, value, { type = 'sum', unit, valueType = 'asInt', attributes = {} } = {}) {
    const dataPoint = {
      [valueType]: value,
      timeUnixNano: Date.now() * 1000000,
      attributes: Object.entries({ ...attributes, source: config.metrics.source }).map(([key, val]) => ({
        key,
        value: { stringValue: String(val) },
      })),
    };

    const metric = { name, [type]: { dataPoints: [dataPoint] } };
    if (unit) {
      metric.unit = unit;
    }
    if (type === 'sum') {
      metric[type].aggregationTemporality = 'AGGREGATION_TEMPORALITY_CUMULATIVE';
      metric[type].isMonotonic = true;
    }

    this.metrics.push(metric);
    return this;
  }

  toPayload() {
    return { resourceMetrics: [{ scopeMetrics: [{ metrics: this.metrics }] }] };
  }
}

// One series per HTTP method. The dashboard derives the overall total with
// sum(), so there is no separate "total" metric to keep in step.
function collectHttpMetrics(builder) {
  Object.entries(requestsByMethod).forEach(([method, count]) => {
    builder.add('requests', count, { unit: '1', attributes: { method } });
  });
}

function collectAuthMetrics(builder) {
  builder.add('auth_attempts', authAttempts.success, { unit: '1', attributes: { result: 'success' } });
  builder.add('auth_attempts', authAttempts.failure, { unit: '1', attributes: { result: 'failure' } });
}

function collectUserMetrics(builder) {
  builder.add('active_users', countActiveUsers(), { type: 'gauge' });
}

function collectSystemMetrics(builder) {
  builder.add('cpu', getCpuUsagePercentage(), { type: 'gauge', unit: '%', valueType: 'asDouble' });
  builder.add('memory', getMemoryUsagePercentage(), { type: 'gauge', unit: '%', valueType: 'asDouble' });
}

function collectPurchaseMetrics(builder) {
  builder.add('pizzas_sold', pizzas.sold, { unit: '1' });
  builder.add('pizza_creation_failures', pizzas.failures, { unit: '1' });
  builder.add('revenue', pizzas.revenue, { unit: '1', valueType: 'asDouble' });
}

// Mean latency over the period that just ended, then start a fresh period.
function collectLatencyMetrics(builder) {
  const endpoint = endpointLatency;
  const pizza = pizzaLatency;
  endpointLatency = { totalMs: 0, count: 0 };
  pizzaLatency = { totalMs: 0, count: 0 };

  const mean = (sample) => (sample.count === 0 ? 0 : Number((sample.totalMs / sample.count).toFixed(2)));

  builder.add('endpoint_latency', mean(endpoint), { type: 'gauge', unit: 'ms', valueType: 'asDouble' });
  builder.add('pizza_latency', mean(pizza), { type: 'gauge', unit: 'ms', valueType: 'asDouble' });
}

function sendToGrafana(builder) {
  const body = JSON.stringify(builder.toPayload());

  return fetch(config.metrics.endpointUrl, {
    method: 'POST',
    body,
    headers: {
      Authorization: `Bearer ${config.metrics.accountId}:${config.metrics.apiKey}`,
      'Content-Type': 'application/json',
    },
  })
    .then((response) => {
      if (!response.ok) {
        return response.text().then((text) => console.error(`Failed to push metrics to Grafana: ${text}`));
      }
    })
    .catch((error) => console.error('Error pushing metrics:', error));
}

function sendMetrics() {
  try {
    const builder = new OtelMetricBuilder();
    collectHttpMetrics(builder);
    collectAuthMetrics(builder);
    collectUserMetrics(builder);
    collectSystemMetrics(builder);
    collectPurchaseMetrics(builder);
    collectLatencyMetrics(builder);
    return sendToGrafana(builder);
  } catch (error) {
    console.error('Error collecting metrics', error);
  }
}

function sendMetricsPeriodically(period = REPORT_PERIOD_MS) {
  const timer = setInterval(sendMetrics, period);
  // Do not hold the event loop open just to report metrics.
  timer.unref();
  return timer;
}

// Jest would otherwise keep reporting for the length of the test run and push
// test traffic into the real dashboard.
if (!process.env.JEST_WORKER_ID) {
  sendMetricsPeriodically();
}

module.exports = {
  requestTracker,
  authTracker,
  pizzaPurchase,
  sendMetrics,
  sendMetricsPeriodically,
};
