export const reviewDays = { high: 30, medium: 90, low: 365, event: null } as const;
export function nextReview(verifiedAt: string, tier: keyof typeof reviewDays = 'medium') {
  const days = reviewDays[tier];
  return days === null ? null : new Date(Date.parse(verifiedAt) + days * 86400000).toISOString();
}
export function freshness(verifiedAt: string, due: string | null, now = Date.now()) {
  return { ageDays: Math.max(0, Math.floor((now - Date.parse(verifiedAt)) / 86400000)), daysUntilReview: due ? Math.ceil((Date.parse(due) - now) / 86400000) : null, overdue: !!due && Date.parse(due) <= now };
}
