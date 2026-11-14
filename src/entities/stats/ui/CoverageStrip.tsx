import { useI18n } from "@/shared/i18n";
import { Badge } from "@/shared/ui/Badge";
import type { StatsCoverage } from "@/entities/stats/model/types";

export function CoverageStrip({ coverage }: { coverage?: StatsCoverage }) {
  const { t } = useI18n();
  if (!coverage) {
    return null;
  }
  const items = [
    { key: "dashboard.coverageConfigured", value: coverage.configured },
    { key: "dashboard.coverageReturned", value: coverage.returned },
    { key: "dashboard.coverageFailed", value: coverage.failed },
    { key: "dashboard.coverageMissing", value: coverage.missing },
  ] as const;

  return (
    <div className="coverage-strip" role="list">
      {items.map((item) => (
        <div className="coverage-item" role="listitem" key={item.key}>
          <span>{t(item.key)}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
      <div className="coverage-item" role="listitem">
        <span>{t("dashboard.coverage")}</span>
        <Badge tone={coverage.complete ? "success" : "warning"}>
          {coverage.complete
            ? t("dashboard.coverageComplete")
            : t("dashboard.coverageIncomplete")}
        </Badge>
      </div>
    </div>
  );
}
