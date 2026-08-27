"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function UploadForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function send(init: RequestInit) {
    setError(null);
    const res = await fetch("/api/documents", init);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(
        typeof body.error === "string"
          ? body.error
          : `upload failed (${res.status})`,
      );
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-6">
      <FieldGroup>
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor="file">Grundbuchauszug hochladen</FieldLabel>
          <Input
            id="file"
            type="file"
            accept="application/pdf,.pdf"
            aria-invalid={error ? true : undefined}
            disabled={pending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const form = new FormData();
              form.set("file", file);
              send({ method: "POST", body: form });
              e.target.value = "";
            }}
          />
          <FieldDescription>
            PDF. Jede Seite wird gerastert und anschließend gelesen.
          </FieldDescription>
        </Field>
      </FieldGroup>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
