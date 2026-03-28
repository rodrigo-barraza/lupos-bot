import StatService from "#root/services/StatService.js";

const energyStat = StatService.create("energy", {
  min: 0,
  max: 100,
  initial: 100,
});

let hasMessageBeenSent = false;

async function instantiate() {
  if (energyStat.getLevel() !== 0) {
    energyStat.decrease();
  }
  if (!hasMessageBeenSent && energyStat.getLevel() === 0) {
    hasMessageBeenSent = true;
    return;
  }
}

const EnergyService = {
  instantiate() {
    setInterval(() => instantiate(), 30 * 1000);
  },
  getEnergyLevel() {
    return energyStat.getLevel();
  },
  setEnergyLevel(level) {
    return energyStat.setLevel(level);
  },
  increaseEnergyLevel() {
    return energyStat.increase();
  },
  decreaseEnergyLevel() {
    return energyStat.decrease();
  },
};

export default EnergyService;
