// Structured log lines: one JSON object per line, no secrets, no repo URLs,
// no file contents. A route logs start, outcome, and duration only.
export function log(event, fields = {}) {
  const line = { ts: new Date().toISOString(), event, ...fields };
  console.log(JSON.stringify(line));
}

export function logError(event, error, fields = {}) {
  const line = {
    ts: new Date().toISOString(),
    event,
    error: error && error.message ? error.message : String(error),
    ...fields,
  };
  console.error(JSON.stringify(line));
}
