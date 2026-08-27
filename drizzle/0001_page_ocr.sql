ALTER TABLE "pages" ADD COLUMN "ocr_status" varchar(16) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "ocr_error" jsonb;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "canonical_text" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "words" jsonb;