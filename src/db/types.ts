export type SourceType = "pdf";

export type DocumentStatus = "uploaded" | "extracting" | "review" | "failed";

export type OcrStatus = "pending" | "ok" | "failed";

export type OcrErrorCode =
  | "AUTH_FAILED"
  | "QUOTA_EXCEEDED"
  | "RATE_LIMITED"
  | "NETWORK"
  | "IMAGE_MISSING"
  | "UNREADABLE_PAGE";

export interface OcrError {
  code: OcrErrorCode;
  message: string;
  retryable: boolean;
}

/**
 * One OCR'd word. `start`/`end` index into the owning page's canonicalText, so a page
 * can be re-read without invalidating citations recorded against other pages.
 * Box coordinates are pixels in the page image's own space.
 */
export interface OcrWord {
  text: string;
  start: number;
  end: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  confidence: number;
}

export type RunKind = "extraction" | "judge";

export type RunStatus = "running" | "succeeded" | "failed";

export type AgentStepType =
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "finish";

/** `flagged` is a first-class outcome: the agent may report that it could not determine a value. */
export type FieldStatus = "extracted" | "flagged" | "confirmed" | "corrected";

export type EventActor =
  | `agent:${string}`
  | `judge:${string}`
  | "user"
  | "system";

export type EventAction =
  | "extracted"
  | "flagged"
  | "confirmed"
  | "corrected"
  | "ocr_completed"
  | "ocr_failed"
  | "run_failed"
  | "judge_verified"
  | "judge_escalated"
  | "draft_generated";

/** Box as a fraction of page width/height, so it survives any render size. */
export interface RelativeBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a value came from. Offsets are page-local; see OcrWord. */
export interface SourceSpan {
  pageId: string;
  pageIndex: number;
  start: number;
  end: number;
  quote: string;
  /** One box per visual line the span covers; a wrapped cell needs several. */
  boxes: RelativeBox[];
}

export interface AgentStepPayload {
  toolName?: string;
  input?: unknown;
  output?: unknown;
  text?: string;
  isError?: boolean;
}

/** Kept alongside the value so an audit entry is readable without joining anything. */
export interface EventEvidence {
  spans?: SourceSpan[];
  confidence?: number;
  reason?: string;
  model?: string;
}
