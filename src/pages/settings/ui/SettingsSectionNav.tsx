import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";

export interface SettingsSectionNavItem {
  id: string;
  label: string;
  changedCount: number;
}

/**
 * Jump links for the long settings form. Native buttons (not anchors) because
 * the router owns the URL; the page scrolls and focuses the target section.
 */
export function SettingsSectionNav({
  label,
  items,
  jumpLabel,
  onJump,
}: {
  label: string;
  items: readonly SettingsSectionNavItem[];
  jumpLabel: (section: string) => string;
  onJump: (id: string) => void;
}) {
  return (
    <nav className="form-actions settings-nav" aria-label={label}>
      {items.map((item) => (
        <Button
          key={item.id}
          variant="link"
          aria-label={jumpLabel(item.label)}
          onClick={() => onJump(item.id)}
        >
          {item.label}
          {item.changedCount > 0 ? (
            <Badge tone="warning">{item.changedCount}</Badge>
          ) : null}
        </Button>
      ))}
    </nav>
  );
}
