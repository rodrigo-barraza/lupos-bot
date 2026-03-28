import config from "#root/config.js";

const TREND_API_BASE_URL = config.TREND_API_URL || "http://localhost:5570";
const PRODUCT_API_BASE_URL = config.PRODUCT_API_URL || "http://localhost:5560";
const EVENT_API_BASE_URL = config.EVENT_API_URL || "http://localhost:5556";
const WEATHER_API_BASE_URL = config.WEATHER_API_URL || "http://localhost:5555";

const CACHE_TTL_MS = 1 * 60 * 1000; // 1 minutes
const FETCH_TIMEOUT_MS = 3000; // 3 seconds

// ─── In-Memory Cache ───────────────────────────────────────────────

const cache = {
  trends: { data: null, fetchedAt: 0 },
  products: { data: null, fetchedAt: 0 },
  events: { data: null, fetchedAt: 0 },
  earthquakes: { data: null, fetchedAt: 0 },
  neo: { data: null, fetchedAt: 0 },
  spaceWeather: { data: null, fetchedAt: 0 },
  iss: { data: null, fetchedAt: 0 },
  wildfires: { data: null, fetchedAt: 0 },
};

function isCacheValid(key) {
  return (
    cache[key].data !== null && Date.now() - cache[key].fetchedAt < CACHE_TTL_MS
  );
}

// ─── Fetch Helpers ─────────────────────────────────────────────────

async function fetchWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Individual Fetchers ───────────────────────────────────────────

async function fetchTrends() {
  if (isCacheValid("trends")) return cache.trends.data;
  try {
    const data = await fetchWithTimeout(
      `${TREND_API_BASE_URL}/trends/top?limit=10`,
    );
    if (data?.trends?.length) {
      cache.trends = { data: data.trends, fetchedAt: Date.now() };
      return data.trends;
    }
  } catch {
    // silently fail
  }
  return cache.trends.data;
}

async function fetchProducts() {
  if (isCacheValid("products")) return cache.products.data;
  try {
    const data = await fetchWithTimeout(
      `${PRODUCT_API_BASE_URL}/products/trending?limit=5`,
    );
    if (data?.products?.length) {
      cache.products = { data: data.products, fetchedAt: Date.now() };
      return data.products;
    }
  } catch {
    // silently fail
  }
  return cache.products.data;
}

async function fetchEvents() {
  if (isCacheValid("events")) return cache.events.data;
  try {
    const data = await fetchWithTimeout(`${EVENT_API_BASE_URL}/events/today`);
    if (data?.events?.length) {
      cache.events = { data: data.events, fetchedAt: Date.now() };
      return data.events;
    }
  } catch {
    // silently fail
  }
  return cache.events.data;
}

async function fetchEarthquakes() {
  if (isCacheValid("earthquakes")) return cache.earthquakes.data;
  try {
    const data = await fetchWithTimeout(`${WEATHER_API_BASE_URL}/earthquakes`);
    if (Array.isArray(data) && data.length) {
      // Filter to M1.0+ only
      const significant = data.filter((q) => (q.magnitude || 0) >= 1.0);
      cache.earthquakes = { data: significant, fetchedAt: Date.now() };
      return significant;
    }
  } catch {
    // silently fail
  }
  return cache.earthquakes.data;
}

async function fetchNeo() {
  if (isCacheValid("neo")) return cache.neo.data;
  try {
    const data = await fetchWithTimeout(`${WEATHER_API_BASE_URL}/neo`);
    if (Array.isArray(data) && data.length) {
      cache.neo = { data, fetchedAt: Date.now() };
      return data;
    }
  } catch {
    // silently fail
  }
  return cache.neo.data;
}

async function fetchSpaceWeather() {
  if (isCacheValid("spaceWeather")) return cache.spaceWeather.data;
  try {
    const data = await fetchWithTimeout(
      `${WEATHER_API_BASE_URL}/space-weather`,
    );
    if (data) {
      cache.spaceWeather = { data, fetchedAt: Date.now() };
      return data;
    }
  } catch {
    // silently fail
  }
  return cache.spaceWeather.data;
}

