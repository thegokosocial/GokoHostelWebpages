import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          red: "#EA3639",
          "red-deep": "#D32F2F",
          green: "#2d5c3f",
          "green-dark": "#1a3d2a",
          sand: "#faf8f4",
          mist: "rgba(45, 92, 63, 0.08)",
        },
      },
      fontFamily: {
        display: ["var(--font-mohave)", "system-ui", "sans-serif"],
        sans: ["var(--font-roboto)", "system-ui", "sans-serif"],
      },
      fontSize: {
        "display-lg": ["clamp(2.25rem,6vw,3.75rem)", { lineHeight: "1.05", letterSpacing: "-0.02em" }],
        "display-md": ["clamp(1.75rem,4vw,2.5rem)", { lineHeight: "1.12", letterSpacing: "-0.02em" }],
        lead: ["clamp(1rem,2.2vw,1.25rem)", { lineHeight: "1.55" }],
      },
      boxShadow: {
        soft: "0 4px 24px rgba(26, 61, 42, 0.08)",
        card: "0 8px 40px rgba(0, 0, 0, 0.06)",
        lift: "0 20px 50px rgba(26, 61, 42, 0.12)",
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.25rem",
      },
      transitionDuration: {
        layout: "360ms",
      },
      transitionTimingFunction: {
        out: "cubic-bezier(0.33, 1, 0.68, 1)",
      },
      keyframes: {
        "goko-float": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
        "goko-shimmer": {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        "goko-gradient": {
          "0%, 100%": { opacity: "0.35" },
          "50%": { opacity: "0.55" },
        },
      },
      animation: {
        "goko-float": "goko-float 7s ease-in-out infinite",
        "goko-shimmer": "goko-shimmer 8s linear infinite",
        "goko-gradient": "goko-gradient 12s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
