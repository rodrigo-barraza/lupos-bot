import { ActivityType } from 'discord.js';
import DiscordService from '../services/DiscordService.js';
import moment from 'moment';
const DarkmoonFaireService = {
    getNextFaire() {
        const now = moment();
        const nextFaire = moment().startOf('month').day('Sunday').add(7, 'days');
        if (nextFaire.isBefore(now)) {
            nextFaire.add(1, 'month');
        }
        return nextFaire;
    },
    daysUntilFaire() {
        const nextFaire = this.getNextFaire();
        const daysUntilFaire = moment(nextFaire).startOf('day').diff(moment().startOf('day'), 'days');
        return daysUntilFaire;
    },
    getFaireFromToDates() {
        const nextFaire = this.getNextFaire();
        const faireFrom = nextFaire.subtract(7, 'days').format('/MMMM Do, YYYY');
        const faireTo = nextFaire.format('MMMM Do, YYYY');
        return { faireFrom, faireTo };
    },
    getCurrentFaireFromToDates() {
        const firstSundayWeekStart = moment().startOf('month').day(7);
        const firstSundayWeekEnd = moment(firstSundayWeekStart).add(7, 'days');
        const faireFrom = firstSundayWeekStart.format('MMMM Do, YYYY');
        const faireTo = firstSundayWeekEnd.format('MMMM Do, YYYY');
        return { faireFrom, faireTo };
    },
    isItCurrentFaireWeek() {
        const now = moment();
        const firstSundayWeekStart = moment().startOf('month').day(7);
        const firstSundayWeekEnd = moment(firstSundayWeekStart).add(7, 'days');
        if (now.isBetween(firstSundayWeekStart, firstSundayWeekEnd)) {
            return true;
        }
        return false;
    },
    daysUntilReset() {
        if (this.isItCurrentFaireWeek()) {
            return false;
        } else {
            const nextFaire = this.getNextFaire();
            const daysUntilFaire = moment(nextFaire).startOf('day').diff(moment().startOf('day'), 'days');
            return daysUntilFaire;
        }
    },
    async darkmoonFaireMessage(interaction) {
        const isItCurrentFaireWeek = DarkmoonFaireService.isItCurrentFaireWeek();
        const getCurrentFaireFromToDates = DarkmoonFaireService.getCurrentFaireFromToDates();
        let systemContent = '';
        let userContent = '';
        if (isItCurrentFaireWeek) {
            systemContent = `
                You do not mention today's date or the time, ever.
                You will always bold the date when it starts and goes until.
                You will always bold dates only.
                You will answer in character, that it's currently Darkmoon Faire week, which started on ${getCurrentFaireFromToDates.faireFrom} and will go on until ${getCurrentFaireFromToDates.faireTo} . You will make a remark about how they should go there to fuck up the other faction in some sweaty pvp that only the most elite nerds engage in, or try to scramble and do their best to get buffed up before raid.
            `
            userContent = 'Is it currently Darkmoon Faire week?';
        } else {
            const nextResetDate = DarkmoonFaireService.getNextFaire();
            const nextResetEndDate = moment().add(7, 'days');
            const daysUntilReset = DarkmoonFaireService.daysUntilReset();
            systemContent = `
                You do not mention today's date or the time, ever.
                You will always bold the date when the next raid reset is only, and when it starts and goes until.
                You will answer, in character, when the next raid reset is. The next raid reset date is in ${daysUntilReset} days, on ${nextResetDate.format('MMMM Do, YYYY')} and will go all the way until ${nextResetEndDate.format('MMMM Do, YYYY')}. You will either answer by saying the date, and by saying how many more hours are left until the next dungeon reset. Make a remark about how they they seem to be so impatient and that they should probably go out a little more, instead of playing silly nintendo indoors, all locked up, like a pup in a cage, or a dog in a crate.
                
                Do not mention the time at all, only the date.
            `;
            userContent = 'Can you explain when is the next Darkmoon Faire week, when does it go until, and how long does it last?';
        }
        return await DiscordService.generateTextFromSystemUserMessages(systemContent, userContent, interaction);
    },
}

export default DarkmoonFaireService;