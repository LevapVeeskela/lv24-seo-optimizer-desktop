export interface SkipLinkEvent {
  preventDefault(): void;
}

export interface SkipLinkTarget {
  focus(): void;
}

/**
 * Skip link handler for a hash router. A bare `href="#main-content"` makes the
 * router treat the hash as a route and render NotFound; preventing the default
 * keeps the URL intact while moving keyboard focus to the main region.
 */
export function activateSkipLink(
  event: SkipLinkEvent,
  target: SkipLinkTarget | null,
): void {
  event.preventDefault();
  target?.focus();
}
