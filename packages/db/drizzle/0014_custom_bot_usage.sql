CREATE TABLE "custom_bot_usage" (
	"bot_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"day" date NOT NULL,
	"guild_count" integer NOT NULL,
	"member_count" integer NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	CONSTRAINT "custom_bot_usage_bot_id_day_pk" PRIMARY KEY("bot_id","day")
);
--> statement-breakpoint
CREATE INDEX "custom_bot_usage_owner_day_idx" ON "custom_bot_usage" USING btree ("owner_user_id","day");