import { defineConfig } from "vite"
// PROFILE=1 builds unminified with source maps so CPU profiles show SuperDoc's
// own function names. The default build is minified, like a production app.
const profile = process.env.PROFILE === "1"
export default defineConfig({ build: { target: "es2022", minify: !profile, sourcemap: profile } })
