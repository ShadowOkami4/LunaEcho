import { boolean, customType, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

/** Raw bytes; node-postgres returns a Buffer, PGlite a Uint8Array. */
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
});

/** The image card LunaEcho draws for joining and leaving members. */
export const welcomeCards = pgTable("welcome_cards", {
  guildId: text("guild_id").primaryKey(),
  welcomeEnabled: boolean("welcome_enabled").notNull().default(false),
  goodbyeEnabled: boolean("goodbye_enabled").notNull().default(false),
  layout: text("layout", { enum: ["centered", "left"] }).notNull(),
  background: text("background").notNull(),
  accentColor: text("accent_color").notNull(),
  textColor: text("text_color").notNull(),
  overlayOpacity: integer("overlay_opacity").notNull(),
  welcomeTitle: text("welcome_title").notNull(),
  welcomeSubtitle: text("welcome_subtitle").notNull(),
  goodbyeTitle: text("goodbye_title").notNull(),
  goodbyeSubtitle: text("goodbye_subtitle").notNull(),
  /** An uploaded background, already cropped and re-encoded as JPEG by LunaEcho. */
  backgroundImage: bytea("background_image"),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamptz("updated_at").notNull(),
});
