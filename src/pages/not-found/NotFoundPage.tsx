import { Link } from "react-router-dom";
import { useI18n } from "@/shared/i18n";
import { Card } from "@/shared/ui/Card";

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>{t("notFound.title")}</h1>
          <p className="muted">{t("notFound.hint")}</p>
        </div>
      </header>
      <Card>
        <Link className="btn btn-primary" to="/">
          {t("notFound.action")}
        </Link>
      </Card>
    </section>
  );
}
