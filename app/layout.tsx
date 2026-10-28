import type { Metadata, Viewport } from 'next';
import './globals.css';
import { TopNav } from '@/components/TopNav';

export const metadata: Metadata = {
  title: '守药人 MediGuardian · 面向基层的多模态用药安全 Agent',
  description:
    '守药人是一个面向基层医疗的 AI Native 用药安全 Agent：多模态采集、混合检索循证、8 个工具编排、全链路可追溯与安全守门，让每一位老人都能用对药。',
  keywords: ['AI Agent', '用药安全', 'RAG', 'MCP', '多模态', '基层医疗'],
  authors: [{ name: '守药人团队' }],
  openGraph: {
    title: '守药人 MediGuardian',
    description: '让每一位老人都能用对药 — AI Native 用药安全 Agent',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#0d9488',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-screen bg-surface antialiased">
        <TopNav />
        <main className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-6 md:px-6">{children}</main>
        <footer className="border-t border-line/70 py-6 text-center text-xs leading-relaxed text-ink-mute">
          <p>守药人 MediGuardian · AI Agent 用药安全辅助系统 · 参赛作品（演示数据，非临床依据）</p>
          <p className="mt-1">
            本系统输出仅供基层医护与家属参考，不构成诊断或处方，任何用药调整须经执业医师确认
          </p>
        </footer>
      </body>
    </html>
  );
}
