import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // `npm run dev` in server/ listens on 8080.
    proxy: { '/api': 'http://localhost:8080' },
  },
});
