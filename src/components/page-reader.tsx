"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { OcrError } from "@/db/types";

interface Props {
  pageId: string;
  ocrStatus: "pending" | "ok" | "failed";
  ocrError: OcrError | null;
  canonicalText: string | null;
}

export function PageReader({
  pageId,
  ocrStatus,
  ocrError,
  canonicalText,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);

  async function read() {
    setRunning(true);
    await fetch(`/api/pages/${pageId}/ocr`, { method: "POST" });
    setRunning(false);
    startTransition(() => router.refresh());
  }

  const busy = running || pending;

  if (ocrStatus === "ok" && canonicalText) {
    return (
      <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded border bg-muted/30 p-3 font-mono text-xs leading-relaxed">
        {canonicalText}
      </pre>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {ocrStatus === "failed" && ocrError ? (
        <Alert variant="destructive">
          <AlertTitle>Seite nicht gelesen — {ocrError.code}</AlertTitle>
          <AlertDescription>
            {ocrError.message}
            {ocrError.retryable ? " Ein erneuter Versuch kann helfen." : null}
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-muted-foreground text-sm">Noch nicht gelesen.</p>
      )}
      <div>
        <Button size="sm" onClick={read} disabled={busy}>
          {busy
            ? "Liest …"
            : ocrStatus === "failed"
              ? "Erneut lesen"
              : "Seite lesen"}
        </Button>
      </div>
    </div>
  );
}
