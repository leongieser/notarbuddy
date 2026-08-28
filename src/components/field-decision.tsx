"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * The human decision on one field. Confirming keeps the agent's value; correcting replaces
 * it and records why. Both write an audit event before the field changes.
 */
export function FieldDecision({
  fieldId,
  value,
  status,
}: {
  fieldId: string;
  value: string | null;
  status: "extracted" | "flagged" | "confirmed" | "corrected";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const decided = status === "confirmed" || status === "corrected";

  // A decision that silently fails to save is the worst outcome this screen can produce:
  // the reviewer believes a critical field is settled and it is not. Never swallow it.
  async function send(body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/fields/${fieldId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setError(
          `Nicht gespeichert (Fehler ${response.status}). Bitte erneut versuchen.`,
        );
        return;
      }
      setCorrecting(false);
      setReason("");
      startTransition(() => router.refresh());
    } catch {
      setError("Nicht gespeichert — keine Verbindung zum Server.");
    } finally {
      setBusy(false);
    }
  }

  const working = busy || pending;

  if (correcting) {
    return (
      // A flagged row is tinted, and the shadcn fields are bg-transparent — on that wash
      // an input has no edge of its own. The panel and the fields both carry their own
      // background so the editing surface reads as one, on any row colour.
      <div className="flex flex-col gap-2 rounded-md border bg-background px-3 py-3">
        <label
          className="font-medium text-muted-foreground text-xs"
          htmlFor={`v-${fieldId}`}
        >
          Richtiger Wert
        </label>
        <Input
          id={`v-${fieldId}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={working}
          className="bg-background"
        />
        <label
          className="mt-1 font-medium text-muted-foreground text-xs"
          htmlFor={`r-${fieldId}`}
        >
          Begründung (erscheint im Audit-Log)
        </label>
        <Textarea
          id={`r-${fieldId}`}
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="z. B. Im Seitenbild geprüft, Wert lautet anders"
          disabled={working}
          className="bg-background"
        />
        <div className="mt-1 flex flex-wrap gap-2">
          <Button
            disabled={working || draft.trim().length === 0}
            onClick={() =>
              send({
                action: "correct",
                value: draft.trim(),
                ...(reason.trim() ? { reason: reason.trim() } : {}),
              })
            }
          >
            Korrektur speichern
          </Button>
          <Button
            variant="outline"
            disabled={working}
            onClick={() => {
              setCorrecting(false);
              setDraft(value ?? "");
            }}
          >
            Abbrechen
          </Button>
        </div>
        {/* A failed save keeps the form open, so the reason it failed has to be here
            too — the other branch's alert is never reached from this view. */}
        {error ? (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  // With no value there is nothing to confirm, but there is still a decision to record:
  // that the Auszug does not state it. Demanding a value instead would leave the reviewer
  // inventing one to get past the gate.
  const absent = value === null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {/* Without this the row states a problem and offers two terse buttons, leaving the
          reviewer to work out that "nothing here" is a decision they are allowed to take.
          Name the decision. */}
      {absent && !decided ? (
        <p className="w-full text-muted-foreground text-sm">
          Der Agent hat keinen Wert gefunden. Bestätige, dass der Auszug hier
          keinen angibt — oder trage ihn nach, wenn du ihn findest.
        </p>
      ) : null}
      {decided ? null : (
        <Button
          size="sm"
          variant="outline"
          disabled={working}
          onClick={() => send({ action: absent ? "absent" : "confirm" })}
        >
          {absent ? "Fehlt im Auszug" : "Bestätigen"}
        </Button>
      )}
      <button
        type="button"
        disabled={working}
        onClick={() => setCorrecting(true)}
        className="rounded-sm text-muted-foreground text-sm underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
      >
        {decided
          ? "Erneut korrigieren"
          : absent
            ? "Wert nachtragen"
            : "Korrigieren"}
      </button>
      {error ? (
        <p role="alert" className="w-full text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
