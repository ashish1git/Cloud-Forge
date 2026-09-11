/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        base: "#12141C",
        panel: "#1A1D29",
        panelhover: "#20232F",
        border: "#2A2E3D",
        text: "#E4E6EB",
        muted: "#8B90A3",
        running: "#4FD1C5",
        building: "#F2B84B",
        failed: "#E85C5C",
        pending: "#8B90A3",
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
