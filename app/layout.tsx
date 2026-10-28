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
      <head>
        {/*
          在 hydration 之前套用已保存的字号与主题。
          不加这段，大字模式会先按 16px 渲染、React 挂载后再跳成 18.5px（明显闪一下）；
          同时这也解释了另一个坑：字号属性依赖客户端 effect，页面慢一点时测量脚本会读到未应用的状态。
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var b=localStorage.getItem('mg.bigtext')==='1';var t=localStorage.getItem('mg.theme')==='dark';var d=document.documentElement;d.dataset.bigtext=String(b);d.dataset.theme=t?'dark':'light';}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen bg-surface antialiased">
        <TopNav />
        <main className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-6 md:px-6">{children}</main>
        <footer className="border-t border-line/70 py-6 text-center text-xs leading-relaxed text-ink-mute">
          <p>守药人 MediGuardian · AI Agent 用药安全辅助系统 · 演示数据，非临床依据</p>
          <p className="mt-1">
            本系统输出仅供基层医护与家属参考，不构成诊断或处方，任何用药调整须经执业医师确认
          </p>
        </footer>
      </body>
    </html>
  );
}
