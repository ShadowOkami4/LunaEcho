CREATE TABLE "guild_automod_exemptions" (
	"guild_id" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "guild_automod_exemptions_guild_id_target_kind_target_id_pk" PRIMARY KEY("guild_id","target_kind","target_id"),
	CONSTRAINT "guild_automod_exemptions_target_kind_check" CHECK ("guild_automod_exemptions"."target_kind" IN ('channel', 'role'))
);
--> statement-breakpoint
CREATE TABLE "guild_automod_rules" (
	"guild_id" text NOT NULL,
	"rule_kind" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"action" text DEFAULT 'log-only' NOT NULL,
	"trigger_limit" integer DEFAULT 1 NOT NULL,
	"secondary_limit" integer,
	"window_seconds" integer,
	"timeout_seconds" integer DEFAULT 600 NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "guild_automod_rules_guild_id_rule_kind_pk" PRIMARY KEY("guild_id","rule_kind"),
	CONSTRAINT "guild_automod_rules_rule_kind_check" CHECK ("guild_automod_rules"."rule_kind" IN ('message-flood', 'cross-channel-spam', 'mention-spam', 'attachment-spam', 'emoji-spam', 'large-message', 'excessive-caps', 'invite-links', 'polls', 'threats-and-identity-attacks')),
	CONSTRAINT "guild_automod_rules_action_check" CHECK ("guild_automod_rules"."action" IN ('log-only', 'delete', 'delete-and-warn', 'delete-and-timeout')),
	CONSTRAINT "guild_automod_rules_trigger_limit_check" CHECK ("guild_automod_rules"."trigger_limit" > 0),
	CONSTRAINT "guild_automod_rules_secondary_limit_check" CHECK ("guild_automod_rules"."secondary_limit" IS NULL OR "guild_automod_rules"."secondary_limit" > 0),
	CONSTRAINT "guild_automod_rules_window_seconds_check" CHECK ("guild_automod_rules"."window_seconds" IS NULL OR "guild_automod_rules"."window_seconds" > 0),
	CONSTRAINT "guild_automod_rules_timeout_seconds_check" CHECK ("guild_automod_rules"."timeout_seconds" BETWEEN 300 AND 86400)
);
--> statement-breakpoint
CREATE TABLE "guild_banned_words" (
	"guild_id" text NOT NULL,
	"normalized_word" text NOT NULL,
	"display_word" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "guild_banned_words_guild_id_normalized_word_pk" PRIMARY KEY("guild_id","normalized_word")
);
--> statement-breakpoint
CREATE TABLE "guild_moderation_case_counters" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"next_case_number" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "guild_moderation_case_counters_next_check" CHECK ("guild_moderation_case_counters"."next_case_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "guild_moderation_cases" (
	"guild_id" text NOT NULL,
	"case_number" integer NOT NULL,
	"action" text NOT NULL,
	"status" text NOT NULL,
	"target_user_id" text,
	"moderator_user_id" text NOT NULL,
	"reason" text NOT NULL,
	"duration_seconds" integer,
	"failure_code" text,
	"created_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "guild_moderation_cases_guild_id_case_number_pk" PRIMARY KEY("guild_id","case_number"),
	CONSTRAINT "guild_moderation_cases_case_number_check" CHECK ("guild_moderation_cases"."case_number" >= 1),
	CONSTRAINT "guild_moderation_cases_action_check" CHECK ("guild_moderation_cases"."action" IN ('warn', 'timeout', 'untimeout', 'kick', 'ban', 'unban', 'purge', 'automod')),
	CONSTRAINT "guild_moderation_cases_status_check" CHECK ("guild_moderation_cases"."status" IN ('pending', 'completed', 'failed')),
	CONSTRAINT "guild_moderation_cases_duration_check" CHECK ("guild_moderation_cases"."duration_seconds" IS NULL OR "guild_moderation_cases"."duration_seconds" > 0)
);
--> statement-breakpoint
CREATE TABLE "guild_moderation_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"banned_words_enabled" boolean DEFAULT false NOT NULL,
	"automod_profile" text DEFAULT 'off' NOT NULL,
	"staff_exempt" boolean DEFAULT true NOT NULL,
	"dm_notifications_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "guild_moderation_settings_automod_profile_check" CHECK ("guild_moderation_settings"."automod_profile" IN ('off', 'relaxed', 'balanced', 'strict', 'custom'))
);
--> statement-breakpoint
CREATE TABLE "guild_modules" (
	"guild_id" text NOT NULL,
	"module_id" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "guild_modules_guild_id_module_id_pk" PRIMARY KEY("guild_id","module_id")
);
--> statement-breakpoint
CREATE TABLE "voice_room_lobbies" (
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"category_id" text,
	"name_template" text NOT NULL,
	"user_limit" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "voice_room_lobbies_guild_id_channel_id_pk" PRIMARY KEY("guild_id","channel_id"),
	CONSTRAINT "voice_room_lobbies_user_limit_check" CHECK ("voice_room_lobbies"."user_limit" BETWEEN 0 AND 99)
);
--> statement-breakpoint
CREATE TABLE "voice_rooms" (
	"channel_id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"lobby_channel_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guild_automod_exemptions" ADD CONSTRAINT "guild_automod_exemptions_guild_id_guild_moderation_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_moderation_settings"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_automod_rules" ADD CONSTRAINT "guild_automod_rules_guild_id_guild_moderation_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_moderation_settings"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_banned_words" ADD CONSTRAINT "guild_banned_words_guild_id_guild_moderation_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_moderation_settings"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guild_automod_rules_enabled_idx" ON "guild_automod_rules" USING btree ("guild_id","enabled");--> statement-breakpoint
CREATE INDEX "guild_banned_words_created_at_idx" ON "guild_banned_words" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "guild_moderation_cases_target_idx" ON "guild_moderation_cases" USING btree ("guild_id","target_user_id","case_number" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "guild_moderation_cases_status_idx" ON "guild_moderation_cases" USING btree ("guild_id","status","case_number" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "voice_rooms_guild_owner_idx" ON "voice_rooms" USING btree ("guild_id","owner_id");