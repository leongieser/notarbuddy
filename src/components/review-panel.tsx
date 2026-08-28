"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { FieldDecision } from "@/components/field-decision";
import { SourceDialog } from "@/components/source-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { RelativeBox } from "@/db/types";

export interface ReviewField {
  id: string;
  path: string;
  label: string;
  group: { key: string; title: string; order: number; critical: boolean };
  value: string | null;
  status: "extracted" | "flagged" | "confirmed" | "corrected";
  confidence: number | null;
  note: string | null;
  critical: boolean;
  quote: string;
  boxes: RelativeBox[];
  /** The least certain word behind this value, when OCR was unsure of one. */
  weakest: { text: string; confidence: number } | null;
  pageId: string;
  pageIndex: number;
}

export interface ReviewPage {
  id: string;
  pageIndex: number;
  width: number;
  height: number;
  section: string;
}

const STATUS_LABEL = {
  extracted: "erfasst",
  flagged: "zu prüfen",
  confirmed: "bestätigt",
  corrected: "korrigiert",
} as const;

const STATUS_BADGE = {
  extracted: "secondary",
  flagged: "destructive",
  confirmed: "default",
  corrected: "default",
} as const;

const DECIDED = new Set(["confirmed", "corrected"]);

type Filter = "open" | "flagged" | "all";

const MATCHES: Record<Filter, (field: ReviewField) => boolean> = {
  open: (field) => !DECIDED.has(field.status),
  flagged: (field) => field.status === "flagged",
  all: () => true,
};

const EMPTY: Record<Filter, { title: string; hint: string }> = {
  open: {
    title: "Alle Felder entschieden.",
    hint: "Der Entwurf kann unter \u201eFreigabe\u201c erzeugt werden.",
  },
  flagged: {
    title: "Keine Felder zur Prüfung markiert.",
    hint: "Der Agent hat zu keinem Wert Zweifel angemeldet.",
  },
  all: {
    title: "Noch kein Datensatz erfasst.",
    hint: "Starte die Extraktion unter \u201eAgentenlauf\u201c.",
  },
};

/** Matches the agent's own flagging threshold in `lib/agent/tools.ts`. */
const CONFIDENCE_THRESHOLD = 0.8;

/**
 * How much larger than the scan's own pixels an excerpt is drawn. Pages rasterise at
 * roughly 144 dpi, where Grundbuch print is legible but small; every crop uses the same
 * factor so the type is the same size in every row and the column can be read down.
 */
const CROP_ZOOM = 1.5;
/** Below this an excerpt is squinting, so it pans inside its frame instead of shrinking. */
const MIN_ZOOM = 0.85;
/** Row-wide excerpts may go smaller to stay whole, but not to the point of a hairline. */
const WIDE_MIN_ZOOM = 0.5;
/** The evidence column. Fixed rather than fractional so every row's excerpt starts and
 *  ends on the same two lines — a column the eye can run down instead of a ragged edge.
 *  Keep in step with the `26rem` track in FieldRow's grid. */
const EVIDENCE_COLUMN_PX = 416;
/**
 * Bleed around the word boxes, as a fraction of the box height.
 *
 * OCR boxes are tight to the glyphs, so an underline — the only thing that marks an entry
 * as gelöscht — falls outside them entirely: a crop cut to the box shows text with no
 * mark under it, flatly contradicting the flag next to it. The lower bleed therefore has
 * to clear UNDERLINE_BAND in `lib/ocr/marks.ts` (0.5 of line height), which is how far
 * below the box the detector itself looks, plus air.
 */
const BLEED_ABOVE = 0.35;
const BLEED_BELOW = 0.6;
const BLEED_X_PX = 10;

/**
 * The source region itself, cropped from the page scan.
 *
 * The page image is scaled behind a window the size of the box rather than a pre-cut
 * bitmap being enlarged, so the crop stays at the scan's own resolution. Sizing it to fill
 * the column was the earlier mistake: a citation covering a whole table row was squeezed
 * to a fifth of native size and came out three pixels tall.
 */
