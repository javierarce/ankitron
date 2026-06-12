import { describe, expect, it } from "vitest";
import {
  extractSoundFilenames,
  resolveCardAudio,
  stripSoundTags,
} from "./audio";

describe("extractSoundFilenames", () => {
  it("collects filenames across fields in Anki field order", () => {
    const fields = {
      Back: { value: "Hello [sound:hello.mp3]", order: 1 },
      Front: { value: "Hallo [sound:hallo.mp3] [sound:hallo-2.mp3]", order: 0 },
    };
    expect(extractSoundFilenames(fields)).toEqual([
      "hallo.mp3",
      "hallo-2.mp3",
      "hello.mp3",
    ]);
  });

  it("returns an empty list when no field has audio", () => {
    expect(
      extractSoundFilenames({ Front: { value: "Hallo", order: 0 } })
    ).toEqual([]);
  });
});

describe("stripSoundTags", () => {
  it("removes sound tags and play placeholders", () => {
    expect(stripSoundTags("Hallo [sound:hallo.mp3] [anki:play:q:0]!")).toBe(
      "Hallo  !"
    );
  });
});

describe("resolveCardAudio", () => {
  const sounds = ["hallo.mp3", "hello.mp3"];

  it("maps both sides of the default template (answer embeds FrontSide)", () => {
    const card = resolveCardAudio(
      "Hallo [anki:play:q:0]",
      "Hallo [anki:play:a:0]<hr id=answer>Hello [anki:play:a:1]",
      sounds
    );
    expect(card.questionFiles).toEqual(["hallo.mp3"]);
    expect(card.answerFiles).toEqual(["hallo.mp3", "hello.mp3"]);
    expect(card.questionHtml).toContain('data-audio-file="hallo.mp3"');
    expect(card.answerHtml).toContain('data-audio-file="hello.mp3"');
    expect(card.answerHtml).not.toContain("[anki:play");
  });

  it("offsets answer indexes when the template omits FrontSide", () => {
    const card = resolveCardAudio(
      "Hallo [anki:play:q:0]",
      "Hello [anki:play:a:0]",
      sounds
    );
    expect(card.answerFiles).toEqual(["hello.mp3"]);
  });

  it("drops placeholders it cannot map to a filename", () => {
    const card = resolveCardAudio(
      "Hallo [anki:play:q:0] [anki:play:q:1]",
      "<hr id=answer>Hello",
      ["hallo.mp3"]
    );
    expect(card.questionFiles).toEqual(["hallo.mp3"]);
    expect(card.questionHtml).not.toContain("[anki:play");
  });

  it("leaves audio-free cards untouched", () => {
    const card = resolveCardAudio("Hallo", "Hallo<hr id=answer>Hello", []);
    expect(card.questionHtml).toBe("Hallo");
    expect(card.answerHtml).toBe("Hallo<hr id=answer>Hello");
    expect(card.questionFiles).toEqual([]);
    expect(card.answerFiles).toEqual([]);
  });

  it("escapes filenames in the button attribute", () => {
    const card = resolveCardAudio('[anki:play:q:0]', "", ['ha"llo.mp3']);
    expect(card.questionHtml).toContain('data-audio-file="ha&quot;llo.mp3"');
  });
});
