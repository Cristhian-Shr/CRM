CREATE TABLE "service_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"service" text NOT NULL,
	"competence" text NOT NULL,
	"value_cents" integer DEFAULT 0 NOT NULL,
	"billing" text DEFAULT 'monthly' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_charges" ADD CONSTRAINT "service_charges_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "service_charges_uq" ON "service_charges" USING btree ("company_id","service","competence");