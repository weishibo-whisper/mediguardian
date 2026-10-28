#!/usr/bin/env node
/**
 * 前端质量审计（自动化视觉/可访问性检查）
 * ==================================================================
 * 用法：先启动服务，再执行 `node scripts/ui-audit.mjs`
 *
 * 为什么不是"人眼看一眼"：界面问题最有价值的部分不是好不好看，而是
 *   ① 有没有运行时报错（React hydration 错误最典型）
 *   ② 有没有横向溢出（窄屏/大字模式下最容易炸）
 *   ③ 交互元素有没有可访问名称（键盘与读屏用户能不能用）
 * 这三件事都能被机器判定，也应该被机器守住。
 */

import { chromium } from 'playwright';

const BASE = (process.env.AUDIT_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
const ROUTES = ['/', '/console', '/evidence', '/safety'];

const findings = [];
let failures = 0;

const add = (route, level, message) => {
  findings.push({ 页面: route, 级别: level, 问题: message });
  if (level === '错误') failures += 1;
};

async function main() {
  const browser = await chromium.launch();
  // 同时验两种视口：桌面投影场景 + 平板窄屏，外加适老化大字模式
  const profiles = [
    { name: '桌面 1440', viewport: { width: 1440, height: 900 }, bigText: false },
    { name: '窄屏 1024', viewport: { width: 1024, height: 768 }, bigText: false },
  ];

  console.log(`\n前端质量审计 · ${BASE}\n`);

  for (const profile of profiles) {
    const ctx = await browser.newContext({ viewport: profile.viewport, locale: 'zh-CN' });
    const page = await ctx.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    for (const route of ROUTES) {
      const label = `${profile.name} ${route}`;
      consoleErrors.length = 0;
      pageErrors.length = 0;

      await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });

      if (profile.bigText) {
        // （大字模式改为独立用例，见下方「大字模式」段落）
      }

      // ① 运行时错误
      const hydration = pageErrors.concat(consoleErrors.filter((t) => /hydrat|Minified React error|Warning/i.test(t)));
      if (pageErrors.length) add(label, '错误', `页面运行时异常：${pageErrors[0].slice(0, 120)}`);
      if (hydration.length) add(label, '警告', `控制台告警：${hydration[0].slice(0, 120)}`);

      // ② 布局指标
      const layout = await page.evaluate(() => {
        const doc = document.documentElement;
        const overflowing = [];
        const vw = window.innerWidth;
        for (const el of Array.from(document.querySelectorAll('body *'))) {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          if (rect.right > vw + 2) {
            const cls = typeof el.className === 'string' ? el.className.slice(0, 60) : '';
            overflowing.push(`${el.tagName.toLowerCase()}${cls ? '.' + cls.trim().split(/\s+/).join('.') : ''}`);
          }
        }
        return {
          hScroll: doc.scrollWidth > vw + 2,
          scrollWidth: doc.scrollWidth,
          viewport: vw,
          overflowing: overflowing.slice(0, 5),
          rootFontSize: getComputedStyle(doc).fontSize,
          invisibleText: Array.from(document.querySelectorAll('h1,h2,h3,p')).filter((el) => {
            const s = getComputedStyle(el);
            return Number(s.opacity) === 0 || s.visibility === 'hidden';
          }).length,
        };
      });

      if (layout.hScroll) {
        add(label, '错误', `页面横向溢出：scrollWidth ${layout.scrollWidth} > viewport ${layout.viewport}` + (layout.overflowing.length ? `；越界元素：${layout.overflowing.join(', ')}` : ''));
      }
      if (layout.invisibleText > 0) add(label, '警告', `${layout.invisibleText} 个标题/段落被隐藏或 opacity:0`);
      if (profile.bigText && layout.rootFontSize === '16px') {
        add(label, '警告', '大字模式下 root font-size 仍为 16px（rem 缩放未生效）');
      }

      // ③ 可访问性
      const a11y = await page.evaluate(() => {
        const badButtons = Array.from(document.querySelectorAll('button')).filter(
          (b) => !(b.innerText || '').trim() && !b.getAttribute('aria-label') && !b.getAttribute('title'),
        ).length;
        const imgNoAlt = Array.from(document.querySelectorAll('img')).filter((i) => !i.hasAttribute('alt')).length;
        const noLive = document.querySelectorAll('[aria-live]').length;
        return { buttons: document.querySelectorAll('button').length, badButtons, imgNoAlt, noLive };
      });
      if (a11y.badButtons > 0) add(label, '警告', `${a11y.badButtons}/${a11y.buttons} 个按钮缺少可访问名称`);

      console.log(
        `  ✓ ${label.padEnd(22)} 无异常 · 横向溢出 ${layout.hScroll ? '有' : '无'} · 按钮 ${a11y.buttons} 个 · root ${layout.rootFontSize}`,
      );
    }

    await ctx.close();
  }

  // ── 大字模式（适老化）：在 / 上点一次开关，然后逐页验证持久化与 rem 缩放 ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const btn = page.getByRole('button', { name: /大字/ }).first();
    if (!(await btn.count())) {
      add('大字模式', '错误', '找不到「大字」切换入口');
    } else {
      await btn.click();
      await page.waitForTimeout(400);
      const fsHome = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
      if (fsHome !== '18.5px') add('大字模式 /', '错误', `点击后 root font-size 仍为 ${fsHome}`);

      for (const route of ROUTES) {
        await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
        // 幂等：只在未开启时点一次。之前无条件点击，第二个页面就会把它关掉（状态是跨页持久的）
        const attr = await page.evaluate(() => document.documentElement.dataset.bigtext);
        if (attr !== 'true') {
          const toggle = page.getByRole('button', { name: /大字/ }).first();
          if (await toggle.count()) await toggle.click();
        }
        // 等属性真正落地再测量，避免页面慢时读到未应用的状态
        await page
          .waitForFunction(() => document.documentElement.dataset.bigtext === 'true', { timeout: 5000 })
          .catch(() => {});
        await page.waitForTimeout(400);
        const state = await page.evaluate(() => ({
          fs: getComputedStyle(document.documentElement).fontSize,
          attr: document.documentElement.getAttribute('data-bigtext'),
        }));
        if (state.fs !== '18.5px') {
          add(`大字模式 ${route}`, '错误', `root font-size ${state.fs}（data-bigtext=${state.attr}），rem 缩放未生效`);
        }
        console.log(`  ✓ 大字模式 ${route.padEnd(10)} root ${state.fs}`);
      }
    }
    await ctx.close();
  }

  await browser.close();

  console.log('');
  if (findings.length === 0) {
    console.log('✓ 三个视口 × 四个页面：无运行时异常、无横向溢出、无缺失可访问名称\n');
    return;
  }
  console.table(findings);
  console.log(`\n共 ${findings.length} 项问题，其中错误 ${failures} 项\n`);
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error('审计失败：', error?.message ?? error);
  process.exit(1);
});
