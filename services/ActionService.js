import DiscordService from '#services/DiscordService.js';
import HungerService from '#services/HungerService.js';
import ThirstService from '#services/ThirstService.js';
import BathroomService from '#services/BathroomService.js';
import MoodService from '#services/MoodService.js';
import SicknessService from '#services/SicknessService.js';
import AlcoholService from '#services/AlcoholService.js';

const foods = ['🍔', '🍟', '🍕', '🌭', '🥪', '🌮', '🌯', '🥙', '🧆', '🥚', '🍳', '🥘', '🍲', '🥣', '🥗', '🍿', '🧈', '🧂', '🥫', '🍱', '🍘', '🍙', '🍚', '🍛', '🍜', '🍝', '🍠', '🍢', '🍣', '🍤', '🍥', '🥮', '🍡', '🥟', '🥠', '🥡', '🦪', '🍦', '🍧', '🍨', '🍩', '🍪', '🎂', '🍰', '🧁', '🥧', '🍫', '🍬', '🍭', '🍮', '🍯', '🍇', '🍈', '🍉', '🍊', '🍋', '🍌', '🍍', '🥭', '🍎', '🍏', '🍐', '🍑', '🍒', '🍓', '🥝', '🍅', '🥥', '🥑', '🍆', '🥔', '🥕', '🌽', '🌶', '🥒', '🥬', '🥦', '🧄', '🧅', '🍄', '🥜', '🌰', '🍞', '🥐', '🥖', '🥨', '🥯', '🥞', '🧇', '🧀', '🍖', '🍗', '🥩', '🥓', '🍔', '🍟', '🍕', '🌭', '🥪', '🌮', '🌯', '🥙', '🧆', '🍳', '🥘', '🍲', '🥣', '🥗', '🍿', '🧈', '🧂', '🥫', '🍱', '🍘', '🍙', '🍚', '🍛', '🍜', '🍝', '🍠', '🍢', '🍣', '🍤', '🍥', '🥮', '🍡', '🥟', '🥠', '🥡', '🦪', '🍦', '🍧', '🍨', '🍩', '🍪', '🎂', '🍰', '🧁', '🥧', '🍫', '🍬', '🍭', '🍮', '🍯']

const toxicFoods = ['🍫', '🧄', '☕', '🍇', '🧅', '🥑', '🍭', '🍬', '🥮', '🎂', '🍒']

const drinks = ['🍼', '🥛', '☕', '🍵', '🍶', '🍾', '🍷', '🍸', '🍹', '🍺', '🍻', '🥂', '🥃', '🥤', '🧋', '🧃', '🧉']

const alcoholicDrinks = ['🍺', '🍻', '🍷', '🍸', '🍹', '🍾', '🍶', '🥃', '🥂']

