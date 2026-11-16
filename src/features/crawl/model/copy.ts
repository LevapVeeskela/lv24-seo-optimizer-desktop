import type { CrawlSeverity } from "@/entities/crawl";
import type { Locale } from "@/shared/i18n";

/**
 * Crawl-screen copy lives here, next to the page, because the shared i18n
 * dictionary is owned by another package in this wave. All three locales are
 * complete, so the screen ships with parity; see the handoff note about
 * moving these keys into `shared/i18n` once that file is free.
 */
export interface CrawlCopy {
  title: string;
  subtitle: string;
  lastRun: string;
  run: string;
  running: string;
  runHint: string;
  startLabel: string;
  startHint: string;
  startPlaceholder: string;
  startInvalid: string;
  siteLabel: string;
  maxUrlsLabel: string;
  maxUrlsHint: string;
  maxUrlsInvalid: string;
  summaryTitle: string;
  summaryHint: string;
  statUrls: string;
  statFetched: string;
  statErrors: string;
  statBlocked: string;
  statIssues: string;
  statSitemap: string;
  statRequests: string;
  truncated: string;
  notTruncated: string;
  filtersTitle: string;
  severity: string;
  rule: string;
  allSeverities: string;
  allRules: string;
  search: string;
  searchPlaceholder: string;
  resetFilters: string;
  issuesTitle: string;
  issuesCaption: string;
  tableSeverity: string;
  tableRule: string;
  tableUrl: string;
  tableDetail: string;
  tableCap: string;
  emptyTitle: string;
  emptyHint: string;
  cleanTitle: string;
  cleanHint: string;
  filteredEmptyTitle: string;
  filteredEmptyHint: string;
  loading: string;
  offlineTitle: string;
  offlineHint: string;
  noWorkspaceTitle: string;
  noWorkspaceHint: string;
  openSettings: string;
  errorTitle: string;
  retry: string;
  warnings: string;
  limitations: string;
  exportTitle: string;
  exportHint: string;
  exportJson: string;
  exportCsv: string;
  exporting: string;
  exportedTo: string;
  exportFailed: string;
  exportNoRoot: string;
  severityLabel: Record<CrawlSeverity, string>;
}

const en: CrawlCopy = {
  title: "Site crawl",
  subtitle:
    "Fetch the site within a URL budget and review every rule violation with evidence.",
  lastRun: "Last run",
  run: "Run crawl",
  running: "Crawling…",
  runHint:
    "The crawl respects robots.txt, follows same-host links and stores pages and issues locally.",
  startLabel: "Start URL",
  startHint: "Leave blank to use the project base_url from seo.toml.",
  startPlaceholder: "https://example.com",
  startInvalid: "Enter an absolute URL starting with http:// or https://.",
  siteLabel: "Site",
  maxUrlsLabel: "Maximum URLs",
  maxUrlsHint: "1–10000. Leave blank to use the budget from seo.toml.",
  maxUrlsInvalid: "Enter a whole number between 1 and 10000.",
  summaryTitle: "Crawl summary",
  summaryHint: "Counts come from this run; missing values stay unknown.",
  statUrls: "URLs seen",
  statFetched: "Fetched",
  statErrors: "Fetch errors",
  statBlocked: "Robots-blocked",
  statIssues: "Issues",
  statSitemap: "Sitemap URLs",
  statRequests: "Requests",
  truncated: "Crawl truncated",
  notTruncated: "Full crawl",
  filtersTitle: "Filters",
  severity: "Severity",
  rule: "Rule",
  allSeverities: "All severities",
  allRules: "All rules",
  search: "Search",
  searchPlaceholder: "URL, rule or detail",
  resetFilters: "Reset filters",
  issuesTitle: "Issues",
  issuesCaption: "Crawl rule violations",
  tableSeverity: "Severity",
  tableRule: "Rule",
  tableUrl: "URL",
  tableDetail: "Detail",
  tableCap:
    "Showing the first {shown} of {total} matching issues. Narrow the filters or use the export for the full list.",
  emptyTitle: "No crawl yet",
  emptyHint:
    "Set a start URL or leave it blank to crawl the project base_url. Results stay local.",
  cleanTitle: "No rule violations in this crawl",
  cleanHint:
    "Check the summary and warnings: an empty or truncated crawl is not proof that the site is clean.",
  filteredEmptyTitle: "No issues match these filters",
  filteredEmptyHint: "Change the severity, rule or search text.",
  loading: "Crawling the site…",
  offlineTitle: "Engine unavailable",
  offlineHint: "Check the lv24-seo installation, then retry.",
  noWorkspaceTitle: "No project selected",
  noWorkspaceHint: "Open a seo.toml in Settings before running a crawl.",
  openSettings: "Open settings",
  errorTitle: "Crawl failed",
  retry: "Retry",
  warnings: "Warnings",
  limitations: "Limitations",
  exportTitle: "Export",
  exportHint:
    "JSON keeps the full CLI payload; CSV contains every issue from the displayed run.",
  exportJson: "Export JSON",
  exportCsv: "Export CSV",
  exporting: "Saving…",
  exportedTo: "Saved to",
  exportFailed: "The export could not be written.",
  exportNoRoot: "The app export directory is unavailable.",
  severityLabel: {
    critical: "Critical",
    high: "High",
    medium: "Medium",
    low: "Low",
    unknown: "Unknown",
  },
};

