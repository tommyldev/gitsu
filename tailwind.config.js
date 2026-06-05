/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./ui/src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#020617",
          panel: "rgba(255,255,255,0.03)",
          subtle: "rgba(255,255,255,0.06)",
        },
        fg: {
          DEFAULT: "#e2e8f0",
          muted: "#94a3b8",
          subtle: "#64748b",
        },
        accent: {
          DEFAULT: "#38bdf8",
          hover: "#7dd3fc",
        },
        success: "#34d399",
        warning: "#fbbf24",
        danger: "#f87171",
        info: "#60a5fa",
        lane: {
          1: "#38bdf8",
          2: "#34d399",
          3: "#fbbf24",
          4: "#f87171",
          5: "#a78bfa",
          6: "#22d3ee",
          7: "#fb923c",
          8: "#f472b6",
        },
      },
      fontFamily: {
        sans: [
          "Inter Tight",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        display: [
          "Instrument Serif",
          "Georgia",
          "serif",
        ],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      transitionTimingFunction: {
        glass: "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
      },
    },
  },
  plugins: [],
};
