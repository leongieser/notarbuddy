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
