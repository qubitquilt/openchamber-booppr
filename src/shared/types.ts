/**
 * Shapes returned by the Boop receiver's tenant API. Field lists mirror
 * `apps/api/openapi.yaml` in the boop repository (snake_case keys, the Go json
 * tags); optional fields are the ones the spec itself marks optional or that
 * only some views populate.
 */

import type { FeedbackCategory, RunStatus, ReviewStatus } from "./constants";

export type { FeedbackCategory, RunStatus, ReviewStatus };

/** The verified `/api/me` claims (`SessionMe`). */
export interface SessionMe {
  sub: string;
  tenants: SessionTenantClaim[];
  platform_admin?: boolean;
  exp?: number;
  iat?: number;
  jti?: string;
}

/** One membership claim (`SessionTenantClaim`). */
export interface SessionTenantClaim {
  id: string;
  role: string;
}

/** `GET /api/me/tenants` (`MeTenantsResponse`): the live membership list. */
export interface MeTenantsResponse {
  tenants: SessionTenantClaim[];
}

/** `POST /auth/tenant/{slug}/cli-callback` and `…/refresh` (`CLICallbackResponse`). */
export interface CliCallbackResponse {
  session_jwt?: string;
  tenant_id?: string;
  role?: string;
  expires_at?: string;
  refreshed?: boolean;
}

/** One run stage (`TenantRunStage`), the member-facing projection. */
export interface TenantRunStage {
  scope?: string;
  stage: string;
  status: "unknown" | "running" | "passed" | "failed" | "retrying";
  attempts: number;
  started_at: string;
  ended_at?: string;
  duration_ms?: number;
}

/** One review run (`TenantRun`). */
export interface TenantRun {
  id: string;
  owner: string;
  repo: string;
  pr_number: number;
  commit_sha: string;
  review_number?: number;
  reason?: string;
  status: RunStatus;
  started_at: string;
  ended_at?: string;
  duration_ms?: number;
  error?: string;
  tenant_id?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cost_usd?: number;
  step_count?: number;
  stages?: TenantRunStage[];
}

/** `GET /api/tenants/{id}/runs` (`TenantRunsResponse`). */
export interface TenantRunsResponse {
  runs: TenantRun[];
  next_cursor?: string;
}

/** One findings row (`TenantFinding`) on a run. */
export interface TenantFinding {
  pk: number;
  id: string;
  run_id: string;
  lens: string;
  severity: string;
  path?: string;
  line?: number;
  headline: string;
  rationale: string;
  posted: boolean;
  posted_comment_id?: number;
  rejected_reason?: string;
  recorded_at: string;
}

/** `GET …/runs/{runID}/findings` (`TenantFindingsResponse`). */
export interface TenantFindingsResponse {
  run_id: string;
  findings: TenantFinding[];
}

/** Per-skill telemetry row (`LensTelemetry`). */
export interface LensTelemetry {
  lens: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
  step_count: number;
}

/** `GET …/runs/{runID}/telemetry` (`TenantRunTelemetryResponse`). */
export interface TenantRunTelemetryResponse {
  run_id: string;
  model?: string;
  provider?: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  reasoning_tokens?: number;
  cache_read_tokens: number;
  cache_write_tokens?: number;
  cost_usd: number;
  cost_prompt_usd?: number;
  cost_completion_usd?: number;
  cost_upstream_usd?: number;
  is_byok?: boolean;
  step_count: number;
  duration_ms?: number;
  lenses: LensTelemetry[];
}

/** The tracked-PR row (`TenantPR`). */
export interface TenantPR {
  owner: string;
  repo: string;
  pr_number: number;
  head_sha?: string;
  author_login?: string;
  author_user_id?: number;
  title?: string;
  state: "open" | "closed" | "merged";
  last_seen_at: string;
  last_review_run_id?: string;
  review_status: ReviewStatus;
  triggered_by_user_id?: number;
  triggered_by_login?: string;
}

/** `GET /api/tenants/{id}/prs` (`PRsResponse`). */
export interface PRsResponse {
  prs: TenantPR[];
  next_cursor?: string;
}

/**
 * The detail header's projection of one prs row (`TenantPRDetailPR`). A fact
 * the handler could not observe is omitted rather than sent as null — an
 * absent key means "not fetched yet", present means "observed".
 */
export interface TenantPRDetailPR extends TenantPR {
  body?: string;
  draft?: boolean;
  mergeable?: boolean;
  mergeable_state?: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  commits?: number;
  review_comments?: number;
  labels?: string[];
  requested_reviewers?: string[];
  author_association?: string;
  merged_at?: string;
  closed_at?: string;
  github_updated_at?: string;
  first_reviewed_at?: string;
}

/** One pr_findings row in any state (`TenantPRFinding`). */
export interface TenantPRFinding {
  fingerprint: string;
  lens: string;
  severity: string;
  path?: string;
  line?: number;
  headline: string;
  rationale: string;
  state: "open" | "resolved" | "not-verifiable";
  first_seen_at?: string;
  first_seen_run_id?: string;
  last_seen_at?: string;
  last_seen_run_id?: string;
  resolved_run_id?: string;
  posted_comment_id?: number;
}

/** Counts keyed by state and severity (`PRFindingsRollup`). */
export interface PRFindingsRollup {
  by_state: Record<string, number>;
  by_severity: Record<string, number>;
}

/** Per-PR run/telemetry rollup (`PRTelemetryRollup`). */
export interface PRTelemetryRollup {
  run_count: number;
  success_count: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  wall_clock_ms: number;
  first_started_at?: string;
  last_ended_at?: string;
}

/** `GET …/prs/{owner}/{repo}/{number}` (`TenantPRDetailResponse`). */
export interface TenantPRDetailResponse {
  pr: TenantPRDetailPR;
  /** False when the facts came from the cached row (GitHub slow or down). */
  github_fresh: boolean;
  runs: TenantRun[];
  findings_rollup: PRFindingsRollup;
  telemetry_rollup: PRTelemetryRollup;
  findings: TenantPRFinding[];
  findings_truncated: boolean;
  findings_total: number;
}

/** `POST …/review` (`OnDemandReviewResponse`). */
export interface OnDemandReviewResponse {
  run_id?: string;
  /** queued, rerun, duplicate, or the reset reason on 429. */
  status?: string;
}

/** The feedback body (`FeedbackRequest`). */
export interface FeedbackRequest {
  rating: number;
  category: FeedbackCategory;
  comment?: string;
  finding_pks?: number[];
}

/** The created feedback row (`ReviewFeedback`). */
export interface ReviewFeedback {
  id: string;
  run_id: string;
  tenant_id: string;
  submitted_by_user_id: number;
  rating: number;
  category: string;
  comment?: string;
  finding_pks?: number[];
  created_at: string;
}

/** `GET …/feedback` (`FeedbackListResponse`). */
export interface FeedbackListResponse {
  run_id: string;
  feedback: ReviewFeedback[];
}

/** The six-number tenant KPI block (`TenantKpi`). */
export interface TenantKpi {
  reviews_today: number;
  daily_review_limit: number;
  success_rate: number;
  cost_this_month: number;
  monthly_budget_usd: number;
  active_members: number;
}
