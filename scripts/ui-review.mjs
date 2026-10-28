#!/usr/bin/env node
/**
 * 界面评审取证脚本（对比度 / 焦点 / 点击区 / 重排）
 * ==================================================================
 * 用法：先启动服务，再执行 `node scripts/ui-review.mjs`
 *
 * 这个脚本的存在理由：界面问题里最容易被"我觉得还行"糊过去的三类，
 * 恰好都能被精确测量——
 *   ① 文字对比度：拿到渲染后的前景色与真实背景色，算 WCAG 比值；
 *   ② 焦点可见性：键盘 Tab 走一遍，读 outline / box-shadow 是否有可见指示；
 *   ③ 点击区尺寸：WCAG 2.5.8 要求 24×24 CSS px；
 *   ④ 320px 重排与 200% 缩放：横向滚动条是否出现。
 *
 * 注意：对比度必须量"真实渲染背景"（穿透到第一个不透明祖先），
 * 直接拿页面底色算会把卡片里的浅色文字全部判成合格。
 */

import { chromium } from 'playwright';

const BASE = (process.env.REVIEW_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
const ROUTES = ['/', '/console', '/arch', '/safety'];

const results = { contrast: [], focus: [], hitArea: [], reflow: [] };

const CONTRAST_SCRIPT = () => {
  const parse = (str) => {
    const m = str.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    // 同时支持 rgb(1, 2, 3) 与 Tailwind 的 rgb(1 2 3 / 0.1) 两种语法。
    // 只认逗号会让 bg-warn/10 这类半透明底解析成 NaN，进而算出"前景=背景"的假结论。
    const parts = m[1]
      .replace(/[/,]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number);
    if (parts.some((v) => Number.isNaN(v))) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  // 正确的 alpha 合成：out = fg over bg。
  // 早前版本把结果 alpha 直接写成 1，导致「半透明底叠半透明底」在第一步就被当成
  // 不透明、提前返回，算出的背景色等于前景色（假报 1:1）。
  const over = (fg, bg) => {
    const a = fg.a + bg.a * (1 - fg.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
      g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
      b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
      a,
    };
  };
  const ratio = (a, b) => {
    const l1 = lum(a);
    const l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };

  const effectiveBg = (el) => {
    let node = el;
    let acc = null;
    while (node && node !== document.documentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0) {
        acc = acc ? over(acc, bg) : bg;
        if (acc.a >= 0.999) return acc;
      }
      node = node.parentElement;
    }
    const root = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    return acc ? over(acc, root) : root;
  };

  const out = [];
  const seen = new Set();
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    const text = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join('')
      .trim();
    if (!text) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;

    const fgRaw = parse(style.color);
    if (!fgRaw) continue;
    const bg = effectiveBg(el);
    const fg = fgRaw.a < 1 ? over(fgRaw, bg) : fgRaw;

    const size = parseFloat(style.fontSize);
    const weight = Number(style.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const r = ratio(fg, bg);

    const key = `${style.color}|${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}|${size}|${weight}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      text: text.slice(0, 22),
      tag: el.tagName.toLowerCase(),
      cls: typeof el.className === 'string' ? el.className.slice(0, 46) : '',
      size: Math.round(size * 10) / 10,
      weight,
      fg: style.color,
      bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
      ratio: Math.round(r * 100) / 100,
      need,
      pass: r >= need,
    });
  }
  return out;
};

async function run() {
  const browser = await chromium.launch();
  console.log(`\n界面评审取证 · ${BASE}\n`);

  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
    const page = await ctx.newPage();

    for (const route of ROUTES) {
      await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
      if (theme === 'dark') {
        const toggle = page.getByRole('button', { name: /主题|深色|浅色/ }).first();
        if (await toggle.count()) await toggle.click();
        await page.waitForTimeout(350);
      }
      const applied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));

      // ① 对比度
      const contrast = await page.evaluate(CONTRAST_SCRIPT);
      const fails = contrast.filter((c) => !c.pass);
      for (const f of fails) results.contrast.push({ theme: applied ?? theme, route, ...f });

      // ② 焦点可见性：用真实 Tab 键走一遍。
      // 不能用 el.focus()——程序化聚焦不建立键盘模态，:focus-visible 不匹配，
      // 会把全部元素误判成"没有焦点环"（实测会假报 89 处）。
      const focus = [];
      const seenFocus = new Set();
      for (let i = 0; i < 30; i += 1) {
        await page.keyboard.press('Tab');
        const info = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const s = getComputedStyle(el);
          return {
            tag: el.tagName.toLowerCase(),
            label: (el.getAttribute('aria-label') || el.innerText || el.value || '').trim().slice(0, 24),
            hasRing: (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 1) || (s.boxShadow && s.boxShadow !== 'none'),
            outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`,
          };
        });
        if (!info) continue;
        const key = `${info.tag}|${info.label}`;
        if (seenFocus.has(key)) continue;
        seenFocus.add(key);
        focus.push(info);
      }
      for (const f of focus.filter((x) => !x.hasRing)) {
        // nextjs-portal 是 Next.js 开发工具的影子节点，不属于产品界面
        if (f.tag === 'nextjs-portal') continue;
        results.focus.push({ theme: applied ?? theme, route, ...f });
      }

      // ③ 点击区
      const hit = await page.evaluate(() => {
        const out = [];
        for (const el of Array.from(document.querySelectorAll('a[href], button, [role="button"], input, select'))) {
          if (el.offsetParent === null) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.width < 24 || r.height < 24) {
            out.push({
              tag: el.tagName.toLowerCase(),
              label: (el.getAttribute('aria-label') || el.innerText || '').trim().slice(0, 24),
              w: Math.round(r.width),
              h: Math.round(r.height),
            });
          }
        }
        return out;
      });
      results.hitArea.push(...hit.map((h) => ({ theme: applied ?? theme, route, ...h })));

      console.log(
        `  ${theme.padEnd(5)} ${route.padEnd(9)} 文字样式 ${String(contrast.length).padStart(3)} 种 · 对比度不合格 ${fails.length} · 无焦点环 ${focus.filter((x) => !x.hasRing).length} · 点击区<24px ${hit.length}`,
      );
    }

    // ④ 320px 重排 + 200% 缩放
    for (const route of ROUTES) {
      await page.setViewportSize({ width: 320, height: 720 });
      await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
      const narrow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        overflowing: Array.from(document.querySelectorAll('body *'))
          .filter((el) => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.right <= window.innerWidth + 2) return false;
            // 位于横向滚动容器内部的元素不算溢出：那是设计好的局部滚动。
            let p = el.parentElement;
            while (p && p !== document.body) {
              const ox = getComputedStyle(p).overflowX;
              if (ox === 'auto' || ox === 'scroll') return false;
              p = p.parentElement;
            }
            return true;
          })
          .slice(0, 4)
          .map((el) => `${el.tagName.toLowerCase()}.${(typeof el.className === 'string' ? el.className : '').slice(0, 30)}`),
      }));
      if (narrow.scrollWidth > narrow.viewport + 2) {
        results.reflow.push({ theme: applied(theme), route, width: 320, ...narrow });
      }
      console.log(`  320px  ${route.padEnd(9)} scrollWidth ${narrow.scrollWidth} / ${narrow.viewport}`);
    }

    await ctx.close();
  }

  await browser.close();

  const report = (title, rows, cols) => {
    console.log(`\n── ${title}（${rows.length}）`);
    if (rows.length === 0) {
      console.log('   无');
      return;
    }
    console.table(rows.slice(0, 12), cols);
  };

  report('对比度不合格', results.contrast, ['theme', 'route', 'text', 'size', 'weight', 'fg', 'bg', 'ratio', 'need']);
  report('缺少可见焦点环', results.focus, ['theme', 'route', 'tag', 'label', 'outline']);
  report('点击区小于 24px', results.hitArea, ['theme', 'route', 'tag', 'label', 'w', 'h']);
  report('320px 横向溢出', results.reflow, ['theme', 'route', 'scrollWidth', 'viewport', 'overflowing']);
  console.log('');
}

const applied = (t) => t;

run().catch((error) => {
  console.error('取证失败：', error?.message ?? error);
  process.exit(1);
});
