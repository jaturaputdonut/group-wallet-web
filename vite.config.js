import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./", // ใช้ได้ทั้ง localhost และ GitHub Pages โดยไม่ต้องแก้ชื่อ repo
});
