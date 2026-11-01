/** Shared limits for the customer stop search and its API endpoint. */
export const MIN_STAGE_SEARCH_LENGTH = 2;
export const MAX_STAGE_SEARCH_LENGTH = 80;

export function isStageSearchReady(query: string): boolean {
  const normalized = query.trim();
  return normalized.length >= MIN_STAGE_SEARCH_LENGTH && normalized.length <= MAX_STAGE_SEARCH_LENGTH;
}

export function shouldSearchStagePoints(query: string, pickerOpen: boolean): boolean {
  return pickerOpen && isStageSearchReady(query);
}
