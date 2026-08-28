"use client";

import { Minus, Plus, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import type { RelativeBox } from "@/db/types";

const LEVELS = [1, 1.5, 2, 3, 4];

/**
 * How much larger than the scan's own pixels the page opens.
 *
 * Sizing the zoom from the citation's width instead looked reasonable and was not: a
 * two-character Anteil drove it to 6x and dissolved into blocks, while a long Eintragung
 * opened small. The page is what has a legible size; the citation decides where the
 * viewer scrolls, not how far it magnifies.
 */
const OPENING_ZOOM = 1.6;

function union(boxes: RelativeBox[]): RelativeBox {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
    h: Math.max(...boxes.map((b) => b.y + b.h)) - y,
  };
}

function nearestLevel(zoom: number): number {
  return LEVELS.reduce((best, level) =>
    Math.abs(level - zoom) < Math.abs(best - zoom) ? level : best,
  );
}

/**
 * The full page at a size worth reading, with everything but the citation dimmed.
 *
 * The cited region is left untouched rather than tinted: a translucent fill over the
 * words is laid exactly across the thing the reviewer opened the page to read. The dim
 * belongs outside the box, and the box gets a ring.
 */
export function SourceDialog({
  onClose,
  label,
  quote,
  pageIndex,
  pageId,
  pageWidth,
  pageHeight,
  boxes,
}: {
  onClose: () => void;
  label: string;
  quote: string;
  pageIndex: number;
  pageId: string;
  pageWidth: number;
  pageHeight: number;
  boxes: RelativeBox[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Centre once per opening. Without the latch the effect would re-run on every render
  // and yank the page back under anyone who had scrolled away from the citation.
  const pendingCentre = useRef(false);
  const [zoom, setZoom] = useState(2);

  const focus = useMemo(
    () => (boxes.length > 0 ? union(boxes) : null),
    [boxes],
  );

  const centreOnCitation = useCallback(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content || !focus) return;
    scroller.scrollTo({
      left:
        (focus.x + focus.w / 2) * content.offsetWidth -
        scroller.clientWidth / 2,
      top:
        (focus.y + focus.h / 2) * content.offsetHeight -
        scroller.clientHeight / 2,
    });
  }, [focus]);

  // The dialog is mounted only while it is shown, so opening is a mount effect. Keeping
  // one per row mounted would also mean 40 hidden copies of the page image in the DOM.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    // Measure after showModal, never before: a closed dialog is display:none, so the
    // viewer reports a width of zero and every citation would open at 100%.
    dialog.showModal();
    const width = scrollRef.current?.clientWidth;
    const fit = width ? (OPENING_ZOOM * pageWidth) / width : 2;
    setZoom(Math.min(LEVELS[LEVELS.length - 1], Math.max(1, fit)));
    pendingCentre.current = true;
    // Deliberately no cleanup that calls close(): in StrictMode the remount cycle would
    // fire the dialog's close event, which `onClose` reads as the reviewer dismissing it
    // and unmounts the dialog the instant it opens. Removing the element closes it anyway.
  }, [pageWidth]);

  // `zoom` is a dependency on purpose: the scroll target is only meaningful once the new
  // magnification has been laid out, so this has to run after that render, not before it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useLayoutEffect(() => {
    if (!pendingCentre.current) return;
    pendingCentre.current = false;
    centreOnCitation();
  }, [zoom, centreOnCitation]);

  if (pageWidth === 0 || pageHeight === 0) return null;

  const maskId = `cite-${pageId}-${pageIndex}`;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key === "+" || event.key === "=")
          setZoom((z) => Math.min(LEVELS[LEVELS.length - 1], z * 1.5));
        if (event.key === "-") setZoom((z) => Math.max(1, z / 1.5));
        if (event.key === "0") setZoom(1);
      }}
      className="m-auto hidden h-[92vh] w-[95vw] max-w-none flex-col overflow-hidden rounded-lg bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/70 open:flex"
    >
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-3">
        <div className="min-w-0">
          <p className="font-medium text-sm">
            {label}
            <span className="ml-2 font-normal text-muted-foreground">
              Seite {pageIndex + 1}
            </span>
          </p>
          {quote ? (
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {quote}
            </p>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Schließen"
          className="ml-auto"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </header>

      <div
        ref={scrollRef}
        className="relative flex-1 overflow-auto bg-muted p-6"
      >
        <div
          ref={contentRef}
          className="relative mx-auto"
          style={{ width: `${zoom * 100}%` }}
        >
          {/* biome-ignore lint/performance/noImgElement: served from a route handler, not the public dir */}
          <img
            src={`/api/pages/${pageId}/image`}
            alt={`Seite ${pageIndex + 1} des Grundbuchauszugs`}
            className="block w-full rounded-sm bg-white shadow-[0_2px_12px_-4px_rgb(0_0_0/0.3)]"
          />
          {boxes.length > 0 ? (
            <svg
              className="pointer-events-none absolute inset-0 size-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              role="img"
              aria-label={`Fundstelle auf Seite ${pageIndex + 1} hervorgehoben`}
            >
              <title>{`Fundstelle: ${quote}`}</title>
              <mask id={maskId}>
                <rect width="100" height="100" fill="white" />
                {boxes.map((box, i) => (
                  <rect
                    key={`m-${i}-${box.x}-${box.y}`}
                    x={box.x * 100}
                    y={box.y * 100}
                    width={box.w * 100}
                    height={box.h * 100}
                    fill="black"
                  />
                ))}
              </mask>
              <rect
                width="100"
                height="100"
                fill="rgb(15 23 42 / 0.55)"
                mask={`url(#${maskId})`}
              />
              {boxes.map((box, i) => (
                <rect
                  key={`r-${i}-${box.x}-${box.y}`}
                  x={box.x * 100}
                  y={box.y * 100}
                  width={box.w * 100}
                  height={box.h * 100}
                  fill="none"
                  stroke="rgb(245 158 11)"
                  strokeWidth="0.25"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          ) : null}
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
        <Button
          variant="outline"
          size="icon"
          aria-label="Verkleinern"
          disabled={zoom <= LEVELS[0]}
          onClick={() =>
            setZoom((z) => {
              const i = LEVELS.indexOf(nearestLevel(z));
              return LEVELS[Math.max(0, i - 1)];
            })
          }
        >
          <Minus className="size-4" />
        </Button>
        <span className="w-14 text-center text-muted-foreground text-sm tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant="outline"
          size="icon"
          aria-label="Vergrößern"
          disabled={zoom >= LEVELS[LEVELS.length - 1]}
          onClick={() =>
            setZoom((z) => {
              const i = LEVELS.indexOf(nearestLevel(z));
              return LEVELS[Math.min(LEVELS.length - 1, i + 1)];
            })
          }
        >
          <Plus className="size-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={() => setZoom(1)}>
          Ganze Seite
        </Button>
        {focus ? (
          <Button variant="outline" size="sm" onClick={centreOnCitation}>
            Zur Fundstelle
          </Button>
        ) : null}
        <p className="ml-auto hidden text-muted-foreground text-xs sm:block">
          + / − zum Zoomen, 0 für die ganze Seite, Esc schließt.
        </p>
      </footer>
    </dialog>
  );
}
