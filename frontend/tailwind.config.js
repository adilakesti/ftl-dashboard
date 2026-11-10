/** @type {import('tailwindcss').Config} */
export default {
  // relative: resolve globs from this file, so builds work from any working directory.
  content: { relative: true, files: ["./index.html", "./src/**/*.{js,jsx}"] },
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "Segoe UI", "sans-serif"],
      },
      colors: {
        brand: {
          50: "#FFF1F1",
          100: "#FFE0E0",
          200: "#FFB8B8",
          300: "#FF8A8A",
          400: "#F0505A",
          500: "#E0192D",
          600: "#C8001F",
          700: "#A30019",
          800: "#7D0015",
          900: "#5A0010",
        },
        ink: {
          50: "#F7F5F5",
          100: "#EDEAEA",
          200: "#DAD5D5",
          400: "#8A8484",
          500: "#6B6666",
          700: "#343030",
          900: "#1C1919",
        },
      },
    },
  },
  plugins: [],
};
