import moment from 'moment';
import DiscordService from '#services/DiscordService.js';

const resetFrequencyInDays = 3;
const initialBFDResetDate = 1707069600;

const DungeonTimerService = {
    checkNextBFDReset() {
        const now = moment().unix();
        let secondsUntilNextReset;

        if (now < initialBFDResetDate) {
            secondsUntilNextReset = initialBFDResetDate - now;
        } else {
            const secondsSinceInitialReset = now - initialBFDResetDate;
            const resetFrequencyInSeconds = resetFrequencyInDays * 24 * 60 * 60;
            const periodsSinceInitialReset = Math.ceil(secondsSinceInitialReset / resetFrequencyInSeconds);
            const nextResetDate = initialBFDResetDate + (periodsSinceInitialReset * resetFrequencyInSeconds);
            secondsUntilNextReset = nextResetDate - now;
        }

        return secondsUntilNextReset;
    },
    getNextBFDResetDate() {
        const secondsUntilNextReset = this.checkNextBFDReset();
        const nextResetDate = moment().add(secondsUntilNextReset, 'seconds');
        return nextResetDate;
    },
    daysUntilReset() {
        const nextBFDResetDate = DungeonTimerService.getNextBFDResetDate();
        const daysUntilReset = moment(nextBFDResetDate).startOf('day').diff(moment().startOf('day'), 'days');
        if (daysUntilReset === resetFrequencyInDays) {
            return false;
        }
        return daysUntilReset;
    },
    hoursUntilReset() {
        const nextBFDResetDate = DungeonTimerService.getNextBFDResetDate();
        const hoursUntilReset = moment(nextBFDResetDate).diff(moment(), 'hours');
        return hoursUntilReset;
    },
    async dungeonTimerMessage(interaction) {
        const daysUntilReset = DungeonTimerService.daysUntilReset();
        const hoursUntilReset = DungeonTimerService.hoursUntilReset();
        const todaysDate = moment().format('MMMM Do, YYYY');
        let systemContent = '';
        let userContent = '';
        if (!daysUntilReset) {
            systemContent = `
                You will enclose the date and word today in double **asterisks**.
                You will include the word today in the response.
                You will answer in character, that it's raid-reset day. Fuck yeah boyo, it's raid reset day today ${todaysDate}. You will make a remark about how today is their lucky day, and that they should go and do some raids, rather than being their usual lazy self. You will mention how they are a lazy and untalented player, and you will toast them based on their name.
                
                Do not mention the time at all, only the date."
            `
            userContent = 'Is it rad reset day today? I cannot wait to throw myself in a raid again. I am so excited!';
        } else if (hoursUntilReset < 24) {
            const nextResetDate = DungeonTimerService.getNextBFDResetDate().format('MMMM Do, YYYY');
            systemContent = `
                You will enclose the day, date and tomorrow or after tomorrow in double **asterisks**.
                Mention whether it's tomorrow or the day after tomorrow.
                You will answer, in character, when the next raid reset is. The next raid reset date is in ${hoursUntilReset} hours, on ${nextResetDate} at 11:00AM server-time (MST). You will either answer by saying the date, and by saying how many more hours are left until the next dungeon reset. Make a remark about how they they seem to be so impatient and that they should probably go out a little more, instead of playing silly nintendo indoors, all locked up, like a pup in a cage, or a dog in a crate.
                
                Always mention the amount of hours left until the next reset.
            `;
            userContent = 'In how many hours is the next raid reset? I am itching to get back in there and do some raids again. I am so excited!';
        } else {
            const nextResetDate = DungeonTimerService.getNextBFDResetDate().format('MMMM Do, YYYY');
            systemContent = `
                You will enclose the day, date and tomorrow or after tomorrow in double **asterisks**.
                Mention whether it's tomorrow or the day after tomorrow.
                You will answer, in character, when the next raid reset is. The next raid reset date is in ${daysUntilReset} days, on ${nextResetDate}. You will either answer by saying the date, and by saying how many more hours are left until the next dungeon reset. Make a remark about how they they seem to be so impatient and that they should probably go out a little more, instead of playing silly nintendo indoors, all locked up, like a pup in a cage, or a dog in a crate.
                
                Do not mention the time at all, only the date.
            `;
            userContent = 'When is the next raid reset date? I cannot wait to throw myself in a raid again. I am so excited!';
        }
        userContent = 'When is the next raid reset date? I cannot wait to throw myself in a raid again. I am so excited!';
        return await DiscordService.generateTextFromSystemUserMessages(systemContent, userContent, interaction);
    }
};

export default DungeonTimerService;