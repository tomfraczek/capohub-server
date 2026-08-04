import { INestApplication } from '@nestjs/common';

// Tracks which INestApplication instances have already been closed, so
// closeE2eApp is safe to call more than once for the same app (idempotent) -
// NestJS's own app.close() is not: calling it a second time re-runs every
// destroy/shutdown hook (including MikroORM's onApplicationShutdown, which
// calls orm.close() again) against an already-torn-down app, which is not
// guaranteed to be safe.
const closedApps = new WeakSet<INestApplication>();

/**
 * The one shared shutdown path for every e2e spec's `afterAll` - runs
 * `cleanup` (if given), then always closes `app`, even if `cleanup` throws.
 *
 * Exists because of a confirmed, reproduced failure mode: every e2e file's
 * `afterAll` used to run its own `nativeDelete(...)` calls followed by a
 * bare `await app.close()` on the next line. If any of those deletes threw
 * (observed in practice: a leftover row from an earlier interrupted test
 * run - e.g. a `kill -9`'d process - poisoning a fixed-identity test user,
 * causing an FK violation on that file's own final cleanup delete),
 * `app.close()` was never reached. The app's MikroORM connection pool
 * stayed open, leaving idle-but-live Postgres connections behind (visible
 * in `pg_stat_activity` as `state = idle`, `wait_event = ClientRead` - not
 * a stuck query, not a lock, just never told to close) and keeping the
 * Jest process alive indefinitely ("Jest did not exit... asynchronous
 * operations that weren't stopped").
 *
 * Confirmed experimentally (not assumed) that `app.close()` itself already
 * closes the ORM/HTTP server/every resource correctly once actually
 * reached - two clean back-to-back runs of events.e2e-spec.ts against a
 * debris-free database exited on their own with zero leftover connections
 * and zero leftover processes, using the exact same `app.close()` NestJS
 * already provides. No change to *how* closing happens was needed - only
 * a guarantee that it always runs.
 */
export async function closeE2eApp(
  app: INestApplication,
  cleanup?: () => Promise<void>,
): Promise<void> {
  try {
    if (cleanup) {
      await cleanup();
    }
  } finally {
    if (!closedApps.has(app)) {
      closedApps.add(app);
      // `server.close()` (which `app.close()` calls internally) stops
      // accepting *new* connections but, per Node's own documented
      // behavior, does not forcibly end sockets already open on
      // keep-alive - it waits for them to end naturally, which can take
      // up to the server's keepAliveTimeout (default 5s). With 22
      // sequential e2e files each booting/tearing down their own full
      // NestJS app + HTTP server in one Node process, a socket left in
      // this lingering half-closed state around the moment the *next*
      // file's app starts listening is a plausible source of exactly the
      // class of failure this suite has intermittently shown (a stray
      // "socket hang up" / "Parse Error: Expected HTTP/", or a request
      // that inexplicably 404s on a route that must always exist) -
      // forcibly destroying every socket before closing removes that
      // window entirely, regardless of keep-alive state.
      const server = app.getHttpServer() as {
        closeAllConnections?: () => void;
      };
      server.closeAllConnections?.();
      await app.close();
    }
  }
}
