// One error shape for every API route: {error: {code, message}}.
// Messages name the cause and the next action, never just "failed".
// Plain Response.json (not NextResponse) so this module also imports under
// plain node for unit tests. Routes that set cookies build a NextResponse
// themselves; this helper never sets one.
export function json(data, status = 200, headers) {
  return Response.json(data, { status, headers });
}

export function err(code, message, status = 400) {
  return Response.json({ error: { code, message } }, { status });
}

export function badRequest(message) {
  return err('bad_request', message, 400);
}

export function unauthorized(message = 'Sign in first.') {
  return err('unauthorized', message, 401);
}

export function forbidden(message = 'That does not belong to your account.') {
  return err('forbidden', message, 403);
}

export function notFound(message = 'Nothing at that id. Check the URL.') {
  return err('not_found', message, 404);
}

export function unconfigured(message = 'The database is not connected yet.') {
  return err('unconfigured', message, 503);
}

export function internal(message = 'Something went wrong on our side. Try again in a few minutes.') {
  return err('internal', message, 500);
}

// Request id for the error screen ("Reference: req_...") so a log line
// can be found from the page. Random, not sequential, no user data in it.
export function requestId() {
  return 'req_' + Math.random().toString(36).slice(2, 10);
}
