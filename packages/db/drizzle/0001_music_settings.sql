CREATE TABLE "guild_music_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"dj_role_id" text,
	"default_volume" integer DEFAULT 80 NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "guild_music_settings_default_volume_check" CHECK ("guild_music_settings"."default_volume" BETWEEN 0 AND 150)
);
