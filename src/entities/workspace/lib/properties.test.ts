import { describe, expect, it } from "vitest";
import { mapProperties, providerLabelKey } from "./properties";

const PAYLOAD = {
  project: {
    name: "example.com",
    base_url: "https://example.com",
    default_property: "sc-domain:example.com",
  },
  providers: [
    {
      provider: "gsc",
      configured: true,
      target: "sc-domain:example.com",
      requires_token: true,
      token: "present",
      token_present: true,
      ready: true,
    },
    {
      provider: "bing",
      configured: true,
      target: "https://example.com",
      requires_token: true,
      token: "missing",
      token_present: false,
      ready: false,
    },
    {
      provider: "psi",
      configured: true,
      target: "https://example.com/",
      requires_token: false,
      token: "missing",
      token_present: false,
      ready: true,
    },
    {
      provider: "crux",
      configured: false,
      target: "",
      requires_token: true,
      token: "missing",
      token_present: false,
      ready: false,
    },
  ],
};

describe("mapProperties", () => {
  it("maps the snake_case engine payload without inventing values", () => {
    const view = mapProperties(PAYLOAD);

    expect(view.project).toEqual({
      name: "example.com",
      baseUrl: "https://example.com",
      defaultProperty: "sc-domain:example.com",
    });
    expect(view.configuredCount).toBe(3);
    expect(view.readyCount).toBe(2);
    expect(view.rows).toHaveLength(4);
    expect(view.rows[0]).toMatchObject({
      provider: "gsc",
      target: "sc-domain:example.com",
      token: "present",
      ready: true,
    });
    expect(view.rows[1].token).toBe("missing");
    expect(view.rows[2].token).toBe("not_required");
    expect(view.rows[3]).toMatchObject({
      provider: "crux",
      target: null,
      configured: false,
      ready: false,
    });
  });

  it("keeps an unknown token state unknown", () => {
    const view = mapProperties({
      providers: [
        {
          provider: "yandex_webmaster",
          configured: true,
          target: "example.com",
          requires_token: true,
        },
      ],
    });
    expect(view.rows[0].token).toBe("unknown");
    expect(view.rows[0].ready).toBe(false);
  });

  it("tolerates malformed payloads instead of throwing", () => {
    expect(mapProperties(null)).toEqual({
      project: { name: null, baseUrl: null, defaultProperty: null },
      rows: [],
      configuredCount: 0,
      readyCount: 0,
    });
    expect(mapProperties({ providers: [null, 1, { provider: " " }] }).rows).toEqual([]);
    expect(mapProperties("nope").rows).toEqual([]);
  });

  it("maps every known provider to an existing localized label key", () => {
    expect(providerLabelKey("gsc")).toBe("recommendations.provider.gsc");
    expect(providerLabelKey("yandex_metrika")).toBe(
      "recommendations.provider.yandex_metrika",
    );
    expect(providerLabelKey("unknown")).toBeNull();
  });
});
