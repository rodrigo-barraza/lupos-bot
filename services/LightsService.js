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
  static async _request(method, path, body = null) {
    try {
      const options = { method };
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

  static async getLights(lightId = "all") {
    return this._request("GET", `/lights/${lightId}`);
  }

  static async validateColor(color) {
    return this._request("GET", `/color/validate?color=${encodeURIComponent(color)}`);
  }

  static async setState(state, lightId = "all") {
    return this._request("PUT", `/lights/${lightId}/state`, {
      power: state?.power || "on",
      color: state?.color || "white",
      brightness: state?.brightness || 1,
      duration: state?.duration || 1,
      fast: state?.fast || true,
    });
  }

  static async setStateDelta(state, lightId = "all") {
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

  static async togglePower(lightId = "all", duration = 1) {
    return this._request("POST", `/lights/${lightId}/toggle`, { duration });
  }

  static async randomizeColor(lightId = "all", duration = 1) {
    return this._request("POST", `/lights/${lightId}/color/randomize`, { duration });
  }

  static async cycleColor(lightId = "all", style = "rainbow", duration = 0.3) {
    return this._request("POST", `/lights/${lightId}/color/cycle`, { style, duration });
  }
}
