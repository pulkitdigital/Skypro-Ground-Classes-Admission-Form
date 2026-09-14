import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  // VITE_ values are embedded at build time. Fail a production build instead of
  // shipping a form that posts to localhost or renders without reCAPTCHA.
  if (command === 'build' && mode === 'production') {
    const env = loadEnv(mode, '.', 'VITE_')
    const missing = ['VITE_API_URL', 'VITE_RECAPTCHA_SITE_KEY'].filter((key) => !env[key])
    if (missing.length) throw new Error(`Production build requires ${missing.join(' and ')}. See "Production deployment" in Readme.md.`)
    if (!/^https:\/\//i.test(env.VITE_API_URL)) throw new Error('VITE_API_URL must be an https:// backend origin for production builds.')
  }
  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
  }
})
