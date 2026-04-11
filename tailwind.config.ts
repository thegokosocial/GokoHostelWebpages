import type { Config } from "tailwindcss";
import type { PluginAPI } from "tailwindcss/types/config";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
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
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
      },
      fontFamily: {
        display: ["var(--font-mohave)", "system-ui", "sans-serif"],
        heading: ["var(--font-mohave)", "system-ui", "sans-serif"],
        sans: ["var(--font-roboto)", "system-ui", "sans-serif"],
      },
      fontSize: {
        "display-xl": ["clamp(2.75rem,7vw,4.5rem)", { lineHeight: "1.02", letterSpacing: "-0.03em" }],
        "display-lg": ["clamp(2.25rem,6vw,3.75rem)", { lineHeight: "1.05", letterSpacing: "-0.025em" }],
        "display-md": ["clamp(1.75rem,4vw,2.75rem)", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
        "display-sm": ["clamp(1.25rem,2.5vw,1.5rem)", { lineHeight: "1.2", letterSpacing: "-0.01em" }],
        lead: ["clamp(1rem,2.2vw,1.25rem)", { lineHeight: "1.55" }],
      },
      boxShadow: {
        soft: "0 4px 24px rgba(26, 61, 42, 0.08)",
        card: "0 8px 32px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.04)",
        lift: "0 24px 48px -12px rgba(26, 61, 42, 0.15)",
        "lift-lg": "0 32px 64px -16px rgba(26, 61, 42, 0.18)",
        glow: "0 0 40px rgba(45, 92, 63, 0.12)",
        "glow-red": "0 0 40px rgba(234, 54, 57, 0.1)",
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.5rem",
        "4xl": "2rem",
      },
      transitionDuration: {
        layout: "360ms",
      },
      transitionTimingFunction: {
        out: "cubic-bezier(0.33, 1, 0.68, 1)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height, var(--accordion-panel-height, auto))" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height, var(--accordion-panel-height, auto))" },
          to: { height: "0" },
        },
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
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "goko-float": "goko-float 7s ease-in-out infinite",
        "goko-shimmer": "goko-shimmer 8s linear infinite",
        "goko-gradient": "goko-gradient 12s ease-in-out infinite",
      },
    },
  },
  plugins: [
    ({ addVariant }: PluginAPI) => {
      addVariant("data-open", '&[data-open]:not([data-open="false"])');
      addVariant("data-closed", '&[data-closed]:not([data-closed="false"])');
      addVariant("data-checked", '&[data-checked]:not([data-checked="false"])');
    },
  ],
};

export default config;
