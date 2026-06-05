/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./ui/src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Linear-inspired palette
        bg: {
          DEFAULT: "#222326",
          panel: "#2A2C2F",
          subtle: "#2D2F33",
        },
        fg: {
          DEFAULT: "#F4F5F8",
          muted: "#8A8F98",
          subtle: "#5C616B",
        },
        accent: {
          DEFAULT: "#5E6AD2",
          hover: "#6F7BE0",
        },
        success: "#4CAF50",
        warning: "#FFA726",
        danger: "#EF5350",
        info: "#5E6AD2",
        lane: {
          1: "#5E6AD2",
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
