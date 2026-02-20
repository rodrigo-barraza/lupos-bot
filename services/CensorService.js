const FLAGGED_WORDS = [
    // Racial slurs
    "beaner", "chink", "coon", "gook", "honkey", "honky", "kike", 
    "nigger", "nigga", "niglet", "pajeet", "spic", "spick",
    "wetback", "wop", "dago", "polack", "kraut",
    "jap", "paki", "raghead", "towelhead", "redskin", "darkie",
    "pickaninny", "sambo", "jiggaboo", "porchmonkey", "zipperhead",
    
    // Homophobic slurs
    "fag", "faggot", "faggy", "faglord", "frociaggine", "dyke",
    "tranny", "trannies", "shemale",

    // Offensive terms
    "kys",
    
    // Mentally handicapped offensive terms
    // "retard", "retarded", "tard", "spaz", "spastic"
];

const WHITELISTED_WORDS = [
    "nigeria", "nigerian", "nigerians", "niger", "nigerien", "nigeriens",
    "snigger", "sniggered", "sniggering", "sniggers",
    "denigrate", "denigrated", "denigrating", "denigration", "denigrates",
    "enigma", "enigmas", "enigmatic", "enigmatically",
    "benign", "benignly", "benignant",
    "niggle", "niggled", "niggling", "niggles",
    "fagot", "fagots", "fagging",
    "raccoon", "raccoons",
    "cocoon", "cocoons", "cocooned", "cocooning",
    "tycoon", "tycoons",
    "despicable", "despicably",
    "spice", "spiced", "spices", "spicy", "spicier", "spiciest", "spicing",
    "auspicious", "auspiciously", "inauspicious",
    "conspicuous", "conspicuously", "inconspicuous",
    "auspices",
    "japan", "japanese", "japans",
    // "firecracker", "firecrackers",
    // "nutcracker", "nutcrackers",
    // "safecracker", "safecrackers",
    // "custard", "custards",
    // "mustard", "mustards", 
    // "leotard", "leotards",
    // "petard", "petards",
    // "unitard", "unitards",
    // "tardy", "tardiness", "tardiest"
];

const CHAR_SUBSTITUTIONS = {
    'a': '[a@4àáâãäåæ]',
    'b': '[b8ß]',
    'c': '[c(ç<]',
    'e': '[e3èéêë€]',
    'g': '[g69]',
    'i': '[i1!|ìíîïl]',
    'k': '[k]',
    'l': '[l1!|i]',
    'o': '[o0òóôõöø]',
    's': '[s$5zß]',
    't': '[t7+]',
    'u': '[uùúûüv]',
    'n': '[nñ]',
    'r': '[rŕř]',
    'y': '[yýÿ]',
};

/**
 * Get the full word containing a match
 */
function getFullWord(text, matchIndex, matchLength) {
    let wordStart = matchIndex;
    let wordEnd = matchIndex + matchLength;
    
    while (wordStart > 0 && /[a-zA-Z]/.test(text[wordStart - 1])) {
        wordStart--;
    }
    while (wordEnd < text.length && /[a-zA-Z]/.test(text[wordEnd])) {
        wordEnd++;
    }
    
    return text.slice(wordStart, wordEnd).toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Creates a regex pattern that catches common evasion techniques
 */
function createEvasionPattern(word) {
    let pattern = '';
    const chars = word.toLowerCase().split('');
    
    for (let i = 0; i < chars.length; i++) {
        const char = chars[i];
        const substitution = CHAR_SUBSTITUTIONS[char] || char;
        pattern += `${substitution}+`;
        
        if (i < chars.length - 1) {
            pattern += '[._\\*=]*';
            // pattern += '[._\\-*=]*';
        }
    }
    
    return pattern;
}

/**
 * Removes/censors flagged words from a string
 * NOW: Catches slurs embedded in non-whitelisted words
 */
function removeFlaggedWords(string) {
    let result = string;
    
    for (const word of FLAGGED_WORDS) {
        const pattern = createEvasionPattern(word);
        // NO word boundary requirement - match slurs anywhere
        const regex = new RegExp(pattern, 'gi');
        
        // Find all matches first
        const matches = [];
        let match;
        
        while ((match = regex.exec(result)) !== null) {
            matches.push({
                index: match.index,
                text: match[0]
            });
        }
        
        // Process in reverse order to keep indices valid
        for (let i = matches.length - 1; i >= 0; i--) {
            const m = matches[i];
            const fullWord = getFullWord(result, m.index, m.text.length);
            
            // Only censor if the full word is NOT whitelisted
            if (!WHITELISTED_WORDS.includes(fullWord)) {
                result = 
                    result.slice(0, m.index) + 
                    `||${'*'.repeat(m.text.length)}||` + 
                    result.slice(m.index + m.text.length);
            }
        }
    }
    
    return result;
}

/**
 * Check if string contains any flagged words
 */
function containsFlaggedWords(string) {
    for (const word of FLAGGED_WORDS) {
        const pattern = createEvasionPattern(word);
        const regex = new RegExp(pattern, 'gi');
        
        let match;
        while ((match = regex.exec(string)) !== null) {
            const fullWord = getFullWord(string, match.index, match[0].length);
            if (!WHITELISTED_WORDS.includes(fullWord)) {
                return true;
            }
        }
    }
    return false;
}

console.log(removeFlaggedWords("retarded"));

const CensorService = {
    removeFlaggedWords,
    containsFlaggedWords
};

module.exports = CensorService;
