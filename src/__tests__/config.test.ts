import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import config, { validateConfig } from "../config.js";

/** A minimally-valid config to mutate per test. */
function validBaseConfig(): typeof config {
  return {
    ...config,
    LUPOS_TOKEN: "test-token",
    DATABASE_URL: "mongodb://localhost:27017/lupos",
    SERVER_PORT: "1337",
  };
}

describe("validateConfig", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes with all required vars present", () => {
    expect(() => validateConfig(validBaseConfig())).not.toThrow();
  });

  it("throws naming LUPOS_TOKEN when it is missing", () => {
    const cfg = { ...validBaseConfig(), LUPOS_TOKEN: undefined };
    expect(() => validateConfig(cfg)).toThrow(/LUPOS_TOKEN/);
  });

  it("throws naming MONGO_URI when DATABASE_URL is missing", () => {
    const cfg = { ...validBaseConfig(), DATABASE_URL: undefined };
    expect(() => validateConfig(cfg)).toThrow(/MONGO_URI/);
  });

  it("throws naming LUPOS_BOT_PORT when SERVER_PORT is missing", () => {
    const cfg = { ...validBaseConfig(), SERVER_PORT: undefined };
    expect(() => validateConfig(cfg)).toThrow(/LUPOS_BOT_PORT/);
  });

  it("names every missing var in a single error", () => {
    const cfg = {
      ...validBaseConfig(),
      LUPOS_TOKEN: undefined,
      DATABASE_URL: undefined,
    };
    expect(() => validateConfig(cfg)).toThrow(/LUPOS_TOKEN.*MONGO_URI/);
  });

  it("throws when SERVER_PORT does not parse to a number", () => {
    const cfg = { ...validBaseConfig(), SERVER_PORT: "not-a-port" };
    expect(() => validateConfig(cfg)).toThrow(/LUPOS_BOT_PORT.*number/);
  });

  it("logs a notice (not an error) when optional MinIO vars are absent", () => {
    const cfg = {
      ...validBaseConfig(),
      MINIO_ENDPOINT: undefined,
      MINIO_ACCESS_KEY: undefined,
      MINIO_SECRET_KEY: undefined,
      MINIO_BUCKET_NAME: undefined,
    };
    expect(() => validateConfig(cfg)).not.toThrow();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("MINIO_"));
  });

  it("logs a notice when PRISM_SERVICE_URL is absent", () => {
    const cfg = { ...validBaseConfig(), PRISM_API_URL: undefined };
    expect(() => validateConfig(cfg)).not.toThrow();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("PRISM_SERVICE_URL"),
    );
  });
});
