/**
 * Localized copy for the report comparison view.
 *
 * The shared `en/ru/zh` dictionaries are owned by `src/shared/i18n`; this
 * module keeps the diff strings next to the entity until the shared keys land,
 * so en/ru/zh parity is preserved without editing another package's scope.
 */
import type { Locale } from "@/shared/i18n";

export interface ReportDiffCopy {
  title: string;
  hint: string;
  compare: string;
  comparing: string;
  idleTitle: string;
  idleHint: string;
  emptyTitle: string;
  emptyHint: string;
  noStoreTitle: string;
  noStoreHint: string;
  errorTitle: string;
  previous: string;
  current: string;
  property: string;
  comparable: string;
  notComparable: string;
  noChanges: string;
  headline: string;
  headlineEmpty: string;
  unknownMetrics: string;
  issues: string;
  issuesEmpty: string;
  opportunities: string;
  added: string;
  resolved: string;
  unchanged: string;
  opportunitiesEmpty: string;
  limitations: string;
  limitationsAdded: string;
  limitationsLifted: string;
  limitationsEmpty: string;
  caveats: string;
  metric: string;
  delta: string;
  deltaPct: string;
  more: string;
}

const en: ReportDiffCopy = {
  title: "Compare with previous",
  hint: "Compares the two newest stored weekly snapshots. Providers are not called.",
  compare: "Compare with previous",
  comparing: "Comparing…",
  idleTitle: "Comparison not loaded",
  idleHint: "Load the comparison to see what changed since the previous snapshot.",
  emptyTitle: "No previous snapshot yet",
  emptyHint:
    "Build the weekly report for another period; the comparison appears once two snapshots are stored.",
  noStoreTitle: "No local snapshot store",
  noStoreHint:
    "Build a weekly report: the engine creates the local store and the first snapshot.",
  errorTitle: "Could not compare the stored snapshots.",
  previous: "Previous",
  current: "Current",
  property: "Property",
  comparable: "Comparable",
  notComparable: "Not comparable",
  noChanges: "No material changes between the two snapshots.",
  headline: "Headline metrics",
  headlineEmpty: "No headline metric is present in both snapshots.",
  unknownMetrics: "Unknown in one snapshot: {metrics}",
  issues: "Issues by severity",
  issuesEmpty: "Issue counts did not change.",
  opportunities: "Opportunities",
  added: "New",
  resolved: "Resolved",
  unchanged: "Unchanged: {count}",
  opportunitiesEmpty: "No opportunities appeared or were resolved.",
  limitations: "Limitations",
  limitationsAdded: "Added limitations",
  limitationsLifted: "Lifted limitations",
  limitationsEmpty: "The limitation list did not change.",
  caveats: "Caveats",
  metric: "Metric",
  delta: "Δ",
  deltaPct: "Δ%",
  more: "+{count} more",
};

const ru: ReportDiffCopy = {
  title: "Сравнение с предыдущим",
  hint: "Сравнивает два последних сохранённых недельных снапшота. Провайдеры не вызываются.",
  compare: "Сравнить с предыдущим",
  comparing: "Сравнение…",
  idleTitle: "Сравнение не загружено",
  idleHint: "Загрузите сравнение, чтобы увидеть изменения с предыдущего снапшота.",
  emptyTitle: "Предыдущего снапшота ещё нет",
  emptyHint:
    "Постройте недельный отчёт за другой период: сравнение появится, когда будет сохранено два снапшота.",
  noStoreTitle: "Нет локального хранилища снапшотов",
  noStoreHint:
    "Постройте недельный отчёт: движок создаст локальное хранилище и первый снапшот.",
  errorTitle: "Не удалось сравнить сохранённые снапшоты.",
  previous: "Предыдущий",
  current: "Текущий",
  property: "Ресурс",
  comparable: "Сопоставимо",
  notComparable: "Не сопоставимо",
  noChanges: "Существенных изменений между снапшотами нет.",
  headline: "Ключевые метрики",
  headlineEmpty: "Ни одна ключевая метрика не присутствует в обоих снапшотах.",
  unknownMetrics: "Неизвестно в одном из снапшотов: {metrics}",
  issues: "Проблемы по важности",
  issuesEmpty: "Количество проблем не изменилось.",
  opportunities: "Возможности",
  added: "Новые",
  resolved: "Закрытые",
  unchanged: "Без изменений: {count}",
  opportunitiesEmpty: "Новые возможности не появились и не закрылись.",
  limitations: "Ограничения",
  limitationsAdded: "Добавлены ограничения",
  limitationsLifted: "Сняты ограничения",
  limitationsEmpty: "Список ограничений не изменился.",
  caveats: "Оговорки",
  metric: "Метрика",
  delta: "Δ",
  deltaPct: "Δ%",
  more: "ещё {count}",
};

const zh: ReportDiffCopy = {
  title: "与上一期对比",
  hint: "对比最近保存的两份每周快照，不会调用数据源。",
  compare: "与上一期对比",
  comparing: "正在对比…",
  idleTitle: "尚未加载对比",
  idleHint: "加载对比，查看与上一份快照相比的变化。",
  emptyTitle: "还没有上一期快照",
  emptyHint: "为另一个周期生成周报，保存两份快照后即可对比。",
  noStoreTitle: "没有本地快照存储",
  noStoreHint: "生成一份周报，引擎会创建本地存储和第一份快照。",
  errorTitle: "无法对比已保存的快照。",
  previous: "上一期",
  current: "当前",
  property: "资源",
  comparable: "可对比",
  notComparable: "不可对比",
  noChanges: "两份快照之间没有实质性变化。",
  headline: "核心指标",
  headlineEmpty: "两份快照中都没有可对比的核心指标。",
  unknownMetrics: "其中一份快照缺少：{metrics}",
  issues: "按严重程度统计的问题",
  issuesEmpty: "问题数量没有变化。",
  opportunities: "机会",
  added: "新增",
  resolved: "已解决",
  unchanged: "未变化：{count}",
  opportunitiesEmpty: "没有新增或已解决的机会。",
  limitations: "限制",
  limitationsAdded: "新增限制",
  limitationsLifted: "解除限制",
  limitationsEmpty: "限制列表没有变化。",
  caveats: "注意事项",
  metric: "指标",
  delta: "Δ",
  deltaPct: "Δ%",
  more: "还有 {count} 条",
};

const dictionaries: Record<Locale, ReportDiffCopy> = { en, ru, zh };

export function reportDiffCopy(locale: Locale): ReportDiffCopy {
  return dictionaries[locale] ?? en;
}

/** Fill `{name}` placeholders in local copy (the shared `t` only takes keys). */
export function fillCopy(
  template: string,
  params: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
