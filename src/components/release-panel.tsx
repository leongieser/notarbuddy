"use client";

import { Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DraftDialog } from "@/components/draft-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface Blocker {
  kind: "field" | "page";
  reference: string;
  reason: string;
}

export interface Gate {
  open: boolean;
  blockers: Blocker[];
  criticalTotal: number;
  criticalResolved: number;
}

/** One release path, used by the panel and by the sticky bar it collapses into. */
export function useDraftRelease(documentId: string) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}/draft`, {
        method: "POST",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? `Freigabe fehlgeschlagen (${response.status})`);
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError("Freigabe fehlgeschlagen — keine Verbindung zum Server.");
    } finally {
      setBusy(false);
    }
  }

  return { generate, working: busy || pending, error };
}

export function ReleasePanel({
  documentId,
  gate,
  draft,
  labelFor,
}: {
  documentId: string;
  gate: Gate;
  draft: { content: string; createdAt: Date } | null;
  labelFor: Record<string, string>;
}) {
  const { generate, working, error } = useDraftRelease(documentId);
  const [showDraft, setShowDraft] = useState(false);

  const progress =
    gate.criticalTotal === 0 ? 0 : gate.criticalResolved / gate.criticalTotal;

  // A fragment, not a wrapper: a sticky element travels only inside its own parent, so
  // these two blocks have to sit directly in the section that holds the whole review.
  return (
    <>
      {/*
       * The summary row sticks; the detail below it simply scrolls away. An earlier
       * version condensed the whole panel on scroll and fought the user for it: shrinking
       * a sticky element also shrinks its slot in the flow, the page got shorter, the
       * browser clamped the scroll position, and the collapse undid itself — a loop that
       * reads as being snapped back. A sticky element has to keep a constant height.
       */}
      <div className="sticky top-0 z-20 bg-background pt-1 pb-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded border bg-background px-4 py-2.5">
          <p className="text-sm">
            <span className="font-medium tabular-nums">
              {gate.criticalResolved} von {gate.criticalTotal}
            </span>{" "}
            <span className="text-muted-foreground">
              kritischen Feldern bestätigt
            </span>
          </p>
          <div className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${
                gate.open ? "bg-success" : "bg-foreground"
              }`}
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          {draft ? (
            <>
              <Button size="sm" onClick={() => setShowDraft(true)}>
                Entwurf ansehen
              </Button>
              <Button
                variant="outline"
                size="icon"
                nativeButton={false}
                render={
                  // biome-ignore lint/a11y/useAnchorContent: the render prop merges the Button's children in, and it carries an aria-label
                  <a
                    href={`/api/documents/${documentId}/draft/pdf`}
                    download
                    aria-label="Urkundenentwurf als PDF herunterladen"
                  />
                }
              >
                <Download className="size-4" />
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={generate}
              disabled={working || !gate.open}
            >
              {working ? "Erzeuge …" : "Entwurf erzeugen"}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 px-1 pb-1">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Freigabe verweigert</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {draft ? (
          // The draft is a snapshot of the values at the moment it was released, so a
          // later correction does not reach it. Say so, and offer the re-run.
          <p className="flex flex-wrap items-center gap-x-2 text-muted-foreground text-sm">
            <span>
              Entwurf vom{" "}
              {draft.createdAt.toLocaleString("de-DE", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
              . Spätere Korrekturen sind darin nicht enthalten.
            </span>
            <button
              type="button"
              onClick={generate}
              disabled={working || !gate.open}
              className="rounded-sm underline underline-offset-4 hover:text-foreground disabled:opacity-50"
            >
              {working ? "Erzeuge …" : "Neu erzeugen"}
            </button>
          </p>
        ) : gate.open ? (
          <p className="text-muted-foreground text-sm">
            Eigentümer und Belastungen sind menschlich bestätigt. Der Entwurf
            kann erzeugt werden.
          </p>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              Der Entwurf bleibt gesperrt, bis jedes kritische Feld entschieden
              ist. Die Sperre gilt serverseitig, auch für direkte API-Aufrufe.
            </p>
            <ul className="flex flex-col gap-1">
              {gate.blockers.slice(0, 6).map((b) => (
                <li key={`${b.kind}-${b.reference}`} className="text-sm">
                  <span className="font-medium">
                    {b.kind === "page"
                      ? b.reference
                      : (labelFor[b.reference] ?? b.reference)}
                  </span>
                  <span className="text-muted-foreground"> — {b.reason}</span>
                </li>
              ))}
              {gate.blockers.length > 6 ? (
                <li className="text-muted-foreground text-sm">
                  … und {gate.blockers.length - 6} weitere
                </li>
              ) : null}
            </ul>
          </>
        )}
      </div>

      {showDraft && draft ? (
        <DraftDialog
          documentId={documentId}
          content={draft.content}
          createdAt={draft.createdAt}
          onClose={() => setShowDraft(false)}
        />
      ) : null}
    </>
  );
}
