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
        rewrite: (path) => path.replace(/^\/api\/dashscope-workspace/, ''),
      },
      // 阿里云百炼 - 通用域名（开发环境解决CORS）
      // 使用方法：将 API Base URL 改为 /api/dashscope/api/v1
      '/api/dashscope': {
        target: 'https://dashscope.aliyuncs.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/dashscope/, ''),
      },
      '/api/volcengine': {
        target: 'https://ark.cn-beijing.volces.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/volcengine/, ''),
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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
