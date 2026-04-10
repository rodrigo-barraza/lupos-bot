import config from "#root/secrets.js";

const { LIGHTS_URL } = config;

export default class LightsService {
  static currentColor = null;
  static colorIndex = 0;
  static currentStyle = null;

  static async getLights(lightId = "all") {
    try {
      const response = await fetch(`${LIGHTS_URL}/lights/${lightId}`);
      const data = await response.json();
      return data;
    } catch {
      return null;
    }
  }

  static async validateColor(color) {
    try {
      const response = await fetch(
        `${LIGHTS_URL}/color/validate?color=${encodeURIComponent(color)}`,
      );
      const data = await response.json();
      return data;
    } catch {
      return null;
    }
  }

  static async setState(state, lightId = "all") {
    const body = {
      power: state?.power || "on",
      color: state?.color || "white",
      brightness: state?.brightness || 1,
      duration: state?.duration || 1,
      fast: state?.fast || true,
    };
    try {
      const response = await fetch(`${LIGHTS_URL}/lights/${lightId}/state`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      return data;
    } catch {
      return null;
    }
  }

  static async setStateDelta(state, lightId = "all") {
    const body = {
      power: state?.power || "on",
      duration: state?.duration || 1,
      hue: state?.hue || 0,
      saturation: state?.saturation || 1,
      brightness: state?.brightness || 1,
      kelvin: state?.kelvin || 2500,
      fast: state?.fast || false,
    };
    try {
      const response = await fetch(
        `${LIGHTS_URL}/lights/${lightId}/state/delta`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await response.json();
      return data;
    } catch {
      return null;
    }
  }

  static async togglePower(lightId = "all", duration = 1) {
    try {
      const response = await fetch(`${LIGHTS_URL}/lights/${lightId}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration }),
      });
      const data = await response.json();
      return data;
    } catch {
      return null;
    }
  }

  static async randomizeColor(lightId = "all", duration = 1) {
    try {
      const response = await fetch(
        `${LIGHTS_URL}/lights/${lightId}/color/randomize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ duration }),
        },
      );
      const data = await response.json();
      return data;
    } catch {
      return null;
    }
  }

  static async cycleColor(lightId = "all", style = "rainbow", duration = 0.3) {
    try {
      const response = await fetch(
        `${LIGHTS_URL}/lights/${lightId}/color/cycle`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ style, duration }),
        },
      );
      const data = await response.json();
      return data;
    } catch {
      // Silently ignore — lights API may be offline
      return null;
    }
  }
}
