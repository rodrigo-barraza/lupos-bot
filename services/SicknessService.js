import StatService from "#root/services/StatService.js";

const sicknessStat = StatService.create("sickness", {
  min: 0,
  max: 100,
  initial: 0,
  step: 10,
});

const SicknessService = {
  getSicknessLevel() {
    return sicknessStat.getLevel();
  },
  setSicknessLevel(level) {
    return sicknessStat.setLevel(level);
  },
  increaseSicknessLevel() {
    return sicknessStat.increase();
  },
  decreaseSicknessLevel() {
    return sicknessStat.decrease();
  },
};

export default SicknessService;
