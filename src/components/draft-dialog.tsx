"use client";

import { Download, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

/**
 * The Urkundenentwurf, full width and full height.
 *
 * A deed is read, not glanced at, and it was previously a block competing with the review
 * list for the same page. The text shown here is the stored draft — the same bytes the PDF
 * is typeset from — so what you read is what you download.
 */
export function DraftDialog({
  documentId,
  content,
  createdAt,
  onClose,
}: {
  documentId: string;
  content: string;
  createdAt: Date;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Mounted only while shown, so opening is a mount effect. No cleanup calling close():
  // in StrictMode the remount would fire the close event and dismiss it on arrival.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="m-auto hidden h-[92vh] w-[95vw] max-w-4xl flex-col overflow-hidden rounded-lg bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/70 open:flex"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-3">
        <div className="min-w-0">
          <p className="font-medium text-sm">Urkundenentwurf</p>
          <p className="text-muted-foreground text-xs">
            erzeugt am{" "}
            {createdAt.toLocaleString("de-DE", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
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
          Als PDF herunterladen
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Schließen"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </header>

      <div className="flex-1 overflow-auto bg-muted/30 p-6">
        <pre className="mx-auto max-w-2xl whitespace-pre-wrap font-sans text-sm leading-relaxed">
          {content}
        </pre>
      </div>
    </dialog>
  );
}
