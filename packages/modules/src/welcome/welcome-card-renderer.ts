import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createCanvas,
  GlobalFonts,
  loadImage,
  type Image,
  type SKRSContext2D,
} from "@napi-rs/canvas";

export const welcomeCardSize = { height: 450, width: 1024 } as const;

export const welcomeCardLayouts = ["centered", "left"] as const;
export type WelcomeCardLayout = (typeof welcomeCardLayouts)[number];

/** Built-in backgrounds in the LunaEcho palette; "image" uses the uploaded picture. */
export const welcomeCardBackgrounds = ["luna", "night", "aurora", "sunset", "image"] as const;
export type WelcomeCardBackground = (typeof welcomeCardBackgrounds)[number];

export type WelcomeCardDesign = Readonly<{
  accentColor: string;
  background: WelcomeCardBackground;
  layout: WelcomeCardLayout;
  /** 0–80: how much the background is darkened behind the text. */
  overlayOpacity: number;
  textColor: string;
}>;

export type WelcomeCardContent = Readonly<{
  /** The member's avatar as PNG or JPEG bytes; initials are drawn without one. */
  avatar?: Uint8Array | undefined;
  /** Shown in the avatar circle when there is no avatar. */
  displayName: string;
  subtitle: string;
  title: string;
}>;

/**
 * The two subset files are separate families: registered under one name, the extended subset
 * would shadow the basic Latin letters. The font list falls back from one to the other.
 */
const fontStack = `"LunaEcho Card", "LunaEcho Card Extended"`;
const fontFiles = [
  ["roboto-flex-latin.woff2", "LunaEcho Card"],
  ["roboto-flex-latin-ext.woff2", "LunaEcho Card Extended"],
] as const;
let fontsRegistered = false;

/** The font files shipped with this package, next to `src` and `dist`. */
export function defaultWelcomeCardFontFolder(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "fonts");
}

function registerFonts(fontFolder: string): void {
  if (fontsRegistered) {
    return;
  }

  for (const [file, family] of fontFiles) {
    GlobalFonts.registerFromPath(resolve(fontFolder, file), family);
  }

  fontsRegistered = true;
}

const backgroundPresets: Readonly<
  Record<
    Exclude<WelcomeCardBackground, "image">,
    Readonly<{ base: string; glows: readonly (readonly [number, number, string])[] }>
  >
> = {
  aurora: {
    base: "#0f1a24",
    glows: [
      [0.15, 0.2, "rgba(120, 220, 200, 0.45)"],
      [0.85, 0.85, "rgba(158, 207, 255, 0.4)"],
    ],
  },
  luna: {
    base: "#191115",
    glows: [
      [0.1, 0.15, "rgba(158, 207, 255, 0.42)"],
      [0.9, 0.9, "rgba(255, 133, 210, 0.5)"],
    ],
  },
  night: {
    base: "#100c14",
    glows: [
      [0.5, -0.1, "rgba(171, 116, 255, 0.35)"],
      [0.5, 1.2, "rgba(255, 133, 210, 0.18)"],
    ],
  },
  sunset: {
    base: "#2a1219",
    glows: [
      [0.1, 0.9, "rgba(255, 170, 110, 0.5)"],
      [0.9, 0.1, "rgba(255, 133, 210, 0.45)"],
    ],
  },
};

