import { RUNS_PER_PAGE, PRS_PER_PAGE, type FeedbackCategory } from "./constants";
import type {
  FeedbackListResponse,
  FeedbackRequest,
  LensTelemetry,
  MeTenantsResponse,
  OnDemandReviewResponse,
  PRFindingsRollup,
  PRsResponse,
  ReviewFeedback,
  SessionMe,
  SessionTenantClaim,
  TenantFinding,
  TenantFindingsResponse,
  TenantKpi,
  TenantPR,
  TenantPRDetailResponse,
  TenantRun,
  TenantRunStage,
  TenantRunTelemetryResponse,
  TenantRunsResponse,
} from "./types";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type QueryValue = string | number | boolean | undefined | null;

/** Exactly the shape `host.serviceRequest` accepts, so it can be passed straight in. */
export interface RequestInput {
  method: HttpMethod;
  path: string;
  query?: Record<string, string>;
  body?: string;
}

export interface RequestResult {
  status: number;
  body: string;
}

/**
 * The transport. `serviceTransport` in `src/shared/service.ts` matches this
 * shape, and so does a plain stub in tests.
 */
export type RequestFn = (input: RequestInput) => Promise<RequestResult>;

/** An error the Boop receiver itself reported, or a status we could not read. */
export class BoopError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "BoopError";
    this.status = status;
    this.code = code;
  }
}

function buildQuery(
  query: Record<string, QueryValue> | undefined,
): Record<string, string> | undefined {
  if (!query) return undefined;
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params[key] = String(value);
  }
  return Object.keys(params).length > 0 ? params : undefined;
}

/**
 * Turn a non-2xx into a `BoopError`. The receiver answers structured
 * `{field, message}` bodies on validation failures, `{error: "…"}` on legacy
 * paths, and plain text ("unauthorized", "forbidden") on the rest — so the
 * plain text becomes the message when there is nothing structured to read.
 */
function toBoopError(status: number, body: string): BoopError {
  let message = "";
  let code = "";
  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: unknown; field?: unknown };
    if (typeof parsed.message === "string") message = parsed.message;
    else if (typeof parsed.error === "string") message = parsed.error;
    if (typeof parsed.error === "string" && code === "") code = parsed.error.toUpperCase();
  } catch {
    message = body.trim();
  }
  if (message.length > 300) message = `${message.slice(0, 299)}…`;
  if (!message) message = `Boop answered ${status}.`;
  if (!code) code = statusLabel(status);
  return new BoopError(status, code, message);
}

function statusLabel(status: number): string {
  switch (status) {
    case 401:
      return "SESSION_EXPIRED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "DUPLICATE_SHA";
    case 422:
      return "VALIDATION";
    case 429:
      return "RATE_LIMITED";
    default:
      return `HTTP_${status}`;
  }
}

/** Retries for a 429 before giving up, with a doubling delay between them. */
const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_BACKOFF_MS = 800;

