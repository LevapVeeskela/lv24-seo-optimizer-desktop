import type { CrawlCopy } from "../model/copy";
import { Button } from "@/shared/ui/Button";
import { Field } from "@/shared/ui/Field";
import { Input } from "@/shared/ui/Input";

export interface CrawlRunFormProps {
  copy: CrawlCopy;
  start: string;
  maxUrls: string;
  startInvalid: boolean;
  maxUrlsInvalid: boolean;
  loading: boolean;
  disabled: boolean;
  onStartChange: (value: string) => void;
  onMaxUrlsChange: (value: string) => void;
  onSubmit: () => void;
}

export function CrawlRunForm({
  copy,
  start,
  maxUrls,
  startInvalid,
  maxUrlsInvalid,
  loading,
  disabled,
  onStartChange,
  onMaxUrlsChange,
  onSubmit,
}: CrawlRunFormProps) {
  return (
    <form
      className="crawl-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="form-grid">
        <Field
          id="crawl-start"
          label={copy.startLabel}
          hint={copy.startHint}
          error={startInvalid ? copy.startInvalid : undefined}
        >
          <Input
            id="crawl-start"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder={copy.startPlaceholder}
            value={start}
            aria-invalid={startInvalid || undefined}
            aria-describedby={
              startInvalid
                ? "crawl-start-hint crawl-start-error"
                : "crawl-start-hint"
            }
            disabled={disabled || loading}
            onChange={(event) => onStartChange(event.target.value)}
          />
        </Field>
        <Field
          id="crawl-max-urls"
          label={copy.maxUrlsLabel}
          hint={copy.maxUrlsHint}
          error={maxUrlsInvalid ? copy.maxUrlsInvalid : undefined}
        >
          <Input
            id="crawl-max-urls"
            type="number"
            min={1}
            max={10_000}
            step={1}
            inputMode="numeric"
            value={maxUrls}
            aria-invalid={maxUrlsInvalid || undefined}
            aria-describedby={
              maxUrlsInvalid
                ? "crawl-max-urls-hint crawl-max-urls-error"
                : "crawl-max-urls-hint"
            }
            disabled={disabled || loading}
            onChange={(event) => onMaxUrlsChange(event.target.value)}
          />
        </Field>
      </div>
      <div className="crawl-form-actions">
        <Button
          type="submit"
          variant="primary"
          loading={loading}
          disabled={disabled}
        >
          {loading ? copy.running : copy.run}
        </Button>
        <p className="muted small crawl-form-hint">{copy.runHint}</p>
      </div>
    </form>
  );
}
