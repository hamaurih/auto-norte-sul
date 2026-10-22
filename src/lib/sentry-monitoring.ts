import * as Sentry from "@sentry/browser";

/**
 * Privacy-first monitoring, enabled only when a DSN has been supplied.
 * Never attach customer, prescription, checkout or authentication payloads.
 */
const dsn = import.meta.env.VITE_SENTRY_DSN;
const environment = import.meta.env.MODE;

function redact(text: string): string {
  return text
    .replace(/(Bearer\s+)[^\s"'<>]+/gi, "$1[REDACTED]")
    .replace(/((?:access_token|refresh_token|authorization|password|cpf|email|token)=)[^\s&#]+/gi, "$1[REDACTED]")
    .replace(/https?:\/\/[^\s)]+/gi, (url) => url.split(/[?#]/)[0]);
}

if (typeof window !== "undefined" && dsn) {
  Sentry.init({
    dsn,
    environment,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeBreadcrumb: () => null,
    beforeSend(event) {
      // Do not export URL paths/query strings, user records or extra context.
      delete event.request;
      delete event.user;
      delete event.extra;
      delete event.contexts;
      delete event.breadcrumbs;
      delete event.transaction;
      event.tags = { application: import.meta.env.VITE_SENTRY_APP || "web" };
      if (event.message) event.message = redact(event.message);
      if (event.exception?.values) {
        event.exception.values = event.exception.values.map((entry) => ({
          ...entry,
          value: entry.value ? redact(entry.value) : entry.value,
          stacktrace: entry.stacktrace
            ? {
                ...entry.stacktrace,
                frames: entry.stacktrace.frames?.map((frame) => ({
                  ...frame,
                  filename: frame.filename?.split(/[?#]/)[0],
                  abs_path: undefined,
                  vars: undefined,
                  context_line: undefined,
                  pre_context: undefined,
                  post_context: undefined,
                })),
              }
            : undefined,
        }));
      }
      return event;
    },
  });
}

export function captureApplicationError(error: unknown): void {
  if (typeof window !== "undefined" && dsn) {
    Sentry.captureException(error instanceof Error ? error : new Error("Application failure"));
  }
}
