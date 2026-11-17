#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = (process.env.VISION_EVAL_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
const manifestPath = path.resolve(process.env.VISION_MANIFEST || 'data/eval/vision-manifest.json');
const outPath = path.resolve('data/eval/vision-results.json');
const sampleLimit = Number(process.env.VISION_EVAL_LIMIT || 0);

const mimeByExt = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
let manifest;
try {
  manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
} catch {
  console.log(`未找到真实图片清单：${path.relative(process.cwd(), manifestPath)}`);
  console.log('复制 data/eval/vision-manifest.example.json 为 vision-manifest.json，放入已获得授权的脱敏图片后再运行。');
  process.exit(0);
}

const samples = sampleLimit > 0 ? (manifest.samples ?? []).slice(0, sampleLimit) : (manifest.samples ?? []);
const results = [];
for (const sample of samples) {
  try {
    const imagePath = path.resolve(path.dirname(manifestPath), sample.file);
    const mime = mimeByExt[path.extname(imagePath).toLowerCase()];
    if (!mime) throw new Error('UNSUPPORTED_IMAGE_EXTENSION');
    const data = (await fs.readFile(imagePath)).toString('base64');
    const response = await fetch(`${BASE}/api/vision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: `data:${mime};base64,${data}` }),
      signal: AbortSignal.timeout(90_000),
    });
    const body = await response.json();
    if (!response.ok) {
      results.push({
        id: sample.id,
        pass: false,
        errorCode: body.code || `HTTP_${response.status}`,
        error: body.error || `HTTP_${response.status}`,
      });
      continue;
    }
    const expected = new Set(sample.expectedDrugIds ?? []);
    const found = new Set((body.items ?? []).map((item) => item.matchedDrugId).filter(Boolean));
    const matched = [...expected].filter((id) => found.has(id));
    results.push({
      id: sample.id,
      provider: body.provider,
      expected: [...expected],
      found: [...found],
      recall: expected.size ? Number((matched.length / expected.size).toFixed(3)) : 0,
      exact: expected.size === found.size && matched.length === expected.size,
      pass: body.provider !== 'mock' && matched.length === expected.size,
    });
  } catch (error) {
    results.push({ id: sample.id, pass: false, error: error instanceof Error ? error.message : String(error) });
  }
}

const real = results.filter((item) => item.provider && item.provider !== 'mock');
const unavailable = results.length > 0 && results.every((item) => item.errorCode === 'VISION_MODEL_NOT_CONFIGURED');
const report = {
  generatedAt: new Date().toISOString(),
  dataset: {
    name: manifest.datasetName,
    independentOriginals: manifest.independentOriginals,
    augmentedSamples: manifest.augmentedSamples,
    licenseVerified: manifest.licenseVerified,
  },
  status: unavailable ? 'vision_model_not_configured' : real.length === 0 ? 'not_evaluated' : 'completed',
  disclaimer: manifest.disclaimer || '仅使用已授权、已脱敏的药盒或处方图片；mock 结果不计入准确率。',
  summary: {
    samples: results.length,
    realSamples: real.length,
    exactAccuracy: real.length ? Number((real.filter((item) => item.exact).length / real.length).toFixed(3)) : 0,
    meanRecall: real.length ? Number((real.reduce((sum, item) => sum + item.recall, 0) / real.length).toFixed(3)) : 0,
  },
  results,
};
await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`视觉评测：${report.status} · 真实样本 ${report.summary.realSamples}/${report.summary.samples}`);
if (unavailable) console.log('当前文本模型没有配置视觉能力；数据集已就绪，未发起批量视觉调用。');
console.log(`结果：${path.relative(process.cwd(), outPath)}`);

