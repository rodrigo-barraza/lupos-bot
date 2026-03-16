import config from "#root/config.js";

const { LIFX_TOKEN } = config;

export default class LightService {
  static currentColor = null;
  static colorIndex = 0;
  static currentStyle = null;

  static async validateColor(color) {
    const response = await fetch(
      `https://api.lifx.com/v1/color?string=${color}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${LIFX_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );
    const data = await response.json();
    return data;
  }

  static async getLights(lightId = "all") {
    const response = await fetch(`https://api.lifx.com/v1/lights/${lightId}`, {
      headers: {
        Authorization: `Bearer ${LIFX_TOKEN}`,
        "Content-Type": "application/json",
      },
    });
    const data = await response.json();
    return data;
  }

  static async setState(state, lightId = "all") {
    const body = {
      power: state?.power || "on",
      color: state?.color || "white",
      brightness: state?.brightness || 1,
      duration: state?.duration || 1,
      fast: state?.fast || true,
    };
    const response = await fetch(
      `https://api.lifx.com/v1/lights/${lightId}/state`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${LIFX_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    if (response.status === 202) {
      return true;
    }

    const data = await response.json();
    return data;
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
    const response = await fetch(
      `https://api.lifx.com/v1/lights/${lightId}/state/delta`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LIFX_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    const data = await response.json();
    return data;
  }

  static async togglePower(lightId = "all", duration = 1) {
    const body = {
      duration: duration,
    };
    const response = await fetch(
      `https://api.lifx.com/v1/lights/${lightId}/toggle`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LIFX_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    const data = await response.json();
    return data;
  }

  static async randomizeColor(lightId = "all", duration = 1) {
    const colors = [
      "#800080",
      "#FF0000",
      "#FFA500",
      "#FFFF00",
      "#008000",
      "#0000FF",
      "#4B0082",
      "#FF00FF",
      "#00FFFF",
      "#FF0000",
      "#00FF00",
      "#0000FF",
      "#FFFF00",
      "#FF4500",
      "#9400D3",
      "#00CED1",
      "#FF1493",
      "#32CD32",
      "#FF8C00",
    ];

    if (!LightService.currentColor) {
      LightService.currentColor =
        colors[Math.floor(Math.random() * colors.length)];
    }

    try {
      const availableColors = colors.filter(
        (color) => color !== LightService.currentColor,
      );
      const randomIndex = Math.floor(Math.random() * availableColors.length);
      const newColor = availableColors[randomIndex];

      await LightService.setState(
        { color: newColor, duration: duration },
        lightId,
      );
      LightService.currentColor = newColor;
    } catch (error) {
      console.error("Error randomizing color:", error);
    }
  }

  static async cycleColor(lightId = "all", style = "rainbow", duration = 0.3) {
    const newRainbowColors = [
      "#ff1200", "#ff3200", "#ff4800", "#ff6300", "#ff7f00",
      "#ff9500", "#ffa600", "#ffa900", "#ffbd00", "#ffe200",
      "#fff000", "#fffa00", "#f7fd09", "#e8ff00", "#d4ff00",
      "#b7ff00", "#9aff00", "#7dff00", "#60ff00", "#43ff00",
      "#26ff00", "#00ff00", "#00ff26", "#00ff4d", "#00ff73",
      "#00ff99", "#00ffbf", "#00ffe6", "#00f4ff", "#00d4ff",
      "#00b4ff", "#0094ff", "#0074ff", "#0054ff", "#0033ff",
      "#1a00ff", "#3300ff", "#4d00ff", "#6600ff", "#8000ff",
      "#9900ff", "#b300ff", "#cc00ff", "#e600ff", "#ff00ff",
      "#ff00e6", "#ff00cc", "#ff00c7", "#ff0022", "#ff0019",
    ];

    const purpleColors = [
      "#191970", "#2E0854", "#4B0082", "#483D8B", "#4C2882",
      "#5B2C6F", "#663399", "#6A0DAD", "#702963", "#800080",
      "#8B008B", "#892B64", "#8E4585", "#9932CC", "#9B30FF",
      "#BA55D3", "#B03060", "#C71585", "#CD2990", "#D02090",
      "#DB7093",
    ];

    const greenColors = [
      "#0B3D0B", "#013220", "#006400", "#0F4C0F", "#1B4D1B",
      "#228B22", "#2E7D32", "#355E3B", "#3D8B37", "#4B7C4B",
      "#2F4F2F", "#2E8B57", "#3B7F5F", "#008080", "#008B8B",
      "#4A5D23", "#556B2F", "#6B8E23", "#708238", "#7C9051",
    ];

    const redColors = [
      "#4B0013", "#5C0120", "#722F37", "#800020", "#8B0000",
      "#A52A2A", "#B22222", "#C21E56", "#CD212A", "#DC143C",
      "#A0522D", "#B22222", "#C65D00", "#CC4125", "#CD5C5C",
      "#CC5500", "#D2691E", "#D97700", "#E25822", "#FF8C00",
    ];

    let colors;
    if (style === "rainbow") {
      colors = newRainbowColors;
    } else if (style === "purples") {
      colors = purpleColors;
    } else if (style === "greens") {
      colors = greenColors;
    } else if (style === "reds") {
      colors = redColors;
    } else {
      console.error(
        'Invalid style. Use "rainbow", "purples", "greens", or "reds".',
      );
      return;
    }

    if (!LightService.currentStyle || LightService.currentStyle !== style) {
      LightService.colorIndex = 0;
      LightService.currentStyle = style;
    }

    try {
      const color = colors[LightService.colorIndex];
      await LightService.setState(
        { color: color, duration: duration },
        lightId,
      );
      LightService.colorIndex =
        (LightService.colorIndex + 1) % colors.length;
    } catch (error) {
      console.error("Error cycling color:", error);
    }
  }
}
