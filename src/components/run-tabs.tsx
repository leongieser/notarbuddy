"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

type Tab = "seiten" | "datensatz";

const ORDER: Tab[] = ["seiten", "datensatz"];

/**
 * The two things you look at during a run, in one place.
 *
 * Pages first, because before the agent has read anything they are all there is to see.
 * The dataset takes over the moment the first field is recorded — that is the thing you
 * started the run for — but only until someone picks a tab themselves, after which the
 * choice is theirs and a later write must not steal it back.
 */
export function RunTabs({
  pageCount,
  fieldCount,
  pages,
  dataset,
}: {
  pageCount: number;
  fieldCount: number;
  pages: ReactNode;
  dataset: ReactNode;
}) {
  const hasData = fieldCount > 0;
  const [tab, setTab] = useState<Tab>(hasData ? "datensatz" : "seiten");
  const chosen = useRef(false);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({
    seiten: null,
    datensatz: null,
  });

  useEffect(() => {
    if (!chosen.current && hasData) setTab("datensatz");
  }, [hasData]);

  const pick = (next: Tab) => {
    chosen.current = true;
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  const labels: Record<Tab, string> = {
    seiten: `Seiten (${pageCount})`,
    datensatz: `Datensatz (${fieldCount})`,
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div
        role="tablist"
        aria-label="Seiten und Datensatz"
        className="flex gap-1 border-b"
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const step = event.key === "ArrowRight" ? 1 : -1;
          pick(
            ORDER[(ORDER.indexOf(tab) + step + ORDER.length) % ORDER.length],
          );
        }}
      >
        {ORDER.map((key) => (
          <button
            key={key}
            ref={(el) => {
              tabRefs.current[key] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`panel-${key}`}
            tabIndex={tab === key ? 0 : -1}
            onClick={() => pick(key)}
            className={`-mb-px border-b-2 px-3 py-2 font-medium text-sm transition-colors ${
              tab === key
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {labels[key]}
          </button>
        ))}
      </div>

      {/* Both panels stay mounted: switching keeps its scroll position, and the page
          images are not refetched every time someone looks back at them. */}
      <div
        role="tabpanel"
        id="panel-seiten"
        aria-labelledby="tab-seiten"
        hidden={tab !== "seiten"}
        className="min-w-0"
      >
        {pages}
      </div>
      <div
        role="tabpanel"
        id="panel-datensatz"
        aria-labelledby="tab-datensatz"
        hidden={tab !== "datensatz"}
        className="min-w-0"
      >
        {dataset}
      </div>
    </div>
  );
}