export interface RunListOptions {
  owner?: string;
  repo?: string;
  status?: string;
  /** Only runs the signed-in user triggered. */
  mine?: boolean;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export interface PRListOptions {
  repo?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}

export interface BoopClient {
  /** The verified claims (`GET /api/me`), for the account label and admin flag. */
  me(): Promise<SessionMe>;
  /** The live membership list the tenant switcher reads (`GET /api/me/tenants`). */
  meTenants(): Promise<SessionTenantClaim[]>;
  listRuns(tenantId: string, options?: RunListOptions): Promise<TenantRunsResponse>;
  getRun(tenantId: string, runId: string): Promise<TenantRun>;
  getRunFindings(tenantId: string, runId: string): Promise<TenantFinding[]>;
  getRunTelemetry(tenantId: string, runId: string): Promise<TenantRunTelemetryResponse>;
  listPRs(tenantId: string, options?: PRListOptions): Promise<PRsResponse>;
  getPRDetail(
    tenantId: string,
    owner: string,
    repo: string,
    number: number,
  ): Promise<TenantPRDetailResponse>;
  triggerReview(
    tenantId: string,
    owner: string,
    repo: string,
    number: number,
  ): Promise<OnDemandReviewResponse>;
  postFeedback(tenantId: string, runId: string, input: FeedbackRequest): Promise<ReviewFeedback>;
  listFeedback(tenantId: string, runId: string): Promise<ReviewFeedback[]>;
  getKPIs(tenantId: string): Promise<TenantKpi>;
}

export function createBoopClient(request: RequestFn): BoopClient {
  /** Ergonomic input: a query of loose values and an object body. */
  type Call = {
    method: HttpMethod;
    path: string;
    query?: Record<string, QueryValue>;
    body?: unknown;
  };

  async function call<T>({ method, path, query, body }: Call): Promise<T> {
    const search = buildQuery(query);

    // A 429 is normal when several surfaces open at once, so back off and try
    // again rather than showing the user an error they cannot act on.
    let result: RequestResult | undefined;
    for (let attempt = 0; ; attempt += 1) {
      result = await request({
        method,
        path,
        ...(search ? { query: search } : {}),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (result.status !== 429 || attempt >= RATE_LIMIT_RETRIES) break;
      await new Promise((done) => setTimeout(done, RATE_LIMIT_BACKOFF_MS * 2 ** attempt));
    }
    const final = result as RequestResult;

    if (final.status >= 400) throw toBoopError(final.status, final.body);
    if (!final.body) return undefined as T;
    try {
      return JSON.parse(final.body) as T;
    } catch {
      throw new BoopError(final.status, "INVALID_RESPONSE", "Boop sent a body that is not JSON.");
    }
  }

  const tenant = (tenantId: string, rest: string) =>
    `/api/tenants/${encodeURIComponent(tenantId)}${rest}`;

  return {
    me: () => call<SessionMe>({ method: "GET", path: "/api/me" }),

    meTenants: async () => {
      const response = await call<MeTenantsResponse>({ method: "GET", path: "/api/me/tenants" });
      return response.tenants ?? [];
    },

    listRuns: (tenantId, options = {}) =>
      call<TenantRunsResponse>({
        method: "GET",
        path: tenant(tenantId, "/runs"),
        query: {
          owner: options.owner,
          repo: options.repo,
          status: options.status,
          from: options.from,
          to: options.to,
          cursor: options.cursor,
          mine: options.mine ? "true" : undefined,
          limit: options.limit ?? RUNS_PER_PAGE,
        },
      }),

    getRun: (tenantId, runId) =>
      call<TenantRun>({
        method: "GET",
        path: tenant(tenantId, `/runs/${encodeURIComponent(runId)}`),
      }),

    getRunFindings: async (tenantId, runId) => {
      const response = await call<TenantFindingsResponse>({
        method: "GET",
        path: tenant(tenantId, `/runs/${encodeURIComponent(runId)}/findings`),
      });
      return response.findings ?? [];
    },

    getRunTelemetry: (tenantId, runId) =>
      call<TenantRunTelemetryResponse>({
        method: "GET",
        path: tenant(tenantId, `/runs/${encodeURIComponent(runId)}/telemetry`),
      }),

    listPRs: (tenantId, options = {}) =>
      call<PRsResponse>({
        method: "GET",
        path: tenant(tenantId, "/prs"),
        query: {
          repo: options.repo,
          status: options.status,
          cursor: options.cursor,
          limit: options.limit ?? PRS_PER_PAGE,
        },
      }),

    getPRDetail: (tenantId, owner, repo, number) =>
      call<TenantPRDetailResponse>({
        method: "GET",
        path: tenant(
          tenantId,
          `/prs/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${number}`,
        ),
      }),

    triggerReview: (tenantId, owner, repo, number) =>
      call<OnDemandReviewResponse>({
        method: "POST",
        path: tenant(
          tenantId,
          `/prs/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${number}/review`,
        ),
      }),

    postFeedback: (tenantId, runId, input) =>
      call<ReviewFeedback>({
        method: "POST",
        path: tenant(tenantId, `/runs/${encodeURIComponent(runId)}/feedback`),
        body: input,
      }),

    listFeedback: async (tenantId, runId) => {
      const response = await call<FeedbackListResponse>({
        method: "GET",
        path: tenant(tenantId, `/runs/${encodeURIComponent(runId)}/feedback`),
      });
      return response.feedback ?? [];
    },

    getKPIs: (tenantId) => call<TenantKpi>({ method: "GET", path: tenant(tenantId, "/kpis") }),
  };
}

/** The feedback category the receiver expects, as a typed alias for callers. */
export type FeedbackCategoryName = FeedbackCategory;

export type {
  LensTelemetry,
  OnDemandReviewResponse,
  PRFindingsRollup,
  TenantFinding,
  TenantPR,
  TenantRun,
  TenantRunStage,
};
