import { Badge } from "@/components/ui/badge";
import type { Event } from "@/db";

const ACTION_LABEL: Record<string, string> = {
  extracted: "erfasst",
  flagged: "zur Prüfung markiert",
  confirmed: "bestätigt",
  corrected: "korrigiert",
  judge_verified: "vom Judge bestätigt",
  judge_escalated: "vom Judge beanstandet",
  ocr_completed: "Seite gelesen",
  ocr_failed: "Seite nicht lesbar",
  run_failed: "Lauf fehlgeschlagen",
  draft_generated: "Entwurf erzeugt",
};

const HUMAN_ACTIONS = new Set(["confirmed", "corrected", "draft_generated"]);

const timeFormat = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "short",
  timeStyle: "medium",
});

/** Who or what an actor string refers to, without leaking run ids into the sentence. */
function describeActor(actor: string): string {
  if (actor === "user") return "Mensch";
  if (actor === "system") return "System";
  if (actor.startsWith("judge:")) return "Judge-Agent";
  if (actor.startsWith("agent:")) return "Extraktions-Agent";
  return actor;
}

/**
 * The audit log, append-only and read straight from `events`.
 *
 * It answers one question: three weeks from now, who or what set this field to this value,
 * and on what evidence. So each row names the actor, the change, and the reason — not just
 * that something happened.
 */
export function AuditLog({
  events,
  labelFor,
}: {
  events: Event[];
  labelFor: Record<string, string>;
}) {
  if (events.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Noch keine Vorgänge aufgezeichnet.
      </p>
    );
  }

  return (
    <ol className="flex flex-col">
      {events.map((event) => {
        const human = HUMAN_ACTIONS.has(event.action);
        return (
          <li
            key={event.id}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b py-2 last:border-b-0"
          >
            <span className="w-36 shrink-0 tabular-nums text-muted-foreground text-xs">
              {timeFormat.format(event.createdAt)}
            </span>
            <Badge variant={human ? "default" : "secondary"}>
              {describeActor(event.actor)}
            </Badge>
            <span className="text-sm">
              {ACTION_LABEL[event.action] ?? event.action}
            </span>
            {event.fieldPath ? (
              <span className="font-medium text-sm">
                {labelFor[event.fieldPath] ?? event.fieldPath}
              </span>
            ) : null}
            {event.oldValue && event.oldValue !== event.newValue ? (
              <span className="text-muted-foreground text-sm">
                <span className="line-through">{event.oldValue}</span> →{" "}
                <span className="text-foreground">{event.newValue}</span>
              </span>
            ) : event.newValue ? (
              <span className="text-muted-foreground text-sm">
                „{event.newValue}"
              </span>
            ) : null}
            {event.evidence?.reason ? (
              <span className="w-full break-words pl-0 text-muted-foreground text-xs sm:pl-36">
                {event.evidence.reason}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
