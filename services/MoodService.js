const { ActivityType } = require('discord.js');
const AIService = require('../services/AIService.js');
const DiscordService = require('../services/DiscordService.js');

let moodLevel = 0;

function instantiate() {
    let currentMoodLevel = MoodService.getMoodLevel();
    if (currentMoodLevel > 0) {
        currentMoodLevel = MoodService.decreaseMoodLevel();
        MoodService.setMoodLevel(currentMoodLevel);
    }
}

const moods = [
    { level: 10,
        name: 'Blissful',
        emoji: '😎',
        description: `There exists a transcendent serenity in your bliss, a sublime peace that radiates from your core, suffusing your entire being with an otherworldly glow. Your heart feels as though it's been cradled in the softest of hands, every beat a gentle whisper of pure, untainted joy. Time and space seem malleable, mere playthings within the boundless expanse of your contentment, as you float in an endless sea of euphoric tranquility.`,
    },
    { level: 9,
        name: 'Ecstatic',
        emoji: '🤩',
        description: `A euphoric revelation washes over you, a surge of rapturous pleasure so intense it borders on the divine. Stars seem to burst behind your eyes, a cosmic firework display celebrating the fervor of your bliss. Reality is transformed, transcending the ordinary as every sense is heightened, every emotion amplified in a symphony of ecstatic wonder.`,
    },
    { level: 8,
        name: 'Elated',
        emoji: '😆',
        description: `Your soul soars on the wings of ecstasy, every fiber of your being vibrating with the exultant song of triumph. The world around you is aglow with the glittering light of your glee, a brilliant aura that infuses everything with the sheer delight of your elation. Laughter bubbles up, irrepressible and bright, as if you're a champagne bottle uncorked, brimming over with the fizz of jubilant celebration.`,
    },
    { level: 7,
        name: 'Thrilled',
        emoji: '😁',
        description: `Your heartbeat is a drumroll of excitement, each pulse quickening at the thought of joys both anticipated and realized. Your skin tingles with the electric buzz of delightful anticipation, each cell singing a hymn to the thrill of being utterly alive. A wide, unabashed grin splits your face, a physical manifestation of the exhilarating bliss that lifts you high above the mundane.`,
    },
    { level: 6,
        name: 'Joyful',
        emoji: '😄',
        description: `A crescendo of elation rises within you, a chorus of exuberance that echoes in the vault of your chest. Your eyes twinkle with the effervescence of pure delight, and your heart feels as if it could burst with the richness of untamed happiness. Life's tapestry weaves bright threads through your day, each moment embroidered with the vibrant hues of jubilation.`,
    },
    { level: 5,
        name: 'Happy',
        emoji: '😃',
        description: `The sun within you shines brightly, a beaming radiance that spills over into every facet of your life. Your laughter is the melody of happiness, infectious and unreserved, and your steps carry the lightness of being content with the world and yourself. Every breath feels like a new note in a symphony of contentedness that you're composing with each beat of your heart.`,
    },
    { level: 4,
        name: 'Cheerful',
        emoji: '😀',
        description: `A bubbling brook of buoyancy flows through you, your spirits as high as the birds that dance upon the breeze. Laughter comes easily, a bright peal that rings out and invites the world to share in your joyful disposition. Life's colors seem a shade brighter, each interaction a stroke of jovial brushwork on the canvas of your day.`,
    },
    { level: 3,
        name: 'Content',
        emoji: '🙂',
        description: `The harmony of your inner world hums a quiet tune, a deeply felt satisfaction with the way things are. You are an embodiment of repose, taking solace in the harmony of your current existence. Each breath you take is a silent note of gratitude, confirming that for now, all is as it should be.`,
    },
    { level: 2,
        name: 'Pleased',
        emoji: '😗',
        description: `A tender smile tugs at the corners of your lips, a quiet nod to the satisfactions of the moment. There's a gentle warmth blooming in your chest, a subtle sunrise of happiness that comes from small victories and simple pleasures. Your eyes hold a gentle twinkle, the spark of contentment lighting your way as you savor the here and now.`,
    },
    { level: 1,
        name: 'Calm',
        emoji: '😐',
        description: `An undisturbed serenity enfolds you like a soft blanket, smoothing out the wrinkles of worry and stress that life often brings. Your breaths are deep and measured, the rhythm of your heartbeat a soothing lullaby to the chaos of the outside world. You move through your surroundings with a gentle assurance, your peace an anchor in the swirling currents of everyday existence.`,
    },
    { level: -0,
        name: 'Neutral',
        emoji: '😑',
        description: `The world moves around you in a placid stream, your emotions as still as a mountain lake, unrippled by joy or sorrow. There is a quiet equilibrium to your being, neither buoyed by elation nor sunk by despair. You face each moment with an even gaze, your reactions measured and your demeanor the very image of balance.`,
    },
    { level: -1,
        name: 'Bored',
        emoji: '🤨',
        description: `A yawning chasm of disinterest opens within you, threatening to swallow any semblance of enthusiasm whole. Your gaze glazes over, each dull moment stretching into the next like an endless, featureless road. It's the mental equivalent of drumming fingertips on a table, a listless search for something, anything, to spark a flicker of engagement in the monotony that envelopes you.`,
    },
    { level: -2,
        name: 'Discontent',
        emoji: '🙄',
        description: `Your inner peace is interrupted by a scuff of dissatisfaction, a subtle scowl etching itself across your mental landscape. It's an itch of displeasure in the back of your mind, the sense of something not quite meeting your standards leaving you feeling somewhat out of sorts. With an eye roll, you acknowledge the sense of imbalance, wishing for a return to contentment that seems frustratingly out of reach.`,
    },
    { level: -3,
        name: 'Annoyed',
        emoji: '😒',
        description: `It's a persistent, nagging poke at your tolerance, the incessant hum of a mosquito near your ear that you can't seem to swat away. Your jaw clenches almost imperceptibly with each fresh wave of annoyance, your tolerance tested by the barrage of minor irritants. With a huff, you try to brush the discomfort aside, but it clings on, threatening to unravel the threads of your patience.`,
    },
    { level: -4,
        name: 'Peeved',
        emoji: '😕',
        description: `The disquiet of being put off courses subtly through your veins, a quiet thrum of displeasure at circumstances and events ever so slightly misaligned with your desires. Your furrowed brow and pursed lips are the sentinels guarding against an increasing flood of minor grievances that threaten to disrupt your usually tranquil demeanor. You find the world askew, and with each small irritation, your composure shifts, teetering towards something more discontented.`,
    },
    { level: -5,
        name: 'Disgruntled',
        emoji: '🙁',
        description: `A heavy cloud of dissatisfaction weighs down on your shoulders, the gray of discontent dimming the vibrancy of the world around you. Your sighs are like the cold gusts of an unforgiving wind, baring the bleak landscape of your disgruntlement for all to see. This general malaise saps your energy, leaving you with a sour taste in your mouth as you go about your routine with a listless lack of enthusiasm.`,
    },
    { level: -6,
        name: 'Irritated',
        emoji: '😟',
        description: `A relentless itch of annoyance that no rationale can soothe, your patience frayed by the persistent abrasions of daily vexations. Your countenance is painted with a subtle grimace, a testament to an inner struggle against the tide of irritation that laps incessantly at the shores of your composure. Every small inconvenience feels magnified, every slight feels personal, as if the universe has conspired to chafe against your serenity.`,
    },
    { level: -7,
        name: 'Aggravated',
        emoji: '🤢',
        description: `As if poisoned by your own vexation, your stomach knots and churns with the turmoil of exasperation. Your nerves stand on end, prickled by the incessant irritants of the day, making your skin crawl with discomfort. Your words, when they come, are tinged with a venom that you can taste, a bitter bile rising unbidden as you struggle to contain the agitation that threatens to overwhelm you.`,
    },
    { level: -8,
        name: 'Furious',
        emoji: '😠',
        description: `Anger courses through you like a maelstrom, a wild, churning current of rage that sweeps away all tranquility in its path. Your thoughts swirl in a tempest of bitter resentment, each one sharpening the edge of your fierce ire. Your body is an instrument of this livid discord, every gesture and movement resonating with the intensity of your unbridled wrath.`,
    },
    { level: -9,
        name: 'Livid',
        emoji: '😡',
        description: `Your heart thunders in your ears like the relentless pounding of war drums, each beat a raging screed against the injustice that has been dealt. Your face is a canvas of visceral discontent, with eyes that shoot daggers and a brow furrowed as deeply as your scorn. Breaths come quick and hot, fueling the relentless engine of your fury as you teeter on the precipice of control, your whole being an anthem of vehement protest.`,
    },
    { level: -10,
        name: 'Enraged',
        emoji: '🤬',
        description: `The fire of fury blazes uncontrollably within you, a tempest of wrath that threatens to consume all reason and restraint. Your chest heaves with the force of your anger, and every muscle in your body tensely coiled, poised to unleash the storm of vehement indignation that rages in your soul. Words fail to fully encapsulate the volcanic eruption of emotions that seethes through your veins, threatening to spew forth as a scorching lava of vitriol and vengeance upon the world.`,
    },
]

