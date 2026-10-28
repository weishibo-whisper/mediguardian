import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // 明确工作区根目录，避免上层目录存在其它 lockfile 时 Next 推断错误
  outputFileTracingRoot: projectRoot,
  // 构建体积与首屏：按需裁剪大型图标库的 tree-shaking 提示
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  eslint: {
    // 构建流水线不因 lint 阻断（CI 中单独执行 npm run lint）
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [
      {
        // SSE 流式接口禁止中间层缓存
        source: '/api/chat',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-transform' },
          { key: 'X-Accel-Buffering', value: 'no' },
        ],
      },
    ];
  },
};

export default nextConfig;
