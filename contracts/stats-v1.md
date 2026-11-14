# Stats contract v1

`lv24-seo stats --days 7 --lag-days 2 --json` returns the standard envelope. The generated fixture
is [`cli-v1/stats.json`](cli-v1/stats.json). `data`:

```json
{
  "period": { "start": "2026-11-07", "end": "2026-11-13" },
  "previous_period": { "start": "2026-10-31", "end": "2026-11-06" },
  "generated_at": "2026-11-14T12:00:00+00:00",
  "services": [
    {
      "provider": "gsc",
      "label": "Google Search Console",
      "configured": true,
      "ready": true,
      "status": "ok",
      "metrics": {
        "clicks": 1284,
        "impressions": 48213,
        "ctr": 0.0266,
        "position": 8.4
      },
      "previous": {
        "clicks": 1048,
        "impressions": 46761,
        "ctr": 0.0224,
        "position": 9.2
      },
      "rows": 7,
      "data_age_days": 2,
      "truncated": false,
      "limitations": [],
      "warnings": [],
      "error": null
    }
  ],
  "coverage": {
    "configured": 6,
    "returned": 5,
    "failed": 0,
    "missing": 1,
    "complete": false
  },
  "limitations": [],
  "warnings": []
}
```

## Rules

- `provider`: `gsc`, `yandex_webmaster`, `yandex_metrika`, `bing`, `crux`, `psi`.
- `status`: `ok` (rows returned), `no_data` (configured and reachable, no rows),
  `missing_token`, `not_configured`, `error`.
- `configured`: target present in `seo.toml`. `ready`: target + required token.
- `metrics` only contains values actually reported. No zero fill, no cross-engine totals.
- `previous` only for comparable current/previous windows (GSC, Yandex, Metrika); `null`
  for Bing/CrUX/PSI and when unavailable.
- `ctr` is a 0..1 ratio; UI formats as a percent.
- `position` is the provider's average position; lower is better.
- CrUX metrics are p75 values: `largest_contentful_paint`, `interaction_to_next_paint`,
  `cumulative_layout_shift`; `units` maps metric -> `ms` or `score`.
- PSI metrics are lab values from the first configured URL (no averaging):
  `performance`/`seo` scores (0..1) plus field rows when present; `limitations` says
  "lab data, first URL only" when multiple URLs are configured.
- `rows` is the number of rows returned by the provider (not a total).
- `data_age_days`, `truncated`, `limitations`, `warnings` come from the provider result.
- `error` is `{code, message}` for `status=error`; never a traceback.
- `coverage.complete` is true only when every configured service is `ok`, has rows,
  is not truncated, and no configured service is missing/failed.
- `stats` is read-only: no snapshots, pages or issues are written.
- `meta.version` is the CLI package version; desktop pins a minimum version.
