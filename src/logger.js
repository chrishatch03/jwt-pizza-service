const config = require('./config.js');

// Fields whose values must never reach the log store. Matched against the
// JSON-encoded log line, so both the outer object and any nested JSON string
// (such as a captured request body) are covered.
const SECRET_FIELDS = ['password', 'token', 'jwt', 'apiKey', 'authorization'];

class Logger {
  // Express middleware. Captures the response body by temporarily replacing
  // res.send, so the log records what the caller actually received.
  httpLogger = (req, res, next) => {
    const send = res.send;
    res.send = (resBody) => {
      const logData = {
        authorized: !!req.headers.authorization,
        path: req.originalUrl,
        method: req.method,
        statusCode: res.statusCode,
        reqBody: JSON.stringify(req.body),
        resBody: JSON.stringify(resBody),
      };
      this.log(this.statusToLogLevel(res.statusCode), 'http', logData);
      res.send = send;
      return res.send(resBody);
    };
    next();
  };

  // Called from DB.query so every SQL statement is logged in one place.
  //
  // Only the parameterized statement is logged, never the bound values. Those
  // values are positional, so name-based masking cannot reach them, and they
  // include auth token signatures and bcrypt password hashes.
  dbLogger(sql, params) {
    this.log('info', 'db', { sql, paramCount: (params ?? []).length });
  }

  // Called from the order router around the pizza factory call.
  factoryLogger(reqBody, resBody, statusCode) {
    this.log(this.statusToLogLevel(statusCode), 'factory', {
      statusCode,
      reqBody: JSON.stringify(reqBody),
      resBody: JSON.stringify(resBody),
    });
  }

  // Called from the Express error handler and from the process-level handlers.
  unhandledExceptionLogger(err) {
    this.log('error', 'exception', {
      message: err?.message ?? String(err),
      stack: err?.stack,
      statusCode: err?.statusCode,
    });
  }

  log(level, type, logData) {
    const labels = { component: config.logging.source, level: level, type: type };
    const values = [this.nowString(), this.sanitize(logData)];
    const logEvent = { streams: [{ stream: labels, values: [values] }] };

    this.sendLogToGrafana(logEvent);
  }

  statusToLogLevel(statusCode) {
    if (statusCode >= 500) return 'error';
    if (statusCode >= 400) return 'warn';
    return 'info';
  }

  nowString() {
    return (Math.floor(Date.now()) * 1000000).toString();
  }

  // Masks secrets at whatever nesting depth they appear, including inside
  // request and response bodies that were already stringified.
  sanitize(logData) {
    let text = JSON.stringify(logData);
    for (const field of SECRET_FIELDS) {
      // Matches "field":"value" with any number of backslash escapes around
      // the quotes, which is what nested JSON strings look like.
      const pattern = new RegExp(`(\\\\*"${field}\\\\*"\\s*:\\s*\\\\*")([^"\\\\]*)(\\\\*")`, 'gi');
      text = text.replace(pattern, '$1*****$3');
    }
    return text;
  }

  sendLogToGrafana(event) {
    // Jest would otherwise push test traffic into the production log store.
    if (process.env.JEST_WORKER_ID) return;

    const body = JSON.stringify(event);
    fetch(`${config.logging.endpointUrl}`, {
      method: 'post',
      body: body,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.logging.accountId}:${config.logging.apiKey}`,
      },
    })
      .then((res) => {
        if (!res.ok) console.log('Failed to send log to Grafana');
      })
      // Without this catch a transient network failure reaching Loki becomes
      // an unhandled rejection, which would terminate the service.
      .catch((err) => console.log('Failed to send log to Grafana:', err.message));
  }
}

module.exports = new Logger();
