import StatService from "#root/services/StatService.js";

const substanceStat = StatService.create("substance", {
  min: 0,
  max: 10,
  initial: 0,
});

const SubstanceService = {
  getSubstanceLevel() {
    return substanceStat.getLevel();
  },
  setSubstanceLevel(level: number) {
    return substanceStat.setLevel(level);
  },
  increaseSubstanceLevel() {
    return substanceStat.increase();
  },
  decreaseSubstanceLevel() {
    return substanceStat.decrease();
  },
};

export default SubstanceService;