const ru: CrawlCopy = {
  title: "Краулинг сайта",
  subtitle:
    "Обойдите сайт в пределах бюджета URL и разберите каждое нарушение правил с доказательствами.",
  lastRun: "Последний запуск",
  run: "Запустить краулинг",
  running: "Краулинг…",
  runHint:
    "Краулер соблюдает robots.txt, идёт по ссылкам того же хоста и сохраняет страницы и проблемы локально.",
  startLabel: "Стартовый URL",
  startHint: "Пусто — используется base_url из seo.toml.",
  startPlaceholder: "https://example.com",
  startInvalid: "Введите абсолютный URL с http:// или https://.",
  siteLabel: "Сайт",
  maxUrlsLabel: "Максимум URL",
  maxUrlsHint: "1–10000. Пусто — бюджет из seo.toml.",
  maxUrlsInvalid: "Введите целое число от 1 до 10000.",
  summaryTitle: "Итоги краулинга",
  summaryHint: "Счётчики относятся к этому запуску; отсутствующие значения остаются неизвестными.",
  statUrls: "URL найдено",
  statFetched: "Загружено",
  statErrors: "Ошибки загрузки",
  statBlocked: "Заблокировано robots",
  statIssues: "Проблемы",
  statSitemap: "URL в sitemap",
  statRequests: "Запросы",
  truncated: "Краул усечён",
  notTruncated: "Полный краул",
  filtersTitle: "Фильтры",
  severity: "Важность",
  rule: "Правило",
  allSeverities: "Все важности",
  allRules: "Все правила",
  search: "Поиск",
  searchPlaceholder: "URL, правило или детали",
  resetFilters: "Сбросить фильтры",
  issuesTitle: "Проблемы",
  issuesCaption: "Нарушения правил краулинга",
  tableSeverity: "Важность",
  tableRule: "Правило",
  tableUrl: "URL",
  tableDetail: "Детали",
  tableCap:
    "Показаны первые {shown} из {total} подходящих проблем. Сузьте фильтры или используйте экспорт для полного списка.",
  emptyTitle: "Краулинг ещё не запускался",
  emptyHint:
    "Укажите стартовый URL или оставьте поле пустым, чтобы обойти base_url проекта. Результаты остаются локально.",
  cleanTitle: "Нарушений правил не найдено",
  cleanHint:
    "Проверьте итоги и предупреждения: пустой или усечённый краул не доказывает, что сайт чист.",
  filteredEmptyTitle: "Нет проблем по этим фильтрам",
  filteredEmptyHint: "Измените важность, правило или поисковый запрос.",
  loading: "Краулинг сайта…",
  offlineTitle: "Движок недоступен",
  offlineHint: "Проверьте установку lv24-seo и повторите.",
  noWorkspaceTitle: "Проект не выбран",
  noWorkspaceHint: "Откройте seo.toml в настройках, чтобы запустить краулинг.",
  openSettings: "Открыть настройки",
  errorTitle: "Краулинг не удался",
  retry: "Повторить",
  warnings: "Предупреждения",
  limitations: "Ограничения",
  exportTitle: "Экспорт",
  exportHint:
    "JSON сохраняет полный ответ CLI; CSV содержит все проблемы показанного запуска.",
  exportJson: "Экспорт JSON",
  exportCsv: "Экспорт CSV",
  exporting: "Сохранение…",
  exportedTo: "Сохранено в",
  exportFailed: "Не удалось записать экспорт.",
  exportNoRoot: "Каталог экспорта приложения недоступен.",
  severityLabel: {
    critical: "Критично",
    high: "Высокая",
    medium: "Средняя",
    low: "Низкая",
    unknown: "Неизвестно",
  },
};

