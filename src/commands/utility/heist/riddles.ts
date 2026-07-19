/**
 * The wolf's riddle bank for the heist's riddle stage.
 * Judged locally by heistMath.matchesRiddleAnswer — answers list every
 * accepted phrasing. Keep answers single concrete nouns where possible.
 */

export interface HeistRiddle {
  riddle: string;
  answers: string[];
}

export const HEIST_RIDDLES: HeistRiddle[] = [
  {
    riddle:
      "I follow you all day in the sun, and drown in the dark. The wolf has one too. What am I?",
    answers: ["shadow", "a shadow", "your shadow"],
  },
  {
    riddle: "The more you take from me, the bigger I get. What am I?",
    answers: ["hole", "a hole"],
  },
  {
    riddle:
      "I have teeth but never bite, and I'm lost more often than I'm used. What am I?",
    answers: ["comb", "a comb"],
  },
  {
    riddle: "I speak without a mouth and hear without ears. What am I?",
    answers: ["echo", "an echo"],
  },
  {
    riddle:
      "I'm always hungry and must be fed; the finger I touch will soon turn red. What am I?",
    answers: ["fire", "flame"],
  },
  {
    riddle: "What has a bed but never sleeps, and runs but never walks?",
    answers: ["river", "a river"],
  },
  {
    riddle: "I get wetter the more I dry. What am I?",
    answers: ["towel", "a towel"],
  },
  {
    riddle:
      "I have keys but open no locks, space but no rooms, and you can enter but not go in. What am I?",
    answers: ["keyboard", "a keyboard"],
  },
  {
    riddle: "What can you keep after giving it to someone?",
    answers: ["your word", "word", "a promise", "promise"],
  },
  {
    riddle: "The more of me there is, the less you see. What am I?",
    answers: ["darkness", "the dark", "fog"],
  },
  {
    riddle:
      "I'm not alive, but I grow. I don't have lungs, but I need air. What am I?",
    answers: ["fire", "flame"],
  },
  {
    riddle: "What has hands but cannot hold the wolf's gold?",
    answers: ["clock", "a clock", "watch"],
  },
  {
    riddle: "Feed me and I live, give me a drink and I die. What am I?",
    answers: ["fire", "flame"],
  },
  {
    riddle: "What goes up but never comes down?",
    answers: ["age", "your age"],
  },
  {
    riddle:
      "I have a head and a tail but no body — and the wolf hoards thousands of me. What am I?",
    answers: ["coin", "a coin", "gold coin", "coins"],
  },
  {
    riddle: "What breaks the moment you say its name?",
    answers: ["silence"],
  },
  {
    riddle: "I run around the whole den but never move. What am I?",
    answers: ["fence", "a fence", "wall", "walls"],
  },
  {
    riddle: "What has one eye but cannot see the thief coming?",
    answers: ["needle", "a needle"],
  },
  {
    riddle:
      "The person who makes me doesn't want me. The person who buys me doesn't use me. The person who uses me doesn't know it. What am I?",
    answers: ["coffin", "a coffin"],
  },
  {
    riddle: "What can fill the whole den but takes up no space?",
    answers: ["light", "air"],
  },
  {
    riddle:
      "I'm taken from a mine and shut in a wooden case, and yet almost everyone uses me. What am I?",
    answers: ["pencil", "a pencil", "pencil lead", "graphite"],
  },
  {
    riddle: "What invention lets you look right through a wall?",
    answers: ["window", "a window"],
  },
  {
    riddle:
      "I fly without wings and cry without eyes. Wherever I go, darkness follows. What am I?",
    answers: ["cloud", "a cloud", "clouds", "storm cloud"],
  },
  {
    riddle: "What month has 28 days?",
    answers: ["all of them", "all", "every month", "all months"],
  },
  {
    riddle:
      "Howl at me and I howl right back, but I have no throat. What am I?",
    answers: ["echo", "an echo"],
  },
  {
    riddle: "What has many needles but doesn't sew?",
    answers: ["pine tree", "a pine tree", "pine", "cactus", "a cactus"],
  },
  {
    riddle: "The wolf can catch me but never throw me. What am I?",
    answers: ["cold", "a cold"],
  },
  {
    riddle: "What has words but never speaks?",
    answers: ["book", "a book"],
  },
  {
    riddle: "Where does today come before yesterday?",
    answers: ["dictionary", "a dictionary", "the dictionary"],
  },
  {
    riddle: "What gets sharper the more you use it?",
    answers: ["your brain", "brain", "the mind", "mind"],
  },

  // ─── Classic WoW (Whitemane crowd) ──────────────────────────────────
  {
    riddle:
      "Break me and you're stranded for an hour. I always take you home, but never anywhere new. What am I?",
    answers: [
      "hearthstone",
      "a hearthstone",
      "hearth stone",
      "my hearthstone",
      "hearth",
    ],
  },
  {
    riddle:
      "You hear me before you see me, and you never fight just one of me. Mrglglglgl. What am I?",
    answers: ["murloc", "a murloc", "murlocs"],
  },
  {
    riddle:
      "Elwynn's first raid boss — a gnoll with a bounty on his head and a thousand level-nine corpses to his name. Who am I?",
    answers: ["hogger"],
  },
  {
    riddle:
      "Half the Barrens searches for me, and no map has ever marked me. Who am I?",
    answers: ["mankriks wife", "mankrik's wife", "the wife of mankrik"],
  },
  {
    riddle:
      "Whelps in my lair, fire from above — and when I take a deep breath, forty people die. Who am I?",
    answers: ["onyxia", "ony"],
  },
  {
    riddle: "I had a plan. We had numbers. At least I have chicken. Who am I?",
    answers: ["leeroy jenkins", "leeroy"],
  },
  {
    riddle:
      "Did someone say...? Trade chat links me daily; almost nobody has me. Blessed blade of the Windseeker. What am I?",
    answers: ["thunderfury", "thunderfury blessed blade of the windseeker"],
  },
  {
    riddle:
      "A warlock's bags overflow with me, yet I'm spent the moment I matter most. What am I?",
    answers: ["soul shard", "soul shards", "shard", "shards"],
  },
  {
    riddle:
      "I'm free, I'm conjured, and I vanish from your bags when my maker logs off for good. What am I?",
    answers: [
      "mage water",
      "conjured water",
      "water",
      "mage food",
      "conjured food",
    ],
  },
  {
    riddle:
      "The paladin's bravest maneuver: a shield, a stone, and sixty seconds of shame. What is it called?",
    answers: [
      "bubble hearth",
      "bubblehearth",
      "bubble hearthing",
      "bubble and hearth",
    ],
  },
  {
    riddle:
      "TOO SOON! My majordomo woke me before my time, and by fire you were purged. Who am I?",
    answers: ["ragnaros", "rag"],
  },
  {
    riddle:
      "I never end, I'm never on topic, and Chuck Norris lives inside me. What am I?",
    answers: ["barrens chat", "the barrens chat", "barrens"],
  },
  {
    riddle:
      "Weeks of raiding earn me, one bad council decision spends me, and I was never real gold at all. What am I?",
    answers: ["dkp", "dragon kill points"],
  },
  {
    riddle:
      "Duskwood's roads belong to me after dark — the whole zone screams my name when I come walking. Who am I?",
    answers: ["stitches"],
  },
  {
    riddle:
      "Forget to buy me and the hunter does no damage all raid. What am I?",
    answers: ["ammo", "ammunition", "arrows", "bullets"],
  },
  {
    riddle:
      "I'm the only fight you lose gold to every single time, and after each wipe I grow. What am I?",
    answers: [
      "repair bill",
      "the repair bill",
      "repairs",
      "repair costs",
      "durability",
    ],
  },
  {
    riddle:
      "Every hero meets me and few recall my name. I stand in the graveyard and offer you life — for a price your armor pays. Who am I?",
    answers: ["spirit healer", "the spirit healer", "angel"],
  },
  {
    riddle:
      "Beneath a peaceful vineyard town I built a ship, an army, and a grudge against Stormwind. Who am I?",
    answers: ["vancleef", "edwin vancleef", "van cleef"],
  },
  {
    riddle:
      "No horse, no wings, no boat — yet I carry you between two capitals beneath the sea. What am I?",
    answers: ["deeprun tram", "the tram", "tram"],
  },
  {
    riddle:
      "Forty levels of walking buys you a hundred gold of me — and suddenly the world feels small. What am I?",
    answers: ["mount", "a mount", "your mount", "your first mount"],
  },
  {
    riddle:
      "A head rolls in the capital so that I may bless the whole city — log out in the wrong spot and I'm wasted. What am I?",
    answers: [
      "world buff",
      "world buffs",
      "rallying cry",
      "ony buff",
      "onyxia buff",
      "head buff",
    ],
  },
  {
    riddle:
      "Two words in guild chat and forty people stop what they're doing to stand in a circle by the meeting stone. What am I?",
    answers: ["summons", "a summon", "summon", "warlock summon", "lock summon"],
  },
];

/** Draws a random riddle. `rand` injectable for tests. */
export function drawRiddle(rand: () => number = Math.random): HeistRiddle {
  return HEIST_RIDDLES[Math.floor(rand() * HEIST_RIDDLES.length)];
}