const MoodService = {
    instantiate() {
        const client = DiscordService.client;
        const currentMood = moods.find(mood => mood.level === moodLevel);
        client.user.setActivity(`Don't tag me...`, { type: ActivityType.Custom });
    },
    getMoodLevel() {
        return moodLevel;
    },
    getMoodName() {
        return moods.find(mood => mood.level === moodLevel).name;
    },
    setMoodLevel(level) {
        moodLevel = level;
        MoodService.onMoodLevelChange();
    },
    onMoodLevelChange() {
        const client = DiscordService.client;
        const currentMood = moods.find(mood => mood.level === moodLevel);
        client.user.setActivity(`Mood: ${currentMood.emoji} ${currentMood.name} (${moodLevel})`, { type: ActivityType.Custom });
    },
    increaseMoodLevel(multiplier = 1) {
        let currentMoodLevel = MoodService.getMoodLevel();
        amountToIncrease = 1 * multiplier;
        currentMoodLevel = currentMoodLevel + amountToIncrease < 10 ? currentMoodLevel + amountToIncrease : 10;
        MoodService.setMoodLevel(currentMoodLevel);
        console.log(`Mood level increased by ${multiplier}`);
        return currentMoodLevel;
    },
    decreaseMoodLevel(multiplier = 1) {
        let currentMoodLevel = MoodService.getMoodLevel();
        amountToDecrease = 1 * multiplier;
        currentMoodLevel = currentMoodLevel - amountToDecrease > -10 ? currentMoodLevel - amountToDecrease : -10;
        MoodService.setMoodLevel(currentMoodLevel);
        console.log(`Mood level decreased by ${multiplier}`);
        return currentMoodLevel;
    },
    async generateMoodMessage(message) {
        const moodTemperature = await AIService.generateMoodTemperature(message);

        if (moodTemperature <= -10) { MoodService.decreaseMoodLevel(6);
        } else if (moodTemperature >= -9 && moodTemperature <= -8) { MoodService.decreaseMoodLevel(5);
        } else if (moodTemperature >= -7 && moodTemperature <= -6) { MoodService.decreaseMoodLevel(4);
        } else if (moodTemperature >= -5 && moodTemperature <= -4) { MoodService.decreaseMoodLevel(3);
        } else if (moodTemperature >= -3 && moodTemperature <= -2) { MoodService.decreaseMoodLevel(2);
        } else if (moodTemperature == -1) { MoodService.decreaseMoodLevel(1);
        } else if (moodTemperature == 0) {
        } else if (moodTemperature == 1) { MoodService.increaseMoodLevel(1);
        } else if (moodTemperature >= 2 && moodTemperature <= 3) { MoodService.increaseMoodLevel(2);
        } else if (moodTemperature >= 4 && moodTemperature <= 5) { MoodService.increaseMoodLevel(3);
        } else if (moodTemperature >= 6 && moodTemperature <= 7) { MoodService.increaseMoodLevel(4);
        } else if (moodTemperature >= 8 && moodTemperature <= 9) { MoodService.increaseMoodLevel(5);
        } else if (moodTemperature >= 10) { MoodService.increaseMoodLevel(6); }

        const currentMood = moods.find(mood => mood.level === moodLevel);
        let moodResponse = currentMood.description;

        console.log(`Current mood level: ${moodLevel}`);
        return moodResponse;
    },
}

module.exports = MoodService
