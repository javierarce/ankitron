// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { MEDIA_ATTR, prepareCardHtml } from "./audio";

describe("prepareCardHtml", () => {
  it("defers collection-media images so no broken icon flashes", () => {
    const out = prepareCardHtml('<p>Bayern</p><img src="bayern.jpg">');
    // The bare src is removed (browser won't try to load the missing file)...
    expect(out).not.toMatch(/src=/);
    // ...and stashed for the caller to resolve, starting transparent.
    expect(out).toContain(`${MEDIA_ATTR}="bayern.jpg"`);
    expect(out).toContain("opacity: 0");
  });

  it("decodes percent-escaped filenames", () => {
    const out = prepareCardHtml('<img src="My%20Karte.jpg">');
    expect(out).toContain(`${MEDIA_ATTR}="My Karte.jpg"`);
  });

  it("leaves URLs the browser can already load untouched", () => {
    const html = '<img src="https://example.com/a.png">';
    expect(prepareCardHtml(html)).toBe(html);
  });

  it("returns the input unchanged when there are no media images", () => {
    const html = "<p>no images here</p>";
    expect(prepareCardHtml(html)).toBe(html);
  });
});
