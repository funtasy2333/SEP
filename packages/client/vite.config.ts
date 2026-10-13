import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        configure(proxy) {
          // 变更推送（SSE，/api/documents/:id/events）是长连接。后端重启或崩溃时上游连接被异常切断，
          // 代理不会结束已经发给浏览器的响应：EventSource 既收不到数据，也不会触发 error 和重连，
          // 编辑器就此悄悄失去推送。上游响应在没有完成时就关闭，则同步断开浏览器一侧，让 EventSource 重连。
          proxy.on('proxyRes', (proxyRes, _req, res) => {
            proxyRes.on('close', () => {
              if (!proxyRes.complete && !res.destroyed) res.destroy()
            })
          })
        },
      },
    },
  },
})
