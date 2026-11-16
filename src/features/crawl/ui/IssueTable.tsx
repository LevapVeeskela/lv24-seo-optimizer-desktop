import type { CrawlIssue } from "@/entities/crawl";
import { issueDetailText } from "@/entities/crawl";
import type { CrawlCopy } from "../model/copy";
import { Badge } from "@/shared/ui/Badge";
import { Table } from "@/shared/ui/Table";

function severityTone(
  severity: CrawlIssue["severity"],
): "danger" | "warning" | "info" | "neutral" {
  if (severity === "critical" || severity === "high") {
    return "danger";
  }
  if (severity === "medium") {
    return "warning";
  }
  if (severity === "low") {
    return "info";
  }
  return "neutral";
}

export function IssueTable({
  copy,
  issues,
}: {
  copy: CrawlCopy;
  issues: readonly CrawlIssue[];
}) {
  return (
    <Table caption={copy.issuesCaption} className="crawl-table">
      <colgroup>
        <col className="crawl-col-severity" />
        <col className="crawl-col-rule" />
        <col className="crawl-col-url" />
        <col />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">{copy.tableSeverity}</th>
          <th scope="col">{copy.tableRule}</th>
          <th scope="col">{copy.tableUrl}</th>
          <th scope="col">{copy.tableDetail}</th>
        </tr>
      </thead>
      <tbody>
        {issues.map((issue, index) => {
          const fullDetail = issueDetailText(issue.detail, 2000);
          return (
            <tr key={`${issue.rule_id}|${issue.url}|${index}`}>
              <td>
                <Badge tone={severityTone(issue.severity)}>
                  {copy.severityLabel[issue.severity]}
                </Badge>
              </td>
              <td>
                <code>{issue.rule_id}</code>
              </td>
              <td>
                <span className="crawl-url">{issue.url}</span>
              </td>
              <td>
                <span className="crawl-detail" title={fullDetail}>
                  {issueDetailText(issue.detail)}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
