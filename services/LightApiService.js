import config from "#root/config.js";

const { LIGHT_API_URL } = config;

export default class LightApiService {
  static currentColor = null;
  static colorIndex = 0;
  static currentStyle = null;

  static async getLights(lightId = "all") {
    try {
      const response = await fetch(`${LIGHT_API_URL}/lights/${lightId}`);
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("[LightApiService] getLights failed:", error.message);
      return null;
    }
  }

  static async validateColor(color) {
    try {
      const response = await fetch(
        `${LIGHT_API_URL}/color/validate?color=${encodeURIComponent(color)}`,
      );
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("[LightApiService] validateColor failed:", error.message);
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
      const response = await fetch(
        `${LIGHT_API_URL}/lights/${lightId}/state`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("[LightApiService] setState failed:", error.message);
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
        `${LIGHT_API_URL}/lights/${lightId}/state/delta`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("[LightApiService] setStateDelta failed:", error.message);
      return null;
    }
  }

  static async togglePower(lightId = "all", duration = 1) {
    try {
      const response = await fetch(
        `${LIGHT_API_URL}/lights/${lightId}/toggle`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ duration }),
        },
      );
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("[LightApiService] togglePower failed:", error.message);
      return null;
    }
  }

  static async randomizeColor(lightId = "all", duration = 1) {
    try {
      const response = await fetch(
        `${LIGHT_API_URL}/lights/${lightId}/color/randomize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ duration }),
        },
      );
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("[LightApiService] randomizeColor failed:", error.message);
      return null;
    }
  }

  static async cycleColor(lightId = "all", style = "rainbow", duration = 0.3) {
    try {
      const response = await fetch(
        `${LIGHT_API_URL}/lights/${lightId}/color/cycle`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ style, duration }),
        },
      );
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("[LightApiService] cycleColor failed:", error.message);
      return null;
    }
  }
}
