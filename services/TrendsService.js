import config from "#root/secrets.js";
import utilities from "#root/utilities.js";

const TREND_API_BASE_URL = config.TREND_API_URL || "http://localhost:5570";
const PRODUCT_API_BASE_URL = config.PRODUCT_API_URL || "http://localhost:5560";
const EVENT_API_BASE_URL = config.EVENT_API_URL || "http://localhost:5556";
const WEATHER_API_BASE_URL = config.WEATHER_API_URL || "http://localhost:5555";

const CACHE_TTL_MS = 1 * 60 * 1000; // 1 minute

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

const fetchWithTimeout = utilities.fetchWithTimeout;

/**
 * Generic cached-fetch helper.
 * @param {string} cacheKey   - Key in the cache object
 * @param {string} url        - URL to fetch
 * @param {function} extract  - (data) => value | null — extracts the useful data from the response
 * @param {function} [transform] - (extracted) => transformed — optional post-processing
 */
async function cachedFetch(cacheKey, url, extract, transform = null) {
  if (isCacheValid(cacheKey)) return cache[cacheKey].data;
  try {
    const data = await fetchWithTimeout(url);
    const extracted = extract(data);
    if (extracted) {
      const result = transform ? transform(extracted) : extracted;
      cache[cacheKey] = { data: result, fetchedAt: Date.now() };
      return result;
    }
  } catch {
    // silently fail — return stale cache
  }
  return cache[cacheKey].data;
}

// ─── Individual Fetchers ───────────────────────────────────────────

function fetchTrends() {
  return cachedFetch("trends", `${TREND_API_BASE_URL}/trends/top?limit=10`, (d) => d?.trends?.length ? d.trends : null);
}

function fetchProducts() {
  return cachedFetch("products", `${PRODUCT_API_BASE_URL}/products/trending?limit=5`, (d) => d?.products?.length ? d.products : null);
}

function fetchEvents() {
  return cachedFetch("events", `${EVENT_API_BASE_URL}/events/today`, (d) => d?.events?.length ? d.events : null);
}

function fetchEarthquakes() {
  return cachedFetch(
    "earthquakes",
    `${WEATHER_API_BASE_URL}/earthquakes`,
    (d) => Array.isArray(d) && d.length ? d : null,
    (quakes) => quakes.filter((q) => (q.magnitude || 0) >= 1.0),
  );
}

function fetchNeo() {
  return cachedFetch("neo", `${WEATHER_API_BASE_URL}/neo`, (d) => Array.isArray(d) && d.length ? d : null);
}

function fetchSpaceWeather() {
  return cachedFetch("spaceWeather", `${WEATHER_API_BASE_URL}/space-weather`, (d) => d || null);
}

function fetchIss() {
  return cachedFetch("iss", `${WEATHER_API_BASE_URL}/iss`, (d) => d || null);
}

function fetchWildfires() {
  return cachedFetch(
    "wildfires",
    `${WEATHER_API_BASE_URL}/wildfires`,
    (d) => d?.events?.length ? d.events : null,
    (fires) => fires.filter((f) => (f.magnitudeValue || 0) >= 1000),
  );
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
