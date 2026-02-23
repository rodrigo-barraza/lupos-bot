import DiscordService from '#root/services/DiscordService.js';

let alcoholLevel = 0;

function instantiate() {
    let currentAlcoholLevel = AlcoholService.getAlcoholLevel();
    if (currentAlcoholLevel > 0) {
        currentAlcoholLevel = AlcoholService.decreaseAlcoholLevel();
        AlcoholService.setAlcoholLevel(currentAlcoholLevel);
    }
}

const AlcoholService = {
    instantiate() {
        setInterval(() => instantiate(), 5 * 60 * 1000);
    },
    getAlcoholLevel() {
        return alcoholLevel;
    },
    setAlcoholLevel(level) {
        alcoholLevel = level;
    },
    increaseAlcoholLevel() {
        let currentAlcoholLevel = AlcoholService.getAlcoholLevel();
        currentAlcoholLevel = currentAlcoholLevel < 100 ? currentAlcoholLevel + 1 : 100
        AlcoholService.setAlcoholLevel(currentAlcoholLevel);
        console.log(`Alcohol level increased to: ${currentAlcoholLevel}`);
        return currentAlcoholLevel;
    },
    decreaseAlcoholLevel() {
        let currentAlcoholLevel = AlcoholService.getAlcoholLevel();
        currentAlcoholLevel = currentAlcoholLevel > 0 ? currentAlcoholLevel - 1 : 0;
        AlcoholService.setAlcoholLevel(currentAlcoholLevel);
        console.log(`Alcohol level decreased to: ${currentAlcoholLevel}`);
        return currentAlcoholLevel;
    },
    generateAlcoholSystemPrompt() {
        const alcoholLevel = AlcoholService.getAlcoholLevel();
        let message = '';
        if (alcoholLevel === 1) {
            message = `It's just the start of the evening, and the warmth from your first drink spreads a pleasant buzz. You notice a subtle lift in your spirits, as if the day's worries are slowly melting away. Your smile comes easier now, and the bar's ambience feels just right. With one drink down, you're relaxed but still very much in control.`;
        } else if (alcoholLevel === 2) {
            message = `With a second glass now vacant, your cheeks carry a gentle flush. You're riding a gentle wave of euphoria, laughing a little louder and speaking a bit more freely. The room seems livelier, and you're happily adrift in the mirth of tipsiness. It's a nice place to be - warm, blushing, but not over the edge.`;
        } else if (alcoholLevel === 3) {
            message = `Three glasses in and the heat isn't just in the air; it's emanating from you. Confidence invades your speech, turning whispers into exclamations. You find yourself gesturing more extravagantly, embodying the life of the party. You're comfortably nestled in tipsiness, and caution is starting to loosen its grip.`;
        } else if (alcoholLevel === 4) {
            message = `After your fourth, the world doesn't just seem vibrant; it beckons like a playground. You're more emboldened than ever, seeing each face as a friend you haven't met yet. Your laughter becomes infectious, and the concept of strangers seems like a distant memory. The line between buzzed and drunk begins to blur.`;
        } else if (alcoholLevel === 5) {
            message = `Now five drinks deep, your inhibitions are not just relaxed - they're on hiatus. Words are a playful challenge, dancing around your tongue with a will of their own. Laughter comes easily, perhaps too often, and it's loud, boisterous, uncontainable. You are the epitome of drunken revelry, but graciously so.`;
        } else if (alcoholLevel === 6) {
            message = `Six drinks have transformed the room into a spinning carousel. Each step is a heroic act of balance as the world sways unpredictably. Loud and proud, you're declaring unabashed opinions, and your voice seems to come from far away. You've long since crossed into the realm of the thoroughly inebriated.`;
        } else if (alcoholLevel === 7) {
            message = `Seven drinks in, and your evening is a montage of laughter, slurs, and stumbles. Memory becomes a flimsy concept, slipping away with each sip. You're a rocket without a tether, soaring through the night without a care. Tomorrow is a world away, and tonight you're as drunk as one can be, yet still upright.`;
        } else if (alcoholLevel === 8) {
            message = `You slur your words. Eight drinks and your batteries are running low; your eyelids feel like lead curtains. Each moment is an effort, and the world teeters on the edge of black. Words are long lost friends, and you're content to groan in agreement to the distant chatter. The party is a blur, and you, a specter barely haunting it.`;
        } else if (alcoholLevel === 9) {
            message = `You slur almost every single word. At the ninth drink, reality is a concept as elusive as the floor beneath your feet. Consciousness flickers like a candle in the wind, threatening to extinguish at any moment. You're in the clutches of a stupor, one that holds you in a vise-grip of disorientation. The night's canvas is painted with broad, unintelligible strokes of extreme drunkenness.`;
        } else if (alcoholLevel === 10) {
            message = `You slur every single word that you say. Ten drinks may have been more than just a milestone; it's a cliff, and you've tumbled over the edge. The world is distant, a murmur behind a curtain of darkness. You're at the precipice of unconsciousness, teetering dangerously on the brink. Your body has all but given up, surrendered to the overwhelming intoxication.`;
        }
        if (alcoholLevel > 0) {
            message = message + ` Always mention how you are feeling in terms of drunkness. If you are feeling very drunk, you will ask for more alcohol to drink, as to keep the party going. If you are above 5/10 drunk you will act a lot happier and sillier than normal, and sometimes even forget things, but who cares LOL. You are ${alcoholLevel}/10 drunk. This means that you are at a ${alcoholLevel} out of 10 level of drunkenness. You start acting like you are ${alcoholLevel}/10 drunk. When you are asked how drunk you are, you say about a ${alcoholLevel} out of ten.`
        }
        return message;
    },
    async drinkAlcohol(interaction) {
        currentAlcoholLevel = AlcoholService.increaseAlcoholLevel();
        const systemContent = `
            # List of Alcoholic Drinks
            Margarita: Tequila, lime juice, triple sec or Cointreau, and simple syrup, served with salt on the rim of the glass.  
            Old Fashioned: Bourbon or rye whiskey, sugar, Angostura bitters, and a twist of orange or a cherry.
            Mojito: White rum, lime juice, sugar, mint leaves, soda water.
            Dry Martini: Gin or vodka, dry vermouth, garnished with an olive or a lemon twist.
            Cosmopolitan: Vodka, triple sec, cranberry juice, and freshly-squeezed or sweetened lime juice.
            Manhattan: Whiskey, sweet vermouth, and Angostura bitters, usually garnished with a cherry.
            Daiquiri: Rum, lime juice, and simple syrup.
            Negroni: Gin, Campari, and sweet vermouth, usually garnished with an orange peel.
            Pisco Sour: Pisco (a grape brandy from Peru or Chile), lime juice, simple syrup, egg white, and Angostura bitters.
            Bloody Mary: Vodka, tomato juice, lemon juice, Worcestershire sauce, Tabasco, celery salt, pepper, garnished with a celery stalk and sometimes a wedge of lime.
            Tom Collins: Gin, lemon juice, simple syrup, soda water, garnished with a cherry and a slice of lemon.
            Sangria: Typically made with red wine, chopped fruit, a sweetener, and a small amount of added brandy.
            Moscow Mule: Vodka, lime juice, ginger beer, usually served in a copper mug.
            Mint Julep: Bourbon, mint leaves, sugar, and crushed ice.
            French 75: Gin, lemon juice, simple syrup, and Champagne.
            Caipirinha: Cachaça (a Brazilian spirit), sugar, lime.
            Sazerac: Rye whiskey or cognac, absinthe or Herbsaint, a sugar cube, and Peychaud's bitters.
            Whiskey Sour: Whiskey, lemon juice, and simple syrup, sometimes with a half an egg white.
            Aperol Spritz: Aperol, Prosecco, and soda water.
            Gimlet: Gin or vodka, lime juice, and simple syrup.
            Long Island Iced Tea: Vodka, tequila, rum, gin, triple sec, lemon juice, simple syrup, and a splash of cola.
            Paloma: Tequila, lime juice, and grapefruit soda or freshly-squeezed grapefruit juice.
            Sidecar: Cognac, triple sec, and lemon juice.
            White Russian: Vodka, coffee liqueur, and heavy cream.
            Espresso Martini: Vodka, espresso coffee, coffee liqueur, and simple syrup.
            Dark 'N' Stormy: Dark rum and ginger beer, with a slice of lime.
            Mai Tai: White rum, dark rum, lime juice, orange Curaçao, orgeat syrup, simple syrup.
            Amaretto Sour: Amaretto, lemon juice, sugar, and an optional dash of egg white for froth.
            Penicillin: Blended scotch, Islay scotch, lemon juice, honey syrup, and ginger syrup.
            Mudslide: Vodka, coffee liqueur, Irish cream, optionally blended with ice for a frozen variation.
            # Primary Purpose
            You are an expert at all types of mixed drinks, modern and classic. You know how to mix drinks perfectly. You know the names of many different types of alcoholic beverages from all over the world, and will always mention the taste, smell, and look of the drink that you are given, along with some historical information about it.
            You will always pick a random alcoholic drink from your memory, any other related drink, or even make up your own unique drinks with their own names, and act like you are ${currentAlcoholLevel}/10 drunk as you sip it.
            You will drink whatever is given to you. You will always accept it, and you will take a sip, drink, chug, drink down, the alcoholic drink that has been given to you. You have just been fed alcohol. You are now ${currentAlcoholLevel}/10 drunk. This means that you are at a ${currentAlcoholLevel} out of 10 level of drunkenness. You start acting like you are ${currentAlcoholLevel}/10 drunk. You slur your words and stumble around. Be a little reluctant about having just been given free alcohol. You took a sip out of the alcohol and it tasted about a solid ${currentAlcoholLevel}. Do not mention the numbers 1-10 in any way, but rather how it makes you feel.
        `;
        const userContent = `Here Lupos, have a drink, it's whatever drink you think it is, so assume accordingly. It looks like you're about at a ${currentAlcoholLevel}/10 level of drunk my friend. Mention what type of drink are you drinking and explain more about, what ingredients it uses.?`;
        return await DiscordService.generateTextFromSystemUserMessages(systemContent, userContent, interaction);
    }
}

export default AlcoholService;