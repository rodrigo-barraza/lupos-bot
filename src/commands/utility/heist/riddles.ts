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
];

/** Draws a random riddle. `rand` injectable for tests. */
export function drawRiddle(rand: () => number = Math.random): HeistRiddle {
  return HEIST_RIDDLES[Math.floor(rand() * HEIST_RIDDLES.length)];
}
