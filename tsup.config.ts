import { defineConfig } from 'tsup';

export default defineConfig({
  entryPoints: ['src/index.ts'],
  format: ['cjs', 'esm', 'iife'],
  dts: true,
  outDir: 'dist',
  clean: true,
  globalName: 'ag2client',
});
