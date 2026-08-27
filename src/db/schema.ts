import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type {
  AgentStepPayload,
  AgentStepType,
  DocumentStatus,
  EventAction,
  EventActor,
  EventEvidence,
  FieldStatus,
  OcrError,
  OcrStatus,
  OcrWord,
  RunKind,
  RunStatus,
  SourceSpan,
  SourceType,
} from "./types";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

const timestamps = {
  createdAt: timestamptz("created_at").defaultNow().notNull(),
  updatedAt: timestamptz("updated_at").defaultNow().notNull(),
};

/** One uploaded Grundbuchauszug. */
export const documents = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  sourceType: varchar("source_type", { length: 16 })
    .$type<SourceType>()
    .notNull(),
  status: varchar("status", { length: 16 })
    .$type<DocumentStatus>()
    .default("uploaded")
    .notNull(),
  ...timestamps,
});

/** One page image. PDFs are rasterized to a page each; uploaded images are a single page. */
export const pages = pgTable(
  "pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .references(() => documents.id, { onDelete: "cascade" })
      .notNull(),
    pageIndex: integer("page_index").notNull(),
    imagePath: text("image_path").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    ocrStatus: varchar("ocr_status", { length: 16 })
      .$type<OcrStatus>()
      .default("pending")
      .notNull(),
    /** Set only when ocrStatus is `failed`. */
    ocrError: jsonb("ocr_error").$type<OcrError>(),
    /** Our own geometry-based reconstruction, not Vision's reading order. */
    canonicalText: text("canonical_text"),
    /** Median OCR word confidence. Low means the scan itself is the problem. */
    ocrConfidence: real("ocr_confidence"),
    words: jsonb("words").$type<OcrWord[]>(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("pages_document_id_page_index_unique").on(
      t.documentId,
      t.pageIndex,
    ),
  ],
);

/** One invocation of an agent over a document. */
export const runs = pgTable(
  "runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .references(() => documents.id, { onDelete: "cascade" })
      .notNull(),
    kind: varchar("kind", { length: 16 }).$type<RunKind>().notNull(),
    model: text("model").notNull(),
    status: varchar("status", { length: 16 })
      .$type<RunStatus>()
      .default("running")
      .notNull(),
    error: text("error"),
    /** Tracked because the assignment caps API spend; without this the budget is guesswork. */
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    finishedAt: timestamptz("finished_at"),
    ...timestamps,
  },
  (t) => [index("runs_document_id_idx").on(t.documentId)],
);

/** The visible agent protocol: every step, in order, written as it happens. */
export const agentSteps = pgTable(
  "agent_steps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .references(() => runs.id, { onDelete: "cascade" })
      .notNull(),
    seq: integer("seq").notNull(),
    type: varchar("type", { length: 16 }).$type<AgentStepType>().notNull(),
    payload: jsonb("payload").$type<AgentStepPayload>().notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("agent_steps_run_id_seq_unique").on(t.runId, t.seq)],
);

/** Current value of one field. History lives in `events`; this is only the latest state. */
export const fields = pgTable(
  "fields",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .references(() => documents.id, { onDelete: "cascade" })
      .notNull(),
    /** Path into the Urkunden schema, e.g. `eigentuemer[0].name`. */
    path: text("path").notNull(),
    /** Null is meaningful: the agent looked and could not determine a value. */
    value: text("value"),
    confidence: real("confidence"),
    sourceSpans: jsonb("source_spans").$type<SourceSpan[]>(),
    status: varchar("status", { length: 16 })
      .$type<FieldStatus>()
      .default("extracted")
      .notNull(),
    critical: boolean("critical").default(false).notNull(),
    /** Why the agent flagged it, when it did. */
    note: text("note"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("fields_document_id_path_unique").on(t.documentId, t.path),
  ],
);

/**
 * Append-only audit log. Never updated or deleted: answering "who set this field to
 * this value three weeks ago" means replaying these rows.
 */
export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .references(() => documents.id, { onDelete: "cascade" })
      .notNull(),
    /** Null for document-level events such as `ocr_failed`. */
    fieldPath: text("field_path"),
    actor: text("actor").$type<EventActor>().notNull(),
    action: varchar("action", { length: 32 }).$type<EventAction>().notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    evidence: jsonb("evidence").$type<EventEvidence>(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("events_document_id_created_at_idx").on(t.documentId, t.createdAt),
    index("events_document_id_field_path_idx").on(t.documentId, t.fieldPath),
  ],
);

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type Page = typeof pages.$inferSelect;
export type NewPage = typeof pages.$inferInsert;
export type Run = typeof runs.$inferSelect;
export type AgentStep = typeof agentSteps.$inferSelect;
export type Field = typeof fields.$inferSelect;
export type Event = typeof events.$inferSelect;