function Cutout({
  box,
  quote,
  pageId,
  page,
  allowShrink,
}: {
  box: RelativeBox;
  quote: string;
  pageId: string;
  page: ReviewPage;
  /** Set for excerpts that already span the row: complete and small beats legible and panned. */
  allowShrink: boolean;
}) {
  const padX = Math.min(BLEED_X_PX / page.width, 0.02);
  const x = Math.max(0, box.x - padX);
  const y = Math.max(0, box.y - box.h * BLEED_ABOVE);
  const w = Math.min(1 - x, box.w + padX * 2);
  const h = Math.min(1 - y, box.h * (1 + BLEED_ABOVE + BLEED_BELOW));

  const native = w * page.width;
  const target = Math.round(native * CROP_ZOOM);
  const floor = Math.round(native * MIN_ZOOM);
  const wideFloor = Math.round(native * WIDE_MIN_ZOOM);

  return (
    <div className="max-w-full overflow-x-auto">
      <div
        className="relative overflow-hidden rounded-sm border bg-white"
        style={{
          // Fills the column when it can, keeps full magnification when there is room, and
          // never shrinks past MIN_ZOOM — past that the frame scrolls instead.
          width: `min(${target}px, max(${allowShrink ? wideFloor : floor}px, 100%))`,
          aspectRatio: `${native} / ${Math.max(h * page.height, 6)}`,
        }}
      >
        {/* biome-ignore lint/performance/noImgElement: served from a route handler, not the public dir */}
        <img
          src={`/api/pages/${pageId}/image`}
          alt={`Fundstelle im Auszug: „${quote}"`}
          className="absolute top-0 left-0 max-w-none"
          style={{
            width: `${100 / w}%`,
            // Percentages in `transform` resolve against the image's own size, so the offset
            // stays correct at any frame width. A percentage `top` would resolve against the
            // frame's aspect-ratio height, which is circular and collapses to zero.
            transform: `translate(${-x * 100}%, ${-y * 100}%)`,
          }}
        />
      </div>
    </div>
  );
}

