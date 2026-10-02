import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { DatabaseConnection } from "@lunaecho/db";
import { createTestDatabase, resetTestDatabase } from "@lunaecho/db/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  defaultWelcomeCard,
  prepareWelcomeCardBackground,
  renderWelcomeCard,
  renderWelcomeCardText,
  WelcomeCardImageError,
  WelcomeCardInputError,
  WelcomeCardService,
  welcomeCardSize,
} from "../src/index.js";

function picture(width: number, height: number, color = "#3366ff"): Buffer {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = color;
  context.fillRect(0, 0, width, height);
  return canvas.toBuffer("image/png");
}

const content = { displayName: "alice", subtitle: "Member #12 of Luna", title: "Welcome, alice!" };

describe("renderWelcomeCard", () => {
  it("draws a PNG card in both layouts, with and without an avatar", async () => {
    for (const layout of ["centered", "left"] as const) {
      for (const avatar of [undefined, picture(128, 128)]) {
        const png = await renderWelcomeCard({
          content: { ...content, avatar },
          design: { ...defaultWelcomeCard, layout },
        });
        const image = await loadImage(png);

        expect([image.width, image.height]).toEqual([
          welcomeCardSize.width,
          welcomeCardSize.height,
        ]);
      }
    }
  });

  it("falls back to a preset when the image background is missing or broken", async () => {
    const png = await renderWelcomeCard({
      backgroundImage: new Uint8Array([1, 2, 3]),
      content: { ...content, avatar: new Uint8Array([9, 9, 9]) },
      design: { ...defaultWelcomeCard, background: "image" },
    });

    expect((await loadImage(png)).width).toBe(welcomeCardSize.width);
  });

  it("fits very long names instead of overflowing", async () => {
    const png = await renderWelcomeCard({
      content: { ...content, title: `Welcome, ${"x".repeat(200)}!` },
      design: defaultWelcomeCard,
    });

    expect(png.byteLength).toBeGreaterThan(1_000);
  });
});

describe("prepareWelcomeCardBackground", () => {
  it("crops any picture to the card size and re-encodes it as JPEG", async () => {
    const prepared = await prepareWelcomeCardBackground(picture(1920, 1080));
    const image = await loadImage(prepared);

    expect([image.width, image.height]).toEqual([welcomeCardSize.width, welcomeCardSize.height]);
    expect([...prepared.subarray(0, 2)]).toEqual([0xff, 0xd8]);
  });

  it("rejects files that are not pictures, and tiny pictures", async () => {
    await expect(
      prepareWelcomeCardBackground(new TextEncoder().encode("<svg onload=alert(1)>")),
    ).rejects.toBeInstanceOf(WelcomeCardImageError);
    await expect(prepareWelcomeCardBackground(picture(50, 50))).rejects.toBeInstanceOf(
      WelcomeCardImageError,
    );
  });
});

describe("renderWelcomeCardText", () => {
  it("never produces a mention, because a picture cannot ping", () => {
    expect(
      renderWelcomeCardText("Hi {user} / {username} on {server} (#{memberCount})", {
        displayName: "alice",
        memberCount: 1234,
        serverName: "Luna",
      }),
    ).toBe("Hi alice / alice on Luna (#1,234)");
  });
});

describe("WelcomeCardService", () => {
  let connection: DatabaseConnection;
  let service: WelcomeCardService;

  beforeAll(async () => {
    connection = await createTestDatabase();
    service = new WelcomeCardService(connection.db);
  });

  afterEach(async () => {
    await resetTestDatabase(connection.db);
  });

  afterAll(async () => {
    await connection.close();
  });

  it("starts with the defaults and stores a design", async () => {
    await expect(service.get("guild-1")).resolves.toMatchObject({
      hasBackgroundImage: false,
      welcomeEnabled: false,
    });

    await service.save(
      {
        ...(await service.get("guild-1")),
        accentColor: "#9ECFFF",
        welcomeEnabled: true,
        welcomeTitle: "  Hello {username}  ",
      },
      "admin",
    );

    await expect(service.get("guild-1")).resolves.toMatchObject({
      accentColor: "#9ecfff",
      welcomeEnabled: true,
      welcomeTitle: "Hello {username}",
    });
  });

  it("keeps the uploaded background when the design changes, and removes it on request", async () => {
    const image = await prepareWelcomeCardBackground(picture(800, 400));
    await service.setBackgroundImage("guild-1", image, "admin");

    await expect(service.get("guild-1")).resolves.toMatchObject({
      background: "image",
      hasBackgroundImage: true,
    });

    await service.save({ ...(await service.get("guild-1")), overlayOpacity: 40 }, "admin");
    expect((await service.getBackgroundImage("guild-1"))?.byteLength).toBe(image.byteLength);

    await service.setBackgroundImage("guild-1", null, "admin");
    await expect(service.get("guild-1")).resolves.toMatchObject({
      background: "luna",
      hasBackgroundImage: false,
    });
  });

  it("rejects bad colours, empty titles, and too much darkening", async () => {
    const settings = await service.get("guild-1");

    for (const bad of [
      { accentColor: "pink" },
      { welcomeTitle: " " },
      { overlayOpacity: 95 },
      { textColor: "#fff" },
    ]) {
      await expect(service.save({ ...settings, ...bad }, "admin")).rejects.toBeInstanceOf(
        WelcomeCardInputError,
      );
    }
  });
});