async function fetchIss() {
  if (isCacheValid("iss")) return cache.iss.data;
  try {
    const data = await fetchWithTimeout(`${WEATHER_API_BASE_URL}/iss`);
    if (data) {
      cache.iss = { data, fetchedAt: Date.now() };
      return data;
    }
  } catch {
    // silently fail
  }
  return cache.iss.data;
}

async function fetchWildfires() {
  if (isCacheValid("wildfires")) return cache.wildfires.data;
  try {
    const data = await fetchWithTimeout(`${WEATHER_API_BASE_URL}/wildfires`);
    if (data?.events?.length) {
      // Filter to significant fires (>1000 acres)
      const major = data.events.filter((f) => (f.magnitudeValue || 0) >= 1000);
      cache.wildfires = { data: major, fetchedAt: Date.now() };
      return major;
    }
  } catch {
    // silently fail
  }
  return cache.wildfires.data;
}

// ─── Summary Formatters ────────────────────────────────────────────

function formatTrends(trends) {
  if (!trends?.length) return "";
  let s =
    "\n\n# What's trending right now\nTop trending topics across Google Trends, Google News, Reddit, Wikipedia, Hacker News, and Mastodon.";
  for (const trend of trends) {
    const source = trend.source || "unknown";
    const volume = trend.volume ? ` (${trend.volume.toLocaleString()})` : "";
    s += `\n- ${trend.name}${volume} [${source}]`;
  }
  return s;
}

function formatProducts(products) {
  if (!products?.length) return "";
  let s = "\n\n# Trending products\nThe hottest-selling products right now.";
  for (const product of products) {
    const price = product.price ? ` — $${product.price.toFixed(2)}` : "";
    const cat = product.category ? ` (${product.category})` : "";
    s += `\n- ${product.name}${price}${cat}`;
  }
  return s;
}

function formatEvents(events) {
  if (!events?.length) return "";
  let s =
    "\n\n# Local events happening today\nEvents happening today in the local area (Vancouver, BC).";
  for (const event of events) {
    const venue = event.venue?.name ? ` at ${event.venue.name}` : "";
    s += `\n- ${event.name}${venue}`;
  }
  return s;
}

function formatEarthquakes(quakes) {
  if (!quakes?.length) return "";
  const sorted = [...quakes].sort(
    (a, b) => (b.magnitude || 0) - (a.magnitude || 0),
  );
  const top = sorted.slice(0, 8);
  let s = `\n\n# Recent earthquakes (M1.0+)\n${quakes.length} earthquakes detected recently.`;
  for (const q of top) {
    const mag = q.magnitude || "?";
    const cls = q.magnitudeClass || "";
    const place = q.place || "Unknown location";
    const tsunami = q.tsunami ? " ⚠️ TSUNAMI WARNING" : "";
    s += `\n- M${mag} (${cls}) — ${place}${tsunami}`;
  }
  return s;
}

function formatNeo(neos) {
  if (!neos?.length) return "";
  const hazardous = neos.filter((n) => n.isPotentiallyHazardous);
  const closest = [...neos]
    .sort(
      (a, b) =>
        parseFloat(a.missDistanceKm || 0) - parseFloat(b.missDistanceKm || 0),
    )
    .slice(0, 5);
  let s = `\n\n# Near-Earth objects today\n${neos.length} asteroids passing near Earth today, ${hazardous.length} classified as potentially hazardous.`;
  for (const n of closest) {
    const name = n.name || "Unknown";
    const hazard = n.isPotentiallyHazardous ? " ⚠️ HAZARDOUS" : "";
    const distKm = parseFloat(n.missDistanceKm || 0);
    const distLunar = parseFloat(n.missDistanceLunar || 0);
    const speed = parseFloat(n.relativeVelocityKmPerHour || 0);
    const diamMin = Math.round((n.estimatedDiameterMinKm || 0) * 1000);
    const diamMax = Math.round((n.estimatedDiameterMaxKm || 0) * 1000);
    s += `\n- ${name}${hazard} — ${distKm.toLocaleString()} km (${distLunar.toFixed(1)} lunar dist), ${diamMin}-${diamMax}m, ${speed.toLocaleString()} km/h`;
  }
  return s;
}