function FieldRow({
  field,
  page,
  selectable,
  selected,
  agentPicked,
  onSelect,
}: {
  field: ReviewField;
  page: ReviewPage | null;
  selectable: boolean;
  selected: boolean;
  /** Still exactly as the agent proposed it — untouched by the reviewer. */
  agentPicked: boolean;
  onSelect: (id: string, next: boolean) => void;
}) {
  const [showPage, setShowPage] = useState(false);
  const decided = DECIDED.has(field.status);
  const flagged = field.status === "flagged";
  const cited = field.pageId !== "" && field.boxes.length > 0;

  // An excerpt that cannot hold its magnification inside the evidence column takes the
  // whole row instead — a citation covering a table row is unreadable at column width,
  // and panning it sideways shows the wrong fragment first.
  // Only shown on a flagged row: its job is to explain the flag. On a field that passed,
  // naming its weakest word would raise a doubt the number does not support.
  const weakReading =
    flagged && field.weakest && field.weakest.confidence < CONFIDENCE_THRESHOLD
      ? field.weakest
      : null;

  const wideEvidence =
    page !== null &&
    field.boxes.some((b) => b.w * page.width * MIN_ZOOM > EVIDENCE_COLUMN_PX);

  const evidenceSpan = wideEvidence
    ? "col-start-2 md:col-span-2 md:col-start-2"
    : "col-start-2 md:col-start-2";
  // The excerpt may span both columns, but the value never leaves its own: one left edge
  // for every value on the screen is what makes the column readable top to bottom.
  const valueSpan = "col-start-2 md:col-start-3";

  return (
    <li
      className={`grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-4 gap-y-3 px-4 py-5 md:grid-cols-[1.5rem_26rem_minmax(0,1fr)] ${
        flagged ? "bg-destructive/[0.035]" : ""
      }`}
    >
      {/* One rail of checkboxes down the whole list: the selection is findable without
          hunting for it inside each row's content. */}
      <div className="col-start-1 row-start-1 flex justify-center pt-1">
        {selectable ? (
          <input
            type="checkbox"
            id={`sel-${field.id}`}
            checked={selected}
            onChange={(e) => onSelect(field.id, e.target.checked)}
            aria-label={
              agentPicked
                ? `${field.label} auswählen — vom Agenten vorausgewählt`
                : `${field.label} auswählen`
            }
            // Green while it is still the agent's proposal, the app's own accent once the
            // reviewer has touched it: the tick says who put it there.
            className={`size-[18px] cursor-pointer rounded-[3px] ${
              agentPicked ? "accent-success" : "accent-primary"
            }`}
          />
        ) : (
          <span
            aria-hidden
            className={`mt-1.5 size-[7px] rounded-full ${
              flagged ? "bg-destructive" : "bg-muted-foreground/30"
            }`}
          />
        )}
      </div>

      <div className={`${evidenceSpan} row-start-1 flex flex-col gap-1.5`}>
        {page && field.boxes.length > 0 ? (
          field.boxes.map((box, i) => (
            <Cutout
              key={`${field.id}-cut-${i}`}
              box={box}
              quote={field.quote}
              pageId={field.pageId}
              page={page}
              allowShrink={wideEvidence}
            />
          ))
        ) : (
          <p className="text-muted-foreground text-xs italic">
            Keine Fundstelle im Auszug
          </p>
        )}
      </div>

      <div className={`${valueSpan} flex min-w-0 flex-col`}>
        <p className="flex flex-wrap items-center gap-x-2 text-[11px] uppercase tracking-[0.08em]">
          <label
            htmlFor={selectable ? `sel-${field.id}` : undefined}
            className={`font-medium ${selectable ? "cursor-pointer" : ""}`}
          >
            {field.label}
          </label>
          {field.status !== "extracted" ? (
            <Badge variant={STATUS_BADGE[field.status]} className="ml-auto">
              {STATUS_LABEL[field.status]}
            </Badge>
          ) : null}
        </p>

        <p
          className={`mt-1.5 text-lg leading-snug ${
            field.value ? "font-medium" : "text-muted-foreground italic"
          }`}
        >
          {field.value ??
            (decided ? "im Auszug nicht angegeben" : "nicht bestimmt")}
        </p>

        {/* Nothing was located, so there is no page and no reading to report. "Seite 1 ·
            Konfidenz 0.00" would be two measurements of something that was never found. */}
        {cited ? (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
            <span>Seite {field.pageIndex + 1}</span>
            {field.confidence !== null ? (
              <>
                <span aria-hidden>·</span>
                <span className="tabular-nums">
                  Konfidenz {field.confidence.toFixed(2)}
                </span>
              </>
            ) : null}
            {page && field.boxes.length > 0 ? (
              <>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  onClick={() => setShowPage(true)}
                  aria-haspopup="dialog"
                  className="rounded-sm underline underline-offset-2 hover:text-foreground"
                >
                  im Auszug zeigen
                </button>
              </>
            ) : null}
          </p>
        ) : null}

        {/* Everything the reviewer has to weigh sits in one block rather than as more
            lines of the same grey: what OCR was unsure of, and what the agent made of it.
            A bare "0.43" names no doubt — the field's confidence is the minimum across
            its cited words, so naming that word is what makes the number checkable. */}
        {weakReading || field.note ? (
          <div
            className={`mt-3 rounded-md border px-3 py-2.5 ${
              flagged
                ? // The row already carries a red wash; a white card on it separates
                  // cleanly, where another red tint would just blend in.
                  "border-destructive/25 bg-background"
                : "border-border bg-muted/40"
            }`}
          >
            {weakReading ? (
              <p className="font-medium text-destructive text-xs">
                Unsicherste Lesung{" "}
                <span className="font-mono">„{weakReading.text}"</span>
              </p>
            ) : null}
            {field.note ? (
              <p
                className={`text-muted-foreground text-xs leading-relaxed ${
                  weakReading ? "mt-1.5" : ""
                }`}
              >
                {field.note}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-3">
          <FieldDecision
            fieldId={field.id}
            value={field.value}
            status={field.status}
          />
        </div>
      </div>

      {page && showPage ? (
        <SourceDialog
          onClose={() => setShowPage(false)}
          label={field.label}
          quote={field.quote}
          pageIndex={field.pageIndex}
          pageId={field.pageId}
          pageWidth={page.width}
          pageHeight={page.height}
          boxes={field.boxes}
        />
      ) : null}
    </li>
  );
}

/**
 * A field a decision can be taken on in bulk.
 *
 * Flagged fields are excluded on purpose: the agent asked for a look at those, and a sweep
 * past a flag is the one shortcut this whole screen exists to prevent. A field with no
 * value is excluded too — confirming it means confirming an absence, which is its own
 * decision and belongs on the row.
 */
function isSweepable(field: ReviewField): boolean {
  return (
    !DECIDED.has(field.status) &&
    field.status !== "flagged" &&
    field.value !== null
  );
}

/**
 * Pre-ticked on arrival: read cleanly and the agent raised nothing about it.
 *
 * The threshold sits above the flagging one on purpose. Between the two is the band where
 * the reading was good enough not to warrant a flag but not good enough to wave through
 * without a glance, and that band should cost the reviewer a decision.
 */
const PRESELECT_CONFIDENCE = 0.9;

function isPreselectable(field: ReviewField): boolean {
  return (
    isSweepable(field) &&
    field.note === null &&
    field.confidence !== null &&
    field.confidence >= PRESELECT_CONFIDENCE
  );
}

export function ReviewPanel({
  fields,
  pages,
}: {
  fields: ReviewField[];
  pages: ReviewPage[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("open");
  // Ticked on arrival, so the reviewer starts by looking at what needs looking at rather
  // than by clicking twenty-seven boxes. Deliberately not a decision on its own: the
  // confirmation is still one explicit click, the bar reports how many criticals are in
  // the selection, and anything the agent doubted was never ticked.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(fields.filter(isPreselectable).map((f) => f.id)),
  );
  const [agentPicked, setAgentPicked] = useState<Set<string>>(
    () => new Set(fields.filter(isPreselectable).map((f) => f.id)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const pageById = useMemo(() => new Map(pages.map((p) => [p.id, p])), [pages]);

  const openCount = fields.filter((f) => !DECIDED.has(f.status)).length;
  const decidedCount = fields.length - openCount;
  const uncritical = fields.filter((f) => isSweepable(f) && !f.critical);
  // Guarded by isSweepable: a field confirmed from its own row must drop straight out of
  // the count, not linger in it as something still awaiting a decision.
  const chosen = fields.filter((f) => selected.has(f.id) && isSweepable(f));
  const chosenCritical = chosen.filter((f) => f.critical).length;
  const working = busy || pending;

  const toggle = (id: string, next: boolean) => {
    // Touching a tick makes it the reviewer's, whichever way it goes.
    setAgentPicked((prev) => {
      if (!prev.has(id)) return prev;
      const copy = new Set(prev);
      copy.delete(id);
      return copy;
    });
    setSelected((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(id);
      else copy.delete(id);
      return copy;
    });
  };

  // Each field goes through the same audited endpoint as a single decision, so a bulk
  // confirmation is n individual confirmations — one event apiece, nothing special-cased
  // on the server that a direct API call could bypass.
  async function confirmAll(ids: string[]) {
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      // allSettled, not all: one rejected request would otherwise abandon the rest and
      // leave the screen stuck busy, with no sign that some fields never saved.
      const results = await Promise.allSettled(
        ids.map((id) =>
          fetch(`/api/fields/${id}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "confirm" }),
          }),
        ),
      );
      const failed = results.filter(
        (r) => r.status === "rejected" || !r.value.ok,
      ).length;
      if (failed > 0) {
        setError(
          `${failed} von ${ids.length} Feldern nicht gespeichert. Die übrigen wurden übernommen.`,
        );
      }
      setSelected(new Set());
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  const flaggedCount = fields.filter((f) => f.status === "flagged").length;
  const shown = fields.filter((f) => MATCHES[filter](f));

  // Group the way the Auszug is structured, so the reviewer walks the document, not a list.
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { title: string; order: number; critical: boolean; items: ReviewField[] }
    >();
    for (const field of shown) {
      const existing = map.get(field.group.key);
      if (existing) existing.items.push(field);
      else
        map.set(field.group.key, {
          title: field.group.title,
          order: field.group.order,
          critical: field.group.critical,
          items: [field],
        });
    }
    return [...map.values()].sort((a, b) => a.order - b.order);
  }, [shown]);

  return (
    <div className={`flex flex-col gap-5 ${openCount > 0 ? "pb-24" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["open", "Offen", openCount],
            ["flagged", "Zu prüfen", flaggedCount],
            ["all", "Alle", fields.length],
          ] as const
        ).map(([key, label, count]) => (
          <Button
            key={key}
            size="sm"
            variant={filter === key ? "default" : "outline"}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {label} ({count})
          </Button>
        ))}
        <p className="ml-auto text-muted-foreground text-sm">
          <span className="text-success">Grün</span> vorausgewählt: Werte ab
          Konfidenz {PRESELECT_CONFIDENCE.toFixed(2)} ohne Anmerkung des
          Agenten.
        </p>
      </div>

      {groups.length === 0 ? (
        <div className="rounded border border-dashed px-4 py-10 text-center">
          <p className="font-medium text-sm">{EMPTY[filter].title}</p>
          <p className="mt-1 text-muted-foreground text-sm">
            {EMPTY[filter].hint}
          </p>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.title} className="flex flex-col gap-2">
            {/* Criticality is a property of the section — Eigentümer, Abteilung II and
                III are critical in full — so it is stated once here rather than on each
                of the section's four fields, where it stopped carrying information. */}
            <h3 className="flex flex-wrap items-center gap-x-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
              {group.title}
              {group.critical ? (
                <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
                  kritisch
                </span>
              ) : null}
            </h3>
            <ul className="divide-y rounded border">
              {group.items.map((field) => (
                <FieldRow
                  key={field.id}
                  field={field}
                  page={pageById.get(field.pageId) ?? null}
                  selectable={isSweepable(field)}
                  selected={selected.has(field.id)}
                  agentPicked={agentPicked.has(field.id)}
                  onSelect={toggle}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {openCount > 0 ? (
        <div className="sticky bottom-4 z-10 mt-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border bg-background/95 px-4 py-3 shadow-[0_8px_24px_-12px_rgb(0_0_0/0.35)] backdrop-blur">
            <div className="min-w-0">
              <p className="text-sm">
                <span className="font-medium tabular-nums">
                  {decidedCount} von {fields.length}
                </span>{" "}
                <span className="text-muted-foreground">entschieden</span>
                {chosen.length > 0 ? (
                  <span className="text-muted-foreground">
                    {" · "}
                    <span className="tabular-nums">{chosen.length}</span>{" "}
                    ausgewählt
                    {chosenCritical > 0 ? (
                      <span className="text-destructive">
                        {`, davon ${chosenCritical} kritisch`}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 text-muted-foreground text-xs">
                {chosen.length > 0
                  ? "Angehakte Felder werden einzeln protokolliert — kritische eingeschlossen."
                  : "Überspringt kritische und markierte Felder; die werden einzeln entschieden."}
              </p>
              {error ? (
                <p role="alert" className="mt-1 text-destructive text-xs">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              {chosen.length > 0 ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={working}
                    onClick={() => setSelected(new Set())}
                  >
                    Auswahl aufheben
                  </Button>
                  <Button
                    size="sm"
                    disabled={working}
                    onClick={() => confirmAll(chosen.map((f) => f.id))}
                  >
                    {`Auswahl bestätigen (${chosen.length})`}
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  disabled={working || uncritical.length === 0}
                  onClick={() => confirmAll(uncritical.map((f) => f.id))}
                >
                  {`Unkritische bestätigen (${uncritical.length})`}
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
