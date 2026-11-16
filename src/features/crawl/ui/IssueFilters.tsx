import type { CrawlIssueFacets, CrawlFilters } from "@/entities/crawl";
import type { CrawlCopy } from "../model/copy";
import { Button } from "@/shared/ui/Button";
import { Field } from "@/shared/ui/Field";
import { Input } from "@/shared/ui/Input";
import { Select } from "@/shared/ui/Select";

export interface IssueFiltersProps {
  copy: CrawlCopy;
  facets: CrawlIssueFacets;
  filters: CrawlFilters;
  visibleCount: number;
  totalCount: number;
  onChange: (next: CrawlFilters) => void;
  onReset: () => void;
}

export function IssueFilters({
  copy,
  facets,
  filters,
  visibleCount,
  totalCount,
  onChange,
  onReset,
}: IssueFiltersProps) {
  const changed =
    filters.severity !== "all" || filters.rule !== "all" || filters.query !== "";

  return (
    <div className="toolbar crawl-filters" role="group" aria-label={copy.filtersTitle}>
      <Field id="crawl-filter-severity" label={copy.severity}>
        <Select
          id="crawl-filter-severity"
          value={filters.severity}
          onChange={(event) =>
            onChange({
              ...filters,
              severity: event.target.value as CrawlFilters["severity"],
            })
          }
        >
          <option value="all">{copy.allSeverities}</option>
          {facets.severities.map((item) => (
            <option key={item.value} value={item.value}>
              {copy.severityLabel[item.value]} ({item.count})
            </option>
          ))}
        </Select>
      </Field>
      <Field id="crawl-filter-rule" label={copy.rule}>
        <Select
          id="crawl-filter-rule"
          value={filters.rule}
          onChange={(event) =>
            onChange({ ...filters, rule: event.target.value })
          }
        >
          <option value="all">{copy.allRules}</option>
          {facets.rules.map((item) => (
            <option key={item.value} value={item.value}>
              {item.value} ({item.count})
            </option>
          ))}
        </Select>
      </Field>
      <Field id="crawl-filter-search" label={copy.search}>
        <Input
          id="crawl-filter-search"
          type="search"
          autoComplete="off"
          placeholder={copy.searchPlaceholder}
          value={filters.query}
          onChange={(event) =>
            onChange({ ...filters, query: event.target.value })
          }
        />
      </Field>
      <div className="crawl-filter-actions">
        <span className="muted small" role="status">
          {visibleCount} / {totalCount}
        </span>
        <Button
          variant="ghost"
          className="btn-small"
          disabled={!changed}
          onClick={onReset}
        >
          {copy.resetFilters}
        </Button>
      </div>
    </div>
  );
}
