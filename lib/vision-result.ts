/** 把视觉模型返回的任意置信度收敛到 UI 可安全展示的 0~1。 */
export function normalizeVisionConfidence(value: unknown, fallback = 0.6): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

/** 同一药品只保留最高置信度结果，避免重复识别被用户误当成多种药。 */
export function dedupeVisionItems<T extends { matchedDrugId: string | null; name: string; confidence: number }>(items: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    const key = item.matchedDrugId ? `drug:${item.matchedDrugId}` : `raw:${item.name.trim().toLowerCase()}`;
    const previous = byKey.get(key);
    if (!previous || item.confidence > previous.confidence) byKey.set(key, item);
  }
  return Array.from(byKey.values());
}
