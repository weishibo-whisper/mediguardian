'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Activity, BookOpen, Moon, ShieldCheck, Sun, Type, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 全局导航
 * 适老化与可访问性的关键落点：
 *  - 大字模式（html[data-bigtext]）：整站 rem 缩放，老人与投影演示都能看清；
 *  - 深/浅主题：基层诊室常背光，深色可减少眩光；
 *  - 全部设置持久化到 localStorage，刷新不丢失。
 */

const NAV = [
  { href: '/', label: '首页' },
  { href: '/console', label: '智能诊台' },
  { href: '/arch', label: '技术架构' },
  { href: '/safety', label: '安全审计' },
];

export function TopNav() {
  const pathname = usePathname();
  const [big, setBig] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const bigSaved = localStorage.getItem('mg.bigtext') === '1';
    const themeSaved = localStorage.getItem('mg.theme');
    setBig(bigSaved);
    setDark(themeSaved === 'dark');
    document.documentElement.dataset.bigtext = String(bigSaved);
    document.documentElement.dataset.theme = themeSaved === 'dark' ? 'dark' : 'light';
  }, []);

  const toggleBig = () => {
    const next = !big;
    setBig(next);
    localStorage.setItem('mg.bigtext', next ? '1' : '0');
    document.documentElement.dataset.bigtext = String(next);
  };

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    localStorage.setItem('mg.theme', next ? 'dark' : 'light');
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
  };

  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-surface/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-[1440px] items-center gap-3 px-4 md:px-6">
        <Link href="/" className="group flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-600 text-white shadow-soft transition group-hover:bg-brand-700">
            <ShieldCheck size={17} strokeWidth={2.2} />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-[0.95rem] font-semibold tracking-tight">守药人</span>
            <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-mute">
              MediGuardian
            </span>
          </span>
        </Link>

        <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="主导航">
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm transition',
                  active
                    ? 'bg-brand-50 font-medium text-brand-700'
                    : 'text-ink-soft hover:bg-surface-sunken hover:text-ink',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <span className="hidden items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-[11px] font-medium text-brand-700 sm:flex">
            <Sparkles size={12} />
            Agent 在线
          </span>
          <button
            type="button"
            onClick={toggleBig}
            aria-pressed={big}
            title="大字模式（适老化）"
            className={cn('btn-ghost !px-2.5', big && 'border-brand-200 text-brand-700')}
          >
            <Type size={16} />
            <span className="hidden text-xs sm:inline">大字</span>
          </button>
          <button
            type="button"
            onClick={toggleDark}
            aria-pressed={dark}
            title="切换深浅主题"
            className="btn-ghost !px-2.5"
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </div>

      {/* 移动端次级导航 */}
      <nav className="flex items-center gap-1 overflow-x-auto border-t border-line/70 px-3 py-1.5 md:hidden" aria-label="移动导航">
        {NAV.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'whitespace-nowrap rounded-lg px-2.5 py-1 text-xs transition',
                active ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-soft',
              )}
            >
              {item.label}
            </Link>
          );
        })}
        <span className="ml-auto flex items-center gap-1 pr-1 text-[10px] text-ink-mute">
          <BookOpen size={11} /> 演示数据
        </span>
      </nav>
    </header>
  );
}
