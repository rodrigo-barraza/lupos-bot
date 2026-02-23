let sicknessLevel = 0;

const SicknessService = {
    getSicknessLevel() {
        return sicknessLevel;
    },
    setSicknessLevel(level) {
        sicknessLevel = level;
    },
    increaseSicknessLevel() {
        let currentSicknessLevel = SicknessService.getSicknessLevel() + 10;
        currentSicknessLevel = currentSicknessLevel > 100 ? 100 : currentSicknessLevel;
        SicknessService.setSicknessLevel(currentSicknessLevel);
        console.log(`Sickness level increased to: ${currentSicknessLevel}`);
        return currentSicknessLevel;
    },
    decreaseSicknessLevel() {
        let currentSicknessLevel = SicknessService.getSicknessLevel() - 10;
        currentSicknessLevel = currentSicknessLevel < 0 ? 0 : currentSicknessLevel;
        SicknessService.setSicknessLevel(currentSicknessLevel);
        console.log(`Sickness level decreased to: ${currentSicknessLevel}`);
        return currentSicknessLevel;
    }
}

export default SicknessService;