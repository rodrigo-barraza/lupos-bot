import config from "#root/config.js";

const { LIGHTS_SERVICE_URL } = config;

export default class LightsService {
  static currentColor = null;
  static colorIndex = 0;
  static currentStyle = null;

  /**
   * Shared HTTP helper — mirrors PrismService._request().
   * Returns parsed JSON on success, null on any failure.
   */
  static async _request(method: any, path: any, body: any = null) {
    try {
      const options: Record<string, any> = { method };
      if (body) {
        options.headers = { "Content-Type": "application/json" };
        options.body = JSON.stringify(body);
      }
      const response = await fetch(`${LIGHTS_SERVICE_URL}${path}`, options);
      return await response.json();
    } catch {
      return null;
    }
  }

  static async getLights(lightId: any = "all") {
    return this._request("GET", `/lights/${lightId}`);
  }

  static async validateColor(color: any) {
    return this._request("GET", `/color/validate?color=${encodeURIComponent(color)}`);
  }

  static async setState(state: any, lightId: any = "all") {
    return this._request("PUT", `/lights/${lightId}/state`, {
      power: state?.power || "on",
      color: state?.color || "white",
      brightness: state?.brightness || 1,
      duration: state?.duration || 1,
      fast: state?.fast || true,
    });
  }

  static async setStateDelta(state: any, lightId: any = "all") {
    return this._request("POST", `/lights/${lightId}/state/delta`, {
      power: state?.power || "on",
      duration: state?.duration || 1,
      hue: state?.hue || 0,
      saturation: state?.saturation || 1,
      brightness: state?.brightness || 1,
      kelvin: state?.kelvin || 2500,
      fast: state?.fast || false,
    });
  }

  static async togglePower(lightId: any = "all", duration: any = 1) {
    return this._request("POST", `/lights/${lightId}/toggle`, { duration });
  }

  static async randomizeColor(lightId: any = "all", duration: any = 1) {
    return this._request("POST", `/lights/${lightId}/color/randomize`, { duration });
  }

  static async cycleColor(lightId: any = "all", style: any = "rainbow", duration: any = 0.3) {
    return this._request("POST", `/lights/${lightId}/color/cycle`, { style, duration });
  }
}
