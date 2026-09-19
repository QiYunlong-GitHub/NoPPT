import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// 大演示（10+ 页，每页大量 HTML/base64 图片）的 PUT 请求体较大，
// 为每个后端代理路径统一加上代理超时和错误日志，避免 Vite 转发时 EPIPE/EACCES
const backendProxyOpts = {
  target: 'http://localhost:3001',
  changeOrigin: true,
  proxyTimeout: 5 * 60 * 1000,
  timeout: 5 * 60 * 1000,
  configure: (proxy: any) => {
    proxy.on('error', (err: any, _req: any, _res: any) => {
      console.error(
        '[vite proxy error] code=%s message=%s',
        err.code || '',
        err.message || '',
      );
    });
  },
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    // pnpm 下 react / react-dom 可能解析到多份副本：
    // react-dom 把 hooks dispatcher 挂在「它那份」react 的共享对象上，
    // 组件若从另一份 react 取 hooks 就会读到 null（Cannot read properties of null (reading 'useReducer')）。
    // 强制去重，保证全局只有一份 react / react-dom。
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@noppt/core': path.resolve(__dirname, '../core/src'),
      '@noppt/ai': path.resolve(__dirname, '../ai/src'),
      // jsdom 是 Node 专用库，仅服务端/测试使用；浏览器从不调用，别名到 stub 防止其进入浏览器包
      jsdom: path.resolve(__dirname, 'jsdom-browser-stub.mjs'),
    },
  },
  server: {
    port: 5173,
    open: true,
    proxy: {
      // 阿里云百炼 - 业务空间专属域名（请替换为你自己的 WorkspaceId 和地域）
      // 使用方法：将 API Base URL 改为 /api/dashscope-workspace/api/v1
      '/api/dashscope-workspace': {
        target: 'https://ws-xzi09jpca0g4mk9v.cn-beijing.maas.aliyuncs.com',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/api\/dashscope-workspace/, ''),
      },
      // 阿里云百炼 - 通用域名（开发环境解决CORS）
      // 使用方法：将 API Base URL 改为 /api/dashscope/api/v1
      '/api/dashscope': {
        target: 'https://dashscope.aliyuncs.com',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/api\/dashscope/, ''),
      },
      '/api/volcengine': {
        target: 'https://ark.cn-beijing.volces.com',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/api\/volcengine/, ''),
      },
      '/api/presentations': backendProxyOpts,
      '/api/workspace': backendProxyOpts,
      '/api/ai': backendProxyOpts,
      '/api/assets': backendProxyOpts,
      '/data': backendProxyOpts,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // 注：vitest 1.6.1 中 test.deps.inline 已废弃，改用 test.server.deps.inline 才生效。
    // 关键：正则必须 /^react($|\/)/ —— 只内联 react / react-dom / react-dom/client，
    // 不能写成 /react/（会过度匹配 @testing-library/react，使其被内联进 Vite 图，
    // 触发 "reading 'test'/'on'" 的 TDZ，导致所有组件测试 collect 阶段直接失败）。
    // 让 @testing-library/* 走 node require（与 vite-node 行为一致）即可正常加载。
    server: {
      deps: {
        inline: [/^react($|\/)/],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