const zh: CrawlCopy = {
  title: "网站抓取",
  subtitle: "在 URL 预算内抓取网站，并查看每条规则问题的证据。",
  lastRun: "上次运行",
  run: "开始抓取",
  running: "正在抓取…",
  runHint: "抓取遵守 robots.txt，仅跟随同主机链接，并在本地保存页面与问题。",
  startLabel: "起始 URL",
  startHint: "留空则使用 seo.toml 中的 base_url。",
  startPlaceholder: "https://example.com",
  startInvalid: "请输入以 http:// 或 https:// 开头的绝对 URL。",
  siteLabel: "站点",
  maxUrlsLabel: "最大 URL 数",
  maxUrlsHint: "1–10000。留空则使用 seo.toml 中的预算。",
  maxUrlsInvalid: "请输入 1 到 10000 之间的整数。",
  summaryTitle: "抓取摘要",
  summaryHint: "计数来自本次运行；缺失值保持未知。",
  statUrls: "发现的 URL",
  statFetched: "已抓取",
  statErrors: "抓取错误",
  statBlocked: "被 robots 阻止",
  statIssues: "问题",
  statSitemap: "Sitemap URL",
  statRequests: "请求数",
  truncated: "抓取已截断",
  notTruncated: "完整抓取",
  filtersTitle: "筛选",
  severity: "严重程度",
  rule: "规则",
  allSeverities: "全部严重程度",
  allRules: "全部规则",
  search: "搜索",
  searchPlaceholder: "URL、规则或详情",
  resetFilters: "重置筛选",
  issuesTitle: "问题",
  issuesCaption: "抓取规则问题",
  tableSeverity: "严重程度",
  tableRule: "规则",
  tableUrl: "URL",
  tableDetail: "详情",
  tableCap:
    "仅显示 {total} 条匹配问题中的前 {shown} 条。请缩小筛选范围，或使用导出获取完整列表。",
  emptyTitle: "尚未运行抓取",
  emptyHint: "输入起始 URL，或留空以抓取项目的 base_url。结果只保存在本地。",
  cleanTitle: "本次抓取未发现规则问题",
  cleanHint: "请查看摘要和警告：空抓取或截断的抓取不能证明网站没有问题。",
  filteredEmptyTitle: "没有符合筛选条件的问题",
  filteredEmptyHint: "调整严重程度、规则或搜索内容。",
  loading: "正在抓取网站…",
  offlineTitle: "引擎不可用",
  offlineHint: "请检查 lv24-seo 安装后重试。",
  noWorkspaceTitle: "未选择项目",
  noWorkspaceHint: "请先在设置中打开 seo.toml，再运行抓取。",
  openSettings: "打开设置",
  errorTitle: "抓取失败",
  retry: "重试",
  warnings: "警告",
  limitations: "限制",
  exportTitle: "导出",
  exportHint: "JSON 保留完整 CLI 响应；CSV 包含所显示运行的全部问题。",
  exportJson: "导出 JSON",
  exportCsv: "导出 CSV",
  exporting: "正在保存…",
  exportedTo: "已保存至",
  exportFailed: "导出写入失败。",
  exportNoRoot: "应用导出目录不可用。",
  severityLabel: {
    critical: "严重",
    high: "高",
    medium: "中",
    low: "低",
    unknown: "未知",
  },
};

const DICTIONARIES: Record<Locale, CrawlCopy> = { en, ru, zh };

export function crawlCopy(locale: Locale): CrawlCopy {
  return DICTIONARIES[locale] ?? en;
}
