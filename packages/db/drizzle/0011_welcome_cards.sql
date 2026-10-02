CREATE TABLE "welcome_cards" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"welcome_enabled" boolean DEFAULT false NOT NULL,
	"goodbye_enabled" boolean DEFAULT false NOT NULL,
	"layout" text NOT NULL,
	"background" text NOT NULL,
	"accent_color" text NOT NULL,
	"text_color" text NOT NULL,
	"overlay_opacity" integer NOT NULL,
	"welcome_title" text NOT NULL,
	"welcome_subtitle" text NOT NULL,
	"goodbye_title" text NOT NULL,
	"goodbye_subtitle" text NOT NULL,
	"background_image" "bytea",
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
