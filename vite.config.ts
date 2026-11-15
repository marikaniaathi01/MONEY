import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

// base './' lets the built site work from any GitHub Pages address (https://USER.github.io/REPO/).
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
});