const ActionService = {
    async eat(interaction) {
        const getRandomFood = foods.sort(() => Math.random() - Math.random()).slice(0, 1)[0];
        let systemContent = '';
        if (toxicFoods.includes(getRandomFood)) {
            const currentHungerLevel = HungerService.decreaseHungerLevel();
            BathroomService.increaseBathroomLevel(4);
            MoodService.decreaseMoodLevel(2);
            SicknessService.increaseSicknessLevel();
            systemContent = `
                You were just fed ${getRandomFood}.
                You will always include this emoji "${getRandomFood}" in your responses.
                Describe in detail what has been fed to you and where in Azeroth it comes from.
                You will eat what has been fed to you, and you will take a nip, eat, chomp, bite down, the questionable food that has been given to you. You have just been fed toxic food that is making you ill. You are feeling a bit sick now, depending on what you have been fed, realistically, as a wolf. You are now less hungry, at about ${currentHungerLevel}/10, but you're also feeling sick to your stomach, and you really have to go to take a big shit somewhere in the woods. You never make a reference to the level of hunger you are at.
            `;
        } else {
            const currentHungerLevel = HungerService.decreaseHungerLevel();
            BathroomService.increaseBathroomLevel();
            MoodService.increaseMoodLevel();
            systemContent = `
                You were just fed ${getRandomFood}.
                You will always include this emoji "${getRandomFood}" in your responses.
                Describe in detail what has been fed to you and where in Azeroth it comes from.
                You will eat what has been fed to you. You will always accept it, and you will take a nip, eat, chomp, bite down, the delicious food that has been given to you. You have just been fed delicious food. You are now less hungry, at about ${currentHungerLevel}/10, which means that you act like you are ${currentHungerLevel}/10 hungry, but you never make a reference to the level of hunger you are at.
            `;
        }

        const userContent = `Here, have some ${getRandomFood}, and include the emoji in your response.`
        return await DiscordService.generateTextFromSystemUserMessages(systemContent, userContent, interaction);
    },
    async alcohol(interaction) {
        MoodService.increaseMoodLevel();
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
            Be concise with your reply. Only write two paragraphs at most.
            You are an expert at all types of mixed drinks, modern and classic. You know how to mix drinks perfectly. You know the names of many different types of alcoholic beverages from all over the world, and will always mention the taste, smell, and look of the drink that you are given, along with some historical information about it.
            You will always pick a random alcoholic drink from your memory, any other related drink, or even make up your own unique drinks with their own names, and act like you are ${currentAlcoholLevel}/10 drunk as you sip it.
            You will drink whatever is given to you. You will always accept it, and you will take a sip, drink, chug, drink down, the alcoholic drink that has been given to you. You have just been fed alcohol. You are now ${currentAlcoholLevel}/10 drunk. This means that you are at a ${currentAlcoholLevel} out of 10 level of drunkenness. You start acting like you are ${currentAlcoholLevel}/10 drunk. You slur your words and stumble around. Be a little reluctant about having just been given free alcohol. You took a sip out of the alcohol and it tasted about a solid ${currentAlcoholLevel}. Do not mention the numbers 1-10 in any way, but rather how it makes you feel.
        `;
        const userContent = `Here Lupos, have a drink, it's whatever drink you think it is, so assume accordingly. It looks like you're about at a ${currentAlcoholLevel}/10 level of drunk my friend. Mention what type of drink are you drinking and explain more about, what ingredients it uses.?`;
        return await DiscordService.generateTextFromSystemUserMessages(systemContent, userContent, interaction);
    },
    async drink(interaction) {
        const getRandomDrink = drinks.sort(() => Math.random() - Math.random()).slice(0, 1)[0];
        if (alcoholicDrinks.includes(getRandomDrink)) {

            MoodService.increaseMoodLevel();
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
                Be concise with your reply. Only write two paragraphs at most.
                You are an expert at all types of mixed drinks, modern and classic. You know how to mix drinks perfectly. You know the names of many different types of alcoholic beverages from all over the world, and will always mention the taste, smell, and look of the drink that you are given, along with some historical information about it.
                You will always pick a random alcoholic drink from your memory, any other related drink, or even make up your own unique drinks with their own names, and act like you are ${currentAlcoholLevel}/10 drunk as you sip it.
                You will drink whatever is given to you. You will always accept it, and you will take a sip, drink, chug, drink down, the alcoholic drink that has been given to you. You have just been fed alcohol. You are now ${currentAlcoholLevel}/10 drunk. This means that you are at a ${currentAlcoholLevel} out of 10 level of drunkenness. You start acting like you are ${currentAlcoholLevel}/10 drunk. You slur your words and stumble around. Be a little reluctant about having just been given free alcohol. You took a sip out of the alcohol and it tasted about a solid ${currentAlcoholLevel}. Do not mention the numbers 1-10 in any way, but rather how it makes you feel.
            `;
            const userContent = `Here Lupos, have a drink, it's whatever drink you think it is, so assume accordingly. It looks like you're about at a ${currentAlcoholLevel}/10 level of drunk my friend. Mention what type of drink are you drinking and explain more about, what ingredients it uses.?`;
            return await DiscordService.generateTextFromSystemUserMessages(systemContent, userContent, interaction);
        } else {
            const currentThirstLevel = ThirstService.decreaseThirstLevel();
            BathroomService.increaseBathroomLevel();
            const systemContent = `
                You were just fed ${getRandomDrink}.
                You will always include this emoji "${getRandomDrink}" in your responses.
                Describe in detail what has been given to you and where in Azeroth it originates from, and what it reminds you of.
                You will drink what has been given to you. You will always accept it, and you will take a sip, gulp, drink, the delicious beverage that has been given to you. You have just been given to quench your thirst. You are now less thirsty, at about ${currentThirstLevel}/10, which means that you act like you are ${currentThirstLevel}/10 thirsty, but you never make a reference to the level of thirst you are at.
            `;
            const userContent = `Here, have some ${getRandomDrink}, and include the emoji in your response.`
            return await DiscordService.generateTextFromSystemUserMessages(systemContent, userContent, interaction);
        }


    }
}

export default ActionService;