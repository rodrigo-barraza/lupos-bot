import { describe, it, expect } from "vitest";
import CensorService from "../CensorService.js";

describe("CensorService", () => {
  describe("containsFlaggedWords", () => {
    it("should detect direct slurs", () => {
      expect(CensorService.containsFlaggedWords("you are a nigger")).toBe(true);
      expect(CensorService.containsFlaggedWords("stupid faggot")).toBe(true);
      expect(CensorService.containsFlaggedWords("go kys")).toBe(true);
      expect(CensorService.containsFlaggedWords("dirty spic")).toBe(true);
      expect(CensorService.containsFlaggedWords("dumb kike")).toBe(true);
    });

    it("should detect slurs embedded in sentences", () => {
      expect(CensorService.containsFlaggedWords("what a chink in armor")).toBe(true);
      expect(CensorService.containsFlaggedWords("stop being a fag about it")).toBe(true);
    });

    it("should not flag clean messages", () => {
      expect(CensorService.containsFlaggedWords("hello world")).toBe(false);
      expect(CensorService.containsFlaggedWords("this is a normal message")).toBe(false);
      expect(CensorService.containsFlaggedWords("great game last night")).toBe(false);
    });
  });

  describe("whitelisted words — country and demonym false positives", () => {
    it("should not flag 'nigeria' and related words", () => {
      expect(CensorService.containsFlaggedWords("Nigeria is in West Africa")).toBe(false);
      expect(CensorService.containsFlaggedWords("My friend is Nigerian")).toBe(false);
      expect(CensorService.containsFlaggedWords("Nigerians are talented")).toBe(false);
    });

    it("should not flag 'pakistan' and related words", () => {
      expect(CensorService.containsFlaggedWords("Pakistan won the match")).toBe(false);
      expect(CensorService.containsFlaggedWords("He is Pakistani")).toBe(false);
      expect(CensorService.containsFlaggedWords("Pakistanis are friendly")).toBe(false);
    });

    it("should not flag 'japan' and related words", () => {
      expect(CensorService.containsFlaggedWords("Japan is beautiful")).toBe(false);
      expect(CensorService.containsFlaggedWords("Japanese food is great")).toBe(false);
    });
  });

  describe("whitelisted words — animal and nature false positives", () => {
    it("should not flag 'raccoon' in any spelling", () => {
      expect(CensorService.containsFlaggedWords("Whose underwear are the racoons holding")).toBe(false);
      expect(CensorService.containsFlaggedWords("I saw a raccoon last night")).toBe(false);
      expect(CensorService.containsFlaggedWords("There are raccoons in the trash")).toBe(false);
      expect(CensorService.containsFlaggedWords("A racoon stole my food")).toBe(false);
    });

    it("should not flag 'cocoon' and its forms", () => {
      expect(CensorService.containsFlaggedWords("The caterpillar built a cocoon")).toBe(false);
      expect(CensorService.containsFlaggedWords("She cocooned herself in blankets")).toBe(false);
    });

    it("should not flag 'japonica'", () => {
      expect(CensorService.containsFlaggedWords("The japonica is blooming")).toBe(false);
    });

    it("should not flag coonhound or coonskin", () => {
      expect(CensorService.containsFlaggedWords("He wears a coonskin cap")).toBe(false);
      expect(CensorService.containsFlaggedWords("The coonhound barked")).toBe(false);
    });
  });

  describe("whitelisted words — food and common noun false positives", () => {
    it("should not flag 'sauerkraut'", () => {
      expect(CensorService.containsFlaggedWords("I love sauerkraut on my hotdog")).toBe(false);
    });

    it("should not flag 'spice' and its forms", () => {
      expect(CensorService.containsFlaggedWords("Add some spice to the dish")).toBe(false);
      expect(CensorService.containsFlaggedWords("This food is very spicy")).toBe(false);
      expect(CensorService.containsFlaggedWords("I spiced the curry")).toBe(false);
    });

    it("should not flag 'aspic' and 'allspice'", () => {
      expect(CensorService.containsFlaggedWords("The meat is set in aspic")).toBe(false);
      expect(CensorService.containsFlaggedWords("Buy some allspice at the store")).toBe(false);
    });

    it("should not flag 'custard' and 'mustard'", () => {
      expect(CensorService.containsFlaggedWords("I love custard")).toBe(false);
      expect(CensorService.containsFlaggedWords("Pass the mustard please")).toBe(false);
    });
  });

  describe("whitelisted words — vocabulary false positives", () => {
    it("should not flag 'enigma' and its forms", () => {
      expect(CensorService.containsFlaggedWords("That person is an enigma")).toBe(false);
      expect(CensorService.containsFlaggedWords("How enigmatic")).toBe(false);
    });

    it("should not flag 'denigrate' and its forms", () => {
      expect(CensorService.containsFlaggedWords("Don't denigrate others")).toBe(false);
      expect(CensorService.containsFlaggedWords("That's denigrating")).toBe(false);
    });

    it("should not flag 'conspicuous' and its forms", () => {
      expect(CensorService.containsFlaggedWords("It was conspicuous")).toBe(false);
      expect(CensorService.containsFlaggedWords("She was inconspicuous")).toBe(false);
    });

    it("should not flag 'suspicious' and its forms", () => {
      expect(CensorService.containsFlaggedWords("That's suspicious")).toBe(false);
      expect(CensorService.containsFlaggedWords("I have a suspicion")).toBe(false);
    });

    it("should not flag 'hospice'", () => {
      expect(CensorService.containsFlaggedWords("She works at a hospice")).toBe(false);
    });

    it("should not flag 'jape' and its forms", () => {
      expect(CensorService.containsFlaggedWords("It was just a jape")).toBe(false);
      expect(CensorService.containsFlaggedWords("He japed about the situation")).toBe(false);
    });

    it("should not flag 'despicable'", () => {
      expect(CensorService.containsFlaggedWords("That's despicable behavior")).toBe(false);
    });

    it("should not flag 'benign'", () => {
      expect(CensorService.containsFlaggedWords("The tumor was benign")).toBe(false);
    });

    it("should not flag 'auspicious'", () => {
      expect(CensorService.containsFlaggedWords("An auspicious beginning")).toBe(false);
    });

    it("should not flag 'tycoon'", () => {
      expect(CensorService.containsFlaggedWords("She became a business tycoon")).toBe(false);
    });

    it("should not flag 'fagot' (bundle of sticks)", () => {
      expect(CensorService.containsFlaggedWords("A fagot of firewood")).toBe(false);
    });

    it("should not flag 'snigger'", () => {
      expect(CensorService.containsFlaggedWords("He sniggered quietly")).toBe(false);
    });

    it("should not flag 'niggle'", () => {
      expect(CensorService.containsFlaggedWords("A niggling doubt remained")).toBe(false);
    });
  });

  describe("whitelisted words — miscellaneous false positives", () => {
    it("should not flag 'swop' (British spelling of swap)", () => {
      expect(CensorService.containsFlaggedWords("Let's swop seats")).toBe(false);
    });

    it("should not flag 'vandyke' (beard style)", () => {
      expect(CensorService.containsFlaggedWords("He grew a vandyke beard")).toBe(false);
    });

    it("should not flag 'dike' (embankment)", () => {
      expect(CensorService.containsFlaggedWords("The dike held back the flood")).toBe(false);
      expect(CensorService.containsFlaggedWords("They reinforced the dikes")).toBe(false);
    });

    it("should not flag 'firecracker'", () => {
      expect(CensorService.containsFlaggedWords("The firecrackers were loud")).toBe(false);
    });

    it("should not flag 'leotard'", () => {
      expect(CensorService.containsFlaggedWords("She wore a leotard")).toBe(false);
    });

    it("should not flag 'tardy'", () => {
      expect(CensorService.containsFlaggedWords("Don't be tardy for class")).toBe(false);
    });

    it("should not flag skyscraper and related terms", () => {
      expect(CensorService.containsFlaggedWords("Look at that skyscraper")).toBe(false);
      expect(CensorService.containsFlaggedWords("There are many skyscrapers here")).toBe(false);
    });

    it("should not flag pedagogy", () => {
      expect(CensorService.containsFlaggedWords("He studies pedagogy")).toBe(false);
    });

    it("should not flag leafage and wharfage", () => {
      expect(CensorService.containsFlaggedWords("The autumn leafage is beautiful")).toBe(false);
      expect(CensorService.containsFlaggedWords("We paid the wharfage fee")).toBe(false);
    });

    it("should not flag pachinko", () => {
      expect(CensorService.containsFlaggedWords("They play pachinko in Japan")).toBe(false);
    });

    it("should not flag twopence", () => {
      expect(CensorService.containsFlaggedWords("It only costs a twopence")).toBe(false);
    });

    it("should not flag gobbledygook", () => {
      expect(CensorService.containsFlaggedWords("This writing is just gobbledygook")).toBe(false);
    });
  });

  describe("removeFlaggedWords", () => {
    it("should censor slurs with spoiler-wrapped asterisks", () => {
      const result = CensorService.removeFlaggedWords("you are a nigger");
      expect(result).not.toContain("nigger");
      expect(result).toContain("||");
    });

    it("should preserve whitelisted words untouched", () => {
      const input = "Nigeria is an enigma with raccoons and spicy sauerkraut";
      const result = CensorService.removeFlaggedWords(input);
      expect(result).toBe(input);
    });

    it("should preserve the racoon misspelling untouched", () => {
      const input = "Whose underwear are the racoons holding";
      const result = CensorService.removeFlaggedWords(input);
      expect(result).toBe(input);
    });

    it("should censor slurs but keep whitelisted words in mixed messages", () => {
      const result = CensorService.removeFlaggedWords("the raccoon called him a nigger");
      expect(result).toContain("raccoon");
      expect(result).not.toContain("nigger");
    });
  });
});