function drawCover(context: SKRSContext2D, image: Image, width: number, height: number): void {
  const scale = Math.max(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  context.drawImage(
    image,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

function drawPreset(context: SKRSContext2D, preset: Exclude<WelcomeCardBackground, "image">): void {
  const { height, width } = welcomeCardSize;
  const { base, glows } = backgroundPresets[preset];
  context.fillStyle = base;
  context.fillRect(0, 0, width, height);

  for (const [x, y, color] of glows) {
    const gradient = context.createRadialGradient(
      x * width,
      y * height,
      0,
      x * width,
      y * height,
      width * 0.7,
    );
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  }
}

/** Shrinks the font until the text fits, then cuts it with an ellipsis as a last resort. */
function fitText(
  context: SKRSContext2D,
  text: string,
  weight: number,
  size: number,
  maxWidth: number,
): string {
  let fontSize = size;
  context.font = `${weight} ${fontSize}px ${fontStack}`;

  while (context.measureText(text).width > maxWidth && fontSize > size * 0.55) {
    fontSize -= 2;
    context.font = `${weight} ${fontSize}px ${fontStack}`;
  }

  let shown = text;

  while (shown.length > 1 && context.measureText(shown).width > maxWidth) {
    shown = `${shown.slice(0, -2)}…`;
  }

  return shown;
}

async function drawAvatar(
  context: SKRSContext2D,
  content: WelcomeCardContent,
  design: WelcomeCardDesign,
  centerX: number,
  centerY: number,
  radius: number,
): Promise<void> {
  // Accent ring with a dark gap, like the avatar rings of Discord profile cards.
  context.beginPath();
  context.arc(centerX, centerY, radius + 10, 0, Math.PI * 2);
  context.fillStyle = design.accentColor;
  context.fill();
  context.beginPath();
  context.arc(centerX, centerY, radius + 4, 0, Math.PI * 2);
  context.fillStyle = "#140c10";
  context.fill();

  context.save();
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.clip();

  const avatar =
    content.avatar === undefined
      ? undefined
      : await loadImage(content.avatar).catch(() => undefined);

  if (avatar === undefined) {
    context.fillStyle = "#3c3237";
    context.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
    context.fillStyle = design.textColor;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `700 ${Math.round(radius * 0.8)}px ${fontStack}`;
    context.fillText(content.displayName.slice(0, 2).toUpperCase(), centerX, centerY + 2);
  } else {
    context.drawImage(avatar, centerX - radius, centerY - radius, radius * 2, radius * 2);
  }

  context.restore();
}

/** Draws a welcome or goodbye card and returns it as PNG bytes. */
export async function renderWelcomeCard(
  options: Readonly<{
    backgroundImage?: Uint8Array | undefined;
    content: WelcomeCardContent;
    design: WelcomeCardDesign;
    fontFolder?: string;
  }>,
): Promise<Buffer> {
  registerFonts(options.fontFolder ?? defaultWelcomeCardFontFolder());
  const { content, design } = options;
  const { height, width } = welcomeCardSize;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");

  const background =
    design.background === "image" && options.backgroundImage !== undefined
      ? await loadImage(options.backgroundImage).catch(() => undefined)
      : undefined;

  if (background === undefined) {
    drawPreset(context, design.background === "image" ? "luna" : design.background);
  } else {
    drawCover(context, background, width, height);
  }

  // Darkening keeps the text readable on bright pictures.
  context.fillStyle = `rgba(10, 6, 8, ${Math.min(80, Math.max(0, design.overlayOpacity)) / 100})`;
  context.fillRect(0, 0, width, height);

  context.fillStyle = design.textColor;
  context.textBaseline = "alphabetic";

  if (design.layout === "centered") {
    await drawAvatar(context, content, design, width / 2, 150, 92);
    context.fillStyle = design.textColor;
    context.textAlign = "center";
    const title = fitText(context, content.title, 800, 58, width - 120);
    context.fillText(title, width / 2, 330);
    context.globalAlpha = 0.82;
    const subtitle = fitText(context, content.subtitle, 500, 30, width - 160);
    context.fillText(subtitle, width / 2, 380);
  } else {
    await drawAvatar(context, content, design, 225, height / 2, 120);
    context.fillStyle = design.textColor;
    context.textAlign = "left";
    const textLeft = 410;
    const title = fitText(context, content.title, 800, 58, width - textLeft - 60);
    context.fillText(title, textLeft, height / 2 + 4);
    context.globalAlpha = 0.82;
    const subtitle = fitText(context, content.subtitle, 500, 30, width - textLeft - 60);
    context.fillText(subtitle, textLeft, height / 2 + 54);
  }

  context.globalAlpha = 1;
  // A thin accent bar ties the card to the server's chosen colour.
  context.fillStyle = design.accentColor;
  context.fillRect(0, height - 6, width, 6);

  return canvas.toBuffer("image/png");
}

export class WelcomeCardImageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WelcomeCardImageError";
  }
}

export const maximumBackgroundUploadBytes = 5 * 1024 * 1024;

/**
 * Turns an uploaded picture into the stored background: decoded (which rejects anything that is
 * not an image), cropped to the card's shape, and re-encoded as JPEG. Nothing of the original
 * file, such as metadata, survives.
 */
export async function prepareWelcomeCardBackground(upload: Uint8Array): Promise<Buffer> {
  if (upload.byteLength === 0 || upload.byteLength > maximumBackgroundUploadBytes) {
    throw new WelcomeCardImageError("Upload a picture of at most 5 MB.");
  }

  const image = await loadImage(upload).catch(() => {
    throw new WelcomeCardImageError("That file is not a PNG, JPEG, or WebP picture.");
  });

  if (image.width < 200 || image.height < 100) {
    throw new WelcomeCardImageError("The picture must be at least 200 × 100 pixels.");
  }

  const { height, width } = welcomeCardSize;
  const canvas = createCanvas(width, height);
  drawCover(canvas.getContext("2d"), image, width, height);
  return canvas.toBuffer("image/jpeg", 88);
}
