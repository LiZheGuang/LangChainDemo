import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const AGENT_SERVER_URL = process.env.AGENT_SERVER_URL ?? "http://localhost:2024";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: AGENT_SERVER_URL,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
