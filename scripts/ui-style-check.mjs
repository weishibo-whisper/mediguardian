#!/usr/bin/env node
/**
 * 视觉语言体检：把「AI 味」这类主观判断变成可枚举的规则
 * ================================================================
 * 用法：先启动服务，再执行 `node scripts/ui-style-check.mjs`
 *
 * 规则来自本项目的设计约定（见 app/globals.css 顶部注释）：
 *   ① 不用毛玻璃：出现 backdrop-filter 即违规
 *   ② 不用辉光/模糊装饰：出现 filter: blur(...) 即违规（>0px）
 *   ③ 不用大圆角：border-radius > 14px 即违规
 *   ④ 不用浮起投影：box-shadow 出现 >2px 的 blur 即违规
 *   ⑤ 一个颜色一个含义：填充式品牌色块只允许出现在主操作/当前项
 * 这些规则机器能判，所以不需要"凭感觉争论好不好看"。
 */

import { chromium } from 'playwright';

const BASE = (process.env.CHECK_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
const ROUTES = ['/', '/console', '/evidence', '/safety'];
const RADIUS_LIMIT = 14;

const findings = [];

const scan = (limit) => {
  const RADIUS_LIMIT = limit;
  const out = { blur: [], backdrop: [], bigRadius: [], softShadow: [] };
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    const s = getComputedStyle(el);
    const cls = typeof el.className === 'string' ? el.className.slice(0, 60) : '';
    const label = `${el.tagName.toLowerCase()}${cls ? '.' + cls.trim().split(/\s+/).join('.') : ''}`;

    if (s.backdropFilter && s.backdropFilter !== 'none') out.backdrop.push({ label, value: s.backdropFilter });
    const f = s.filter || '';
    const blur = f.match(/blur\((\d+(?:\.\d+)?)px\)/);
    if (blur && Number(blur[1]) > 0) out.blur.push({ label, value: f.slice(0, 40) });

    const radii = [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomLeftRadius, s.borderBottomRightRadius]
      .map((v) => parseFloat(v) || 0);
    const maxR = Math.max(...radii);
    if (maxR > RADIUS_LIMIT) out.bigRadius.push({ label, value: maxR });

    const sh = s.boxShadow;
    if (sh && sh !== 'none') {
      const parts = sh.match(/-?\d+(?:\.\d+)?px/g) || [];
      // 影子表达式结构：offsetX offsetY blur [spread] color → blur 是第三个数
      const blurPx = parts.length >= 3 ? Math.abs(parseFloat(parts[2])) : 0;
      if (blurPx > 2) out.softShadow.push({ label, value: sh.slice(0, 46) });
    }
  }
  return out;
};

const main = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();

  for (const theme of ['light', 'dark']) {
    for (const route of ROUTES) {
      await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
      if (theme === 'dark') {
        const t = page.getByRole('button', { name: /主题|深色|浅色/ }).first();
        if (await t.count()) await t.click();
        await page.waitForTimeout(250);
      }
      const r = await page.evaluate(scan, RADIUS_LIMIT);
      const total = r.blur.length + r.backdrop.length + r.bigRadius.length + r.softShadow.length;
      for (const kind of Object.keys(r)) {
        for (const item of r[kind].slice(0, 3)) findings.push({ theme, route, 规则: kind, 元素: item.label, 实测: item.value });
      }
      console.log(`  ${theme.padEnd(5)} ${route.padEnd(9)} 违规 ${total}`);
    }
  }
  await browser.close();

  if (findings.length === 0) {
    console.log('\n✓ 四条视觉规则全部通过：无毛玻璃、无模糊装饰、无大圆角、无浮起投影\n');
    return;
  }
  console.log('');
  console.table(findings.slice(0, 15));
  console.log(`\n共 ${findings.length} 处违规\n`);
  process.exit(1);
};

main().catch((e) => {
  console.error('体检失败：', e?.message ?? e);
  process.exit(1);
});
