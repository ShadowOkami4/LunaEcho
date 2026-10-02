CREATE TABLE "level_rewards" (
	"guild_id" text NOT NULL,
	"level" integer NOT NULL,
	"role_id" text NOT NULL,
	CONSTRAINT "level_rewards_guild_id_level_pk" PRIMARY KEY("guild_id","level"),
	CONSTRAINT "level_rewards_level_check" CHECK ("level_rewards"."level" BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE TABLE "level_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"message_xp_min" integer DEFAULT 15 NOT NULL,
	"message_xp_max" integer DEFAULT 25 NOT NULL,
	"message_cooldown_seconds" integer DEFAULT 60 NOT NULL,
	"voice_xp_per_minute" integer DEFAULT 10 NOT NULL,
	"announce_mode" text DEFAULT 'current' NOT NULL,
	"announce_channel_id" text,
	"announce_template" text DEFAULT '{user} reached level {level}!' NOT NULL,
	"stack_rewards" boolean DEFAULT true NOT NULL,
	"ignored_channel_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"ignored_role_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "level_settings_xp_range_check" CHECK ("level_settings"."message_xp_min" BETWEEN 0 AND 1000 AND "level_settings"."message_xp_max" BETWEEN "level_settings"."message_xp_min" AND 1000),
	CONSTRAINT "level_settings_cooldown_check" CHECK ("level_settings"."message_cooldown_seconds" BETWEEN 0 AND 3600),
	CONSTRAINT "level_settings_voice_check" CHECK ("level_settings"."voice_xp_per_minute" BETWEEN 0 AND 1000),
	CONSTRAINT "level_settings_announce_mode_check" CHECK ("level_settings"."announce_mode" IN ('off', 'current', 'channel'))
);
--> statement-breakpoint
CREATE TABLE "member_levels" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"xp" bigint DEFAULT 0 NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"voice_minutes" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "member_levels_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
CREATE INDEX "member_levels_leaderboard_idx" ON "member_levels" USING btree ("guild_id","xp" DESC NULLS LAST);