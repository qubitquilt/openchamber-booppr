/**
 * The bare-origin rule, shared by the two sides that must agree on it.
 *
 * The sign-in view validates the **Receiver URL** field with this helper
 * (`parseServerUrl` in `tenants.ts`), and the local service re-validates the
 * stored origin with the same function before every call (`normalizeOrigin`
 * in `service/main.ts`). One implementation is the point: if the copies
 * drifted, the field would accept a URL the service then rejects, and the
 * user would see a generic failure after a clean field check.
 *
 * A bare origin: scheme + host + optional port, no path, query, hash or
 * credentials. https is required everywhere except the loopback hosts, so a
 * port-forwarded development receiver (`http://localhost:8080`) works without
 * weakening the default. Returns "" when the value is not acceptable.
 */
export function normalizeOrigin(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return "";
  try {
    const url = new URL(value.trim());
    const hostname = url.hostname;
    // `URL.hostname` brackets IPv6 hosts, so the bracketed form is the one
    // that can match; a bare `::1` never parses as a host at all.
    const loopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
    if (url.protocol !== (loopback ? "http:" : "https:")) return "";
    if (url.username || url.password) return "";
    if (url.pathname !== "/" && url.pathname !== "") return "";
    if (url.search || url.hash) return "";
    return url.origin;
  } catch {
    return "";
  }
}
