import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  server: {
    allowedHosts: ['.vercel.run']
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'CafeOS',
        short_name: 'CafeOS',
        start_url: '/login',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#1a1a1a'
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.href.startsWith(process.env.VITE_API_BASE_URL || 'http://localhost:3000'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'cafeos-api-cache',
              networkTimeoutSeconds: 10
            }
          }
        ]
      }
    })
  ]
})
