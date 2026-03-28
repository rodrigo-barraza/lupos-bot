import StatService from "#root/services/StatService.js";

const bathroomStat = StatService.create("bathroom", {
  min: 0,
  max: 100,
  initial: 0,
});

function instantiate() {
  // Bathroom level increases over time (currently dormant)
}

const BathroomService = {
  instantiate() {
    setInterval(() => instantiate(), 15 * 1000);
  },
  getBathroomLevel() {
    return bathroomStat.getLevel();
  },
  setBathroomLevel(level) {
    return bathroomStat.setLevel(level);
  },
  increaseBathroomLevel() {
    return bathroomStat.increase();
  },
  decreaseBathroomLevel() {
    return bathroomStat.decrease();
  },
};

export default BathroomService;
