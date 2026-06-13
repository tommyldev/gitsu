/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./ui/src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Black / steel liquid-glass palette (Linear-style monochrome)
        bg: {
          DEFAULT: "#0b0c0e",
          panel: "#141519",
          subtle: "#1c1e23",
        },
        fg: {
          DEFAULT: "#F4F5F8",
          muted: "#8A8F98",
          subtle: "#5C616B",
        },
        accent: {
          DEFAULT: "#c8cdd6",
          hover: "#e2e5ea",
          bright: "#f4f5f8",
        },
        success: "rgb(76 175 80 / <alpha-value>)",
        warning: "rgb(255 167 38 / <alpha-value>)",
        danger: "rgb(239 83 80 / <alpha-value>)",
        info: "#c8cdd6",
        lane: {
          1: "#c8cdd6",
          2: "#6B7280",
          3: "#9CA3AF",
          4: "#D1D5DB",
          5: "#A1A1AA",
          6: "#7E82A6",
          7: "#8B8FA3",
          8: "#787C8E",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        display: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      transitionTimingFunction: {
        glass: "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        standard: "cubic-bezier(0.25, 0.1, 0.25, 1.0)",
      },
    },
  },
  plugins: [],
};
