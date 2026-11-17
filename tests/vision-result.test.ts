import { describe, expect, it } from 'vitest';
import { dedupeVisionItems, normalizeVisionConfidence } from '@/lib/vision-result';

describe('vision result normalization', () => {
  it('clamps model confidence and rejects non-numeric values', () => {
    expect(normalizeVisionConfidence(1.4)).toBe(1);
    expect(normalizeVisionConfidence(-0.2)).toBe(0);
    expect(normalizeVisionConfidence(Number.NaN)).toBe(0.6);
    expect(normalizeVisionConfidence('0.9')).toBe(0.6);
  });

  it('keeps the highest-confidence result for each matched drug', () => {
    const result = dedupeVisionItems([
      { name: '芬必得', matchedDrugId: 'ibuprofen', confidence: 0.72 },
      { name: '布洛芬缓释胶囊', matchedDrugId: 'ibuprofen', confidence: 0.91 },
      { name: '未知药盒', matchedDrugId: null, confidence: 0.4 },
      { name: '未知药盒', matchedDrugId: null, confidence: 0.6 },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ name: '布洛芬缓释胶囊', confidence: 0.91 });
    expect(result[1]).toMatchObject({ name: '未知药盒', confidence: 0.6 });
  });
});
