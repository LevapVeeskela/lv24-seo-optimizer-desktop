/**
 * Localized copy for the report export panel. Kept in the feature until the
 * shared `en/ru/zh` dictionaries gain `reports.export.*` keys.
 */
import type { Locale } from "@/shared/i18n";

export interface ReportExportCopy {
  title: string;
  hint: string;
  json: string;
  csv: string;
  saving: string;
  saved: string;
  folder: string;
  failed: string;
  noFolderTitle: string;
  noFolderHint: string;
  csvColumns: string;
}

const en: ReportExportCopy = {
  title: "Export",
  hint: "Write the current report to the app export folder.",
  json: "Export JSON",
  csv: "Export CSV",
  saving: "Saving…",
  saved: "Saved to {path}",
  folder: "Folder: {path}",
  failed: "Could not save the export.",
  noFolderTitle: "Export folder is unknown",
  noFolderHint:
    "The desktop shell did not report its export folder. Reconnect and try again.",
  csvColumns: "CSV columns: section, metric, value, delta.",
};

const ru: ReportExportCopy = {
  title: "Экспорт",
  hint: "Сохраняет текущий отчёт в папку экспорта приложения.",
  json: "Экспорт JSON",
  csv: "Экспорт CSV",
  saving: "Сохранение…",
  saved: "Сохранено в {path}",
  folder: "Папка: {path}",
  failed: "Не удалось сохранить экспорт.",
  noFolderTitle: "Папка экспорта неизвестна",
  noFolderHint:
    "Оболочка не сообщила папку экспорта. Переподключитесь и повторите.",
  csvColumns: "Колонки CSV: section, metric, value, delta.",
};

const zh: ReportExportCopy = {
  title: "导出",
  hint: "将当前报告写入应用导出目录。",
  json: "导出 JSON",
  csv: "导出 CSV",
  saving: "正在保存…",
  saved: "已保存到 {path}",
  folder: "目录：{path}",
  failed: "无法保存导出文件。",
  noFolderTitle: "未知导出目录",
  noFolderHint: "桌面外壳未报告导出目录，请重新连接后重试。",
  csvColumns: "CSV 列：section、metric、value、delta。",
};

const dictionaries: Record<Locale, ReportExportCopy> = { en, ru, zh };

export function reportExportCopy(locale: Locale): ReportExportCopy {
  return dictionaries[locale] ?? en;
}
