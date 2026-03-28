import StatService from "#root/services/StatService.js";

const thirstStat = StatService.create("thirst", {
  min: 0,
  max: 100,
  initial: 0,
});

let hasMessageBeenSent = false;

async function instantiate() {
  if (thirstStat.getLevel() >= 0) {
    thirstStat.increase();
  }
  if (!hasMessageBeenSent && thirstStat.getLevel() === 100) {
    hasMessageBeenSent = true;
    return;
  }
}

const ThirstService = {
  instantiate() {
    setInterval(() => instantiate(), 15 * 1000);
  },
  getThirstLevel() {
    return thirstStat.getLevel();
  },
  setThirstLevel(level) {
    return thirstStat.setLevel(level);
  },
  increaseThirstLevel() {
    return thirstStat.increase();
  },
  decreaseThirstLevel() {
    return thirstStat.decrease();
  },
};

export default ThirstService;
