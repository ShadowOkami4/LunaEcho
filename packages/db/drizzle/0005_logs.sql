CREATE TABLE "log_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"moderation_channel_id" text,
	"message_channel_id" text,
	"member_channel_id" text,
	"server_channel_id" text,
	"voice_channel_id" text,
	"ignored_channel_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
