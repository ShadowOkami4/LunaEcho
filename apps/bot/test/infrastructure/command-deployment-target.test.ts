import { describe, expect, it } from "vitest";

import {
  CommandDeploymentTargetError,
  resolveCommandDeploymentTarget,
} from "../../src/infrastructure/discord/commands/command-deployment-target.js";

describe("resolveCommandDeploymentTarget", () => {
  it("uses the configured development guild by default", () => {
    expect(resolveCommandDeploymentTarget([], "123456789012345678")).toEqual({
      guildId: "123456789012345678",
      scope: "guild",
    });
  });

  it("requires an explicit flag for global deployment", () => {
    expect(resolveCommandDeploymentTarget(["--global"], undefined)).toEqual({
      scope: "global",
    });
  });

  it("refuses ambiguous or unknown deployment arguments", () => {
    expect(() => resolveCommandDeploymentTarget([], undefined)).toThrow(
      CommandDeploymentTargetError,
    );
    expect(() => resolveCommandDeploymentTarget(["--guild"], "123456789012345678")).toThrow(
      "Unknown argument",
    );
  });
});
