CREATE TABLE "meta_ad_insights_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"meta_ad_id" text NOT NULL,
	"meta_adset_id" text NOT NULL,
	"meta_campaign_id" text NOT NULL,
	"date" date NOT NULL,
	"spend_cents" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"reach" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"link_clicks" integer DEFAULT 0 NOT NULL,
	"leads" integer DEFAULT 0 NOT NULL,
	"messages_started" integer DEFAULT 0 NOT NULL,
	"reactions" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"saves" integer DEFAULT 0 NOT NULL,
	"video_views" integer DEFAULT 0 NOT NULL,
	"post_engagement" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_ads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"meta_ad_id" text NOT NULL,
	"meta_adset_id" text NOT NULL,
	"meta_campaign_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text,
	"creative_id" text,
	"thumbnail_url" text,
	"title" text,
	"body" text,
	"channel" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_adsets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"meta_adset_id" text NOT NULL,
	"meta_campaign_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text,
	"daily_budget_cents" integer,
	"lifetime_budget_cents" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meta_connections" ADD COLUMN "account_name" text;--> statement-breakpoint
ALTER TABLE "meta_connections" ADD COLUMN "currency" text DEFAULT 'BRL' NOT NULL;--> statement-breakpoint
ALTER TABLE "meta_connections" ADD COLUMN "account_status" text;--> statement-breakpoint
ALTER TABLE "meta_connections" ADD COLUMN "funding_type" text;--> statement-breakpoint
ALTER TABLE "meta_connections" ADD COLUMN "balance_cents" integer;--> statement-breakpoint
ALTER TABLE "meta_connections" ADD COLUMN "spend_cap_cents" integer;--> statement-breakpoint
ALTER TABLE "meta_connections" ADD COLUMN "page_name" text;--> statement-breakpoint
ALTER TABLE "meta_connections" ADD COLUMN "low_balance_alert_cents" integer;--> statement-breakpoint
ALTER TABLE "meta_connections" ADD COLUMN "alert_phone" text;--> statement-breakpoint
ALTER TABLE "meta_connections" ADD COLUMN "alert_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "meta_connections" ADD COLUMN "last_balance_alert_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meta_ad_insights_daily" ADD CONSTRAINT "meta_ad_insights_daily_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ads" ADD CONSTRAINT "meta_ads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ads" ADD CONSTRAINT "meta_ads_connection_id_meta_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_adsets" ADD CONSTRAINT "meta_adsets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_adsets" ADD CONSTRAINT "meta_adsets_connection_id_meta_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meta_ad_insights_uq" ON "meta_ad_insights_daily" USING btree ("company_id","meta_ad_id","date");--> statement-breakpoint
CREATE INDEX "meta_ad_insights_campaign_idx" ON "meta_ad_insights_daily" USING btree ("company_id","meta_campaign_id","date");--> statement-breakpoint
CREATE INDEX "meta_ad_insights_date_idx" ON "meta_ad_insights_daily" USING btree ("company_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_ads_uq" ON "meta_ads" USING btree ("company_id","meta_ad_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_adsets_uq" ON "meta_adsets" USING btree ("company_id","meta_adset_id");