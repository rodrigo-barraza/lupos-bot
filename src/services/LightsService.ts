import { createApiClient } from "@rodrigo-barraza/utilities-library/http";

import config from "#root/config.ts";

const { LIGHTS_SERVICE_URL } = config;

const lightsApi = createApiClient(LIGHTS_SERVICE_URL ?? "");

export interface LightState {
  power?: string;
  color?: string;
  brightness?: number;
  duration?: number;
  fast?: boolean;
}

export interface LightStateDelta {
  power?: string;
  duration?: number;
  hue?: number;
  saturation?: number;
  brightness?: number;
  kelvin?: number;
  fast?: boolean;
}

export default class LightsService {
  static currentColor: unknown = null;
  static colorIndex: number = 0;
  static currentStyle: unknown = null;

  /**
   * Shared HTTP helper — mirrors PrismService._request().
   * Returns parsed JSON on success, null on any failure.
   */
  static async _request(
    method: string,
    path: string,
    body: unknown = null,
  ): Promise<unknown> {
    try {
      const result = await lightsApi.request(path, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return result ?? null;
    } catch {
      return null;
    }
  }

  static async getLights(lightId: string = "all"): Promise<unknown> {
    return this._request("GET", `/lights/${lightId}`);
  }

  static async validateColor(color: string): Promise<unknown> {
    return this._request(
      "GET",
      `/color/validate?color=${encodeURIComponent(color)}`,
    );
  }

  static async setState(
    state: LightState,
    lightId: string = "all",
  ): Promise<unknown> {
    return this._request("PUT", `/lights/${lightId}/state`, {
      power: state?.power ?? "on",
      color: state?.color ?? "white",
      brightness: state?.brightness ?? 1,
      duration: state?.duration ?? 1,
      fast: state?.fast ?? true,
    });
  }

  static async setStateDelta(
    state: LightStateDelta,
    lightId: string = "all",
  ): Promise<unknown> {
    return this._request("POST", `/lights/${lightId}/state/delta`, {
      power: state?.power ?? "on",
      duration: state?.duration ?? 1,
      hue: state?.hue ?? 0,
      saturation: state?.saturation ?? 1,
      brightness: state?.brightness ?? 1,
      kelvin: state?.kelvin ?? 2500,
      fast: state?.fast ?? false,
    });
  }

  static async togglePower(
    lightId: string = "all",
    duration: number = 1,
  ): Promise<unknown> {
    return this._request("POST", `/lights/${lightId}/toggle`, { duration });
  }

  static async randomizeColor(
    lightId: string = "all",
    duration: number = 1,
  ): Promise<unknown> {
    return this._request("POST", `/lights/${lightId}/color/randomize`, {
      duration,
    });
  }

  static async cycleColor(
    lightId: string = "all",
    style: string = "rainbow",
    duration: number = 0.3,
  ): Promise<unknown> {
    return this._request("POST", `/lights/${lightId}/color/cycle`, {
      style,
      duration,
    });
  }
}
