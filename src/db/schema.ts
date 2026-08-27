import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type {
  DocumentStatus,
  OcrError,
  OcrStatus,
  OcrWord,
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

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type Page = typeof pages.$inferSelect;
export type NewPage = typeof pages.$inferInsert;
