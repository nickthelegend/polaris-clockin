import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import {
  applyAppTarget,
  brandFileFor,
  DEFAULT_APP_URL,
  iconUrls,
  localizeIcons,
  manifestChecksum,
  resolveAppUrl,
} from "../scripts/lib/target.mjs";

/** What the Android app opens, and where generation takes its icons from. */

const manifest = () => ({
  packageId: "app.polarispay.twa",
  host: "app.polarispay.app",
  startUrl: "/",
  iconUrl: "https://app.polarispay.app/icons/icon-512.png",
  maskableIconUrl: "https://app.polarispay.app/icons/maskable-512.png",
  fullScopeUrl: "https://app.polarispay.app/",
  shortcuts: [
    {
      name: "Send money",
      shortName: "Send",
      url: "/send",
      chosenIconUrl: "https://app.polarispay.app/icons/shortcut-send.png",
      chosenMaskableIconUrl: "https://app.polarispay.app/icons/shortcut-send.png",
    },
    { name: "Elsewhere", shortName: "Else", url: "/x", chosenIconUrl: "https://cdn.example.com/x.png" },
  ],
});

describe("resolveAppUrl", () => {
  it("defaults to the hosted app", () => {
    assert.equal(DEFAULT_APP_URL, "https://app.polarispay.app/");
    assert.deepEqual(resolveAppUrl(undefined), { host: "app.polarispay.app", startUrl: "/" });
    assert.deepEqual(resolveAppUrl("  "), { host: "app.polarispay.app", startUrl: "/" });
  });

  it("keeps a start path and query", () => {
    assert.deepEqual(resolveAppUrl("https://staging.polarispay.app/pay?from=android"), {
      host: "staging.polarispay.app",
      startUrl: "/pay?from=android",
    });
    assert.deepEqual(resolveAppUrl("https://staging.polarispay.app"), { host: "staging.polarispay.app", startUrl: "/" });
  });

  it("refuses what a Trusted Web Activity can't open or verify", () => {
    assert.throws(() => resolveAppUrl("http://app.polarispay.app/"), /must be https/);
    assert.throws(() => resolveAppUrl("https://localhost:3000/"), /must not name a port/);
    assert.throws(() => resolveAppUrl("https://user:pw@app.polarispay.app/"), /credentials/);
    assert.throws(() => resolveAppUrl("https://app.polarispay.app/#home"), /fragment/);
    assert.throws(() => resolveAppUrl("app.polarispay.app"), /not a URL/);
  });
});

describe("applyAppTarget", () => {
  it("moves the host, the start URL and every URL on the old host", () => {
    const before = manifest();
    const after = applyAppTarget(before, { host: "staging.polarispay.app", startUrl: "/pay" });
    assert.equal(after.host, "staging.polarispay.app");
    assert.equal(after.startUrl, "/pay");
    assert.equal(after.iconUrl, "https://staging.polarispay.app/icons/icon-512.png");
    assert.equal(after.maskableIconUrl, "https://staging.polarispay.app/icons/maskable-512.png");
    assert.equal(after.fullScopeUrl, "https://staging.polarispay.app/");
    assert.equal(after.shortcuts?.[0]?.chosenIconUrl, "https://staging.polarispay.app/icons/shortcut-send.png");
    assert.equal(after.shortcuts?.[1]?.chosenIconUrl, "https://cdn.example.com/x.png", "another host's URL is left alone");
    assert.equal(before.host, "app.polarispay.app", "the input is not changed");
  });
});

describe("icons", () => {
  it("lists every icon URL", () => {
    assert.deepEqual(iconUrls(manifest()), [
      "https://app.polarispay.app/icons/icon-512.png",
      "https://app.polarispay.app/icons/maskable-512.png",
      "https://app.polarispay.app/icons/shortcut-send.png",
      "https://app.polarispay.app/icons/shortcut-send.png",
      "https://cdn.example.com/x.png",
    ]);
  });

  it("maps the app's /icons/ to @polaris/brand files", () => {
    assert.equal(brandFileFor("https://app.polarispay.app/icons/icon-512.png", "app.polarispay.app"), "app-icon-512.png");
    assert.equal(brandFileFor("https://app.polarispay.app/icons/maskable-512.png", "app.polarispay.app"), "app-icon-maskable-512.png");
    assert.equal(brandFileFor("https://app.polarispay.app/icons/nope.png", "app.polarispay.app"), null);
    assert.equal(brandFileFor("https://other.example/icons/icon-512.png", "app.polarispay.app"), null);
  });

  it("serves them locally for generation, and refuses an icon the brand package doesn't have", () => {
    const { shortcuts: [send] = [], ...rest } = manifest();
    const local = localizeIcons({ ...rest, shortcuts: send ? [send] : [] }, "http://127.0.0.1:3920");
    assert.equal(local.iconUrl, "http://127.0.0.1:3920/icons/icon-512.png");
    assert.equal(local.shortcuts?.[0]?.chosenMaskableIconUrl, "http://127.0.0.1:3920/icons/shortcut-send.png");
    assert.equal(local.host, "app.polarispay.app", "only the icons move");
    assert.throws(() => localizeIcons(manifest(), "http://127.0.0.1:3920"), /cdn\.example\.com\/x\.png is not one of the app's \/icons\//);
  });
});

describe("manifestChecksum", () => {
  it("is Bubblewrap's: SHA-1 of the file's bytes", () => {
    assert.equal(manifestChecksum("{}\n"), createHash("sha1").update("{}\n").digest("hex"));
  });
});
