CREATE TABLE "custom_bot_grants" (
	"user_id" text PRIMARY KEY NOT NULL,
	"slots" integer NOT NULL,
	"note" text,
	"granted_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_bots" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"application_id" text NOT NULL,
	"bot_user_id" text NOT NULL,
	"name" text NOT NULL,
	"avatar_hash" text,
	"sealed_token" text NOT NULL,
	"database_name" text NOT NULL,
	"desired_state" text NOT NULL,
	"status" text NOT NULL,
	"status_message" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "custom_bots_application_idx" ON "custom_bots" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_bots_database_idx" ON "custom_bots" USING btree ("database_name");--> statement-breakpoint
CREATE INDEX "custom_bots_owner_idx" ON "custom_bots" USING btree ("owner_user_id");