function formatSpaceWeather(sw) {
  if (!sw) return "";
  const flares = sw.flares || [];
  const cmes = sw.cmes || [];
  const storms = sw.storms || [];
  if (!flares.length && !cmes.length && !storms.length) return "";

  let s = `\n\n# Space weather\n${flares.length} solar flares, ${cmes.length} coronal mass ejections, ${storms.length} geomagnetic storm(s) tracked.`;
  if (flares.length) {
    const recent = flares.slice(-3);
    for (const f of recent) {
      const cls = f.classType || "?";
      const time = f.beginTime
        ? new Date(f.beginTime).toLocaleDateString()
        : "?";
      s += `\n- ${cls} solar flare on ${time}`;
    }
  }
  if (storms.length) {
    for (const st of storms.slice(0, 3)) {
      const kp = st.kpIndex || "?";
      s += `\n- Geomagnetic storm (Kp ${kp})`;
    }
  }
  return s;
}

function formatIss(iss) {
  if (!iss) return "";
  const pos = iss.position || {};
  const astros = iss.astronauts || {};
  const people = astros.people || [];
  if (!people.length && !pos.latitude) return "";

  let s = "\n\n# International Space Station";
  if (pos.latitude !== undefined) {
    s += `\nCurrently at ${pos.latitude}°, ${pos.longitude}°.`;
  }
  if (people.length) {
    const byStation = {};
    for (const p of people) {
      const craft = p.craft || "ISS";
      if (!byStation[craft]) byStation[craft] = [];
      byStation[craft].push(p.name);
    }
    for (const [craft, names] of Object.entries(byStation)) {
      s += `\n- ${craft} (${names.length}): ${names.join(", ")}`;
    }
  }
  return s;
}

function formatWildfires(fires) {
  if (!fires?.length) return "";
  const sorted = [...fires].sort(
    (a, b) => (b.magnitudeValue || 0) - (a.magnitudeValue || 0),
  );
  const top = sorted.slice(0, 5);
  let s = `\n\n# Active wildfires (>1,000 acres)\n${fires.length} significant wildfires currently active.`;
  for (const f of top) {
    const title = f.title || "Unknown";
    const acres = f.magnitudeValue
      ? ` — ${f.magnitudeValue.toLocaleString()} acres`
      : "";
    s += `\n- ${title}${acres}`;
  }
  return s;
}

// ─── Public API ────────────────────────────────────────────────────

export default class TrendsService {
  /**
   * Fetches trending data from all sources and returns a formatted
   * string suitable for injection into the system prompt.
   * Returns null if all sources are unavailable.
   * @returns {Promise<string|null>}
   */
  static async getTrendingSummary() {
    const [
      trends,
      products,
      events,
      earthquakes,
      neo,
      spaceWeather,
      iss,
      wildfires,
    ] = await Promise.all([
      fetchTrends(),
      fetchProducts(),
      fetchEvents(),
      fetchEarthquakes(),
      fetchNeo(),
      fetchSpaceWeather(),
      fetchIss(),
      fetchWildfires(),
    ]);

    const hasAny =
      trends ||
      products ||
      events ||
      earthquakes ||
      neo ||
      spaceWeather ||
      iss ||
      wildfires;
    if (!hasAny) return null;

    let summary = "";
    summary += formatTrends(trends);
    summary += formatProducts(products);
    summary += formatEvents(events);
    summary += formatEarthquakes(earthquakes);
    summary += formatNeo(neo);
    summary += formatSpaceWeather(spaceWeather);
    summary += formatIss(iss);
    summary += formatWildfires(wildfires);

    return summary || null;
  }
}
