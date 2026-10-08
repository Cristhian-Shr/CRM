CREATE TABLE "company_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"service" text NOT NULL,
	"value_cents" integer DEFAULT 0 NOT NULL,
	"billing" text DEFAULT 'monthly' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_services" ADD CONSTRAINT "company_services_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_services_uq" ON "company_services" USING btree ("company_id","service");--> statement-breakpoint
INSERT INTO "company_services" ("company_id","service","value_cents","billing")
	SELECT "id", unnest("services"), 0, 'monthly' FROM "companies" WHERE array_length("services", 1) > 0;--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "services";