CREATE TABLE "agent_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" varchar(16) NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"field_path" text,
	"actor" text NOT NULL,
	"action" varchar(32) NOT NULL,
	"old_value" text,
	"new_value" text,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"path" text NOT NULL,
	"value" text,
	"confidence" real,
	"source_spans" jsonb,
	"status" varchar(16) DEFAULT 'extracted' NOT NULL,
	"critical" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"model" text NOT NULL,
	"status" varchar(16) DEFAULT 'running' NOT NULL,
	"error" text,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fields" ADD CONSTRAINT "fields_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_steps_run_id_seq_unique" ON "agent_steps" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "events_document_id_created_at_idx" ON "events" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "events_document_id_field_path_idx" ON "events" USING btree ("document_id","field_path");--> statement-breakpoint
CREATE UNIQUE INDEX "fields_document_id_path_unique" ON "fields" USING btree ("document_id","path");--> statement-breakpoint
CREATE INDEX "runs_document_id_idx" ON "runs" USING btree ("document_id");