/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// The API only sends Access-Control-Allow-Origin for https://th-labs.uz and
// https://www.th-labs.uz, so the browser cannot call it directly from
// localhost. We proxy through the dev server instead: same-origin to the
// browser, server-to-server to the API, so CORS never enters the picture.
//
// cookieDomainRewrite is what makes auth work — the refresh token comes back
// as an httpOnly cookie scoped to th-labs.uz, which the browser would drop on
// localhost. Rewriting the domain to "" pins it to whatever host served it.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_API_ORIGIN || 'https://th-labs.uz'

  return {
    plugins: [react()],
    test: {
      environment: 'jsdom',
      globals: false,
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          secure: true,
          cookieDomainRewrite: '',
          rewrite: (path) => path.replace(/^\/api/, '/v1'),
        },
      },
    },
  }
})
