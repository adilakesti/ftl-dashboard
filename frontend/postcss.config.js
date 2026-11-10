import { fileURLToPath } from "node:url";

export default {
  plugins: {
    // Point at our config explicitly, so it's found whatever directory Vite starts in.
    tailwindcss: { config: fileURLToPath(new URL("./tailwind.config.js", import.meta.url)) },
    autoprefixer: {},
  },
};
