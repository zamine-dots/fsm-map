import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { localCampusEditor } from './scripts/local-campus-editor.ts';

export default defineConfig(({ command, isPreview }) => ({
  define: { __FSM_LOCAL_EDITOR__: command === 'serve' && !isPreview },
  plugins: [react(), tailwindcss(), localCampusEditor()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/three/') || id.includes('/three-stdlib/')) return 'three';
        },
      },
    },
  },
}));
