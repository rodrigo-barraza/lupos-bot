// ============================================================
// String utilities — mention fixing, superscript, misc text.
// ============================================================

/**
 * Convert bare @SNOWFLAKE_ID patterns to proper Discord mention syntax.
 * The AI sometimes outputs "@124296008548089858" instead of "<@124296008548089858>".
 * It also sometimes drops the <@ prefix entirely, producing "166745313258897409>".
 * Discord snowflake IDs are 17-20 digit numbers.
 * Only matches patterns that are NOT already wrapped in <@...>.
 */
export function fixBareMentions(string: string) {
  // Pass 1: Fix orphaned "DIGITS>" — missing <@ prefix (e.g. "166745313258897409>")
  // Negative lookbehind ensures we don't re-wrap already-valid <@ID> mentions
  let result = string.replace(/(?<!<@!?)(?<!\d)(\d{17,20})>/g, "<@$1>");
  // Pass 2: Fix bare "@DIGITS" — missing angle brackets (e.g. "@166745313258897409")
  result = result.replace(/(?<!<)@(\d{17,20})(?!>)/g, "<@$1>");
  return result;
}

export function removeMentions(string: string) {
  return string
    .replace(/@here/g, "꩜here")
    .replace(/@everyone/g, "꩜everyone")
    .replace(/@horde/g, "꩜horde")
    .replace(/@alliance/g, "꩜alliance")
    .replace(/@Guild Leader - Horde/g, "꩜Guild Leader - Horde")
    .replace(/@Guild Leader - Alliance/g, "꩜Guild Leader - Alliance")
    .replace(/@Guild Officer - Horde/g, "꩜Guild Officer - Horde")
    .replace(/@Guild Officer - Alliance/g, "꩜Guild Officer - Alliance");
}

export function convertToSuperScript(string: string) {
  const superScriptMap: Record<string, string> = {
    0: "⁰",
    1: "¹",
    2: "²",
    3: "³",
    4: "⁴",
    5: "⁵",
    6: "⁶",
    7: "⁷",
    8: "⁸",
    9: "⁹",
    a: "ᵃ",
    b: "ᵇ",
    c: "ᶜ",
    d: "ᵈ",
    e: "ᵉ",
    f: "ᶠ",
    g: "ᵍ",
    h: "ʰ",
    i: "ⁱ",
    j: "ʲ",
    k: "ᵏ",
    l: "ˡ",
    m: "ᵐ",
    n: "ⁿ",
    o: "ᵒ",
    p: "ᵖ",
    q: "ᑫ",
    r: "ʳ",
    s: "ˢ",
    t: "ᵗ",
    u: "ᵘ",
    v: "ᵛ",
    w: "ʷ",
    x: "ˣ",
    y: "ʸ",
    z: "ᶻ",
    A: "ᴬ",
    B: "ᴮ",
    C: "ᶜ",
    D: "ᴰ",
    E: "ᴱ",
    F: "ᶠ",
    G: "ᴳ",
    H: "ᴴ",
    I: "ᴵ",
    J: "ᴶ",
    K: "ᴷ",
    L: "ᴸ",
    M: "ᴹ",
    N: "ᴺ",
    O: "ᴼ",
    P: "ᴾ",
    Q: "Q",
    R: "ᴿ",
    S: "ˢ",
    T: "ᵀ",
    U: "ᵁ",
    V: "ⱽ",
    W: "ᵂ",
    X: "ˣ",
    Y: "ʸ",
    Z: "ᶻ",
    "+": "⁺",
    "-": "⁻",
    "=": "⁼",
    "(": "⁽",
    ")": "⁾",
    ".": "˙",
    ",": "̓",
    " ": " ",
  };
  return string
    .split("")
    .map((char) => superScriptMap[char] || char)
    .join("");
}

/** Return a random wolf howl, e.g. "Awoooo!". */
export function howl() {
  let howl = "Aw";
  const randomize = Math.floor(Math.random() * 10) + 1;
  for (let i = 0; i < randomize; i++) {
    howl = howl + "o";
  }
  howl = howl + "!";
  return howl;
}
