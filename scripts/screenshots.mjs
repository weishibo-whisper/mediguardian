#!/usr/bin/env node
/**
 * 页面截图（视觉验收 + 文档/PPT 素材）
 * ==================================================================
 * 用法：先启动服务（npm run dev 或 npm start），再执行
 *   node scripts/screenshots.mjs
 *
 * 产出：docs/screenshots/*.png（1440×900，2x 高清）
 * 目的：把「我觉得界面没问题」换成「我看过每个页面的每一个首屏」。
 */

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = (process.env.SHOT_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
const OUT = path.join(process.cwd(), 'docs', 'screenshots');

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const shots = [];

  const shot = async (name, opts = {}) => {
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file, ...opts });
    const { size } = await fs.stat(file);
    shots.push({ name, kb: Math.round(size / 1024) });
    console.log(`  ✓ ${name}.png (${Math.round(size / 1024)} KB)`);
  };

  console.log(`\n页面截图 · ${BASE}\n`);

  // 1. 落地页
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await shot('01-landing');

  // 2. 智能诊台首屏
  await page.goto(`${BASE}/console`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await shot('02-console');

  // 3. 提一个红旗问题，等回答流式结束
  const asked = await (async () => {
    const quick = page.getByRole('button', { name: /牙龈出血|大便发黑/ }).first();
    if (await quick.count()) {
      await quick.click();
    } else {
      const box = page.locator('textarea').first();
      await box.fill('最近牙龈出血、大便发黑，是不是止痛药引起的？');
      await box.press('Enter');
    }
    await page.waitForFunction(() => document.body.innerText.includes('一句话结论'), null, { timeout: 60000 });
    await page.waitForTimeout(2500);
    return true;
  })().catch((error) => {
    console.log(`  ! 提问交互失败（页面结构可能变化）：${error.message.slice(0, 80)}`);
    return false;
  });
  if (asked) await shot('03-answer-and-safety');

  // 4. 冲突图谱
  const graphTab = page.getByRole('tab', { name: /图谱|冲突/ }).first();
  const graphBtn = (await graphTab.count()) ? graphTab : page.getByRole('button', { name: /图谱|冲突/ }).first();
  if (await graphBtn.count()) {
    await graphBtn.click().catch(() => {});
    await page.waitForTimeout(900);
    await shot('04-conflict-graph');
  }

  // 5. 架构页 + 实时检索演示
  await page.goto(`${BASE}/arch`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await shot('05-arch');
  await shot('06-arch-full', { fullPage: true });

  // 6. 安全审计
  await page.goto(`${BASE}/safety`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await shot('07-safety-audit');

  // 7. 轨迹回放（点第一条「查看」）
  const traceLink = page.locator('a[href^="/trace/"]').first();
  if (await traceLink.count()) {
    await traceLink.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    await shot('08-trace-replay');
    await shot('09-trace-full', { fullPage: true });
  }

  // 8. 大字模式（适老化）
  await page.goto(`${BASE}/console`, { waitUntil: 'networkidle' });
  const bigBtn = page.getByRole('button', { name: /大字/ }).first();
  if (await bigBtn.count()) {
    await bigBtn.click().catch(() => {});
    await page.waitForTimeout(600);
    await shot('10-console-bigtext');
  }

  await browser.close();
  console.table(shots);
  console.log(`\n输出目录：${OUT}\n`);
}

main().catch((error) => {
  console.error('截图失败：', error?.message ?? error);
  process.exit(1);
});
