/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["ui/src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": new URL("./ui/src", import.meta.url).pathname,
    },
  },
});
