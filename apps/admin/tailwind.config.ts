import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", ...defaultTheme.fontFamily.sans],
        mono: ["var(--font-mono)", ...defaultTheme.fontFamily.mono]
      },
      colors: {
        border: "rgb(var(--border))",
        "border-subtle": "rgb(var(--border-subtle))",
        "border-strong": "rgb(var(--border-strong))",
        background: "rgb(var(--bg))",
        "bg-elevated": "rgb(var(--bg-elevated))",
        "bg-sunken": "rgb(var(--bg-sunken))",
        foreground: "rgb(var(--fg))",
        "fg-muted": "rgb(var(--fg-muted))",
        "fg-subtle": "rgb(var(--fg-subtle))",
        primary: {
          DEFAULT: "rgb(var(--primary))",
          foreground: "rgb(var(--primary-fg))",
          dim: "rgb(var(--primary-dim))"
        },
        success: {
          DEFAULT: "rgb(var(--success))",
          foreground: "rgb(var(--success-fg))"
        },
        warning: {
          DEFAULT: "rgb(var(--warning))",
          foreground: "rgb(var(--warning-fg))"
        },
        danger: {
          DEFAULT: "rgb(var(--danger))",
          foreground: "rgb(var(--danger-fg))"
        },
        info: {
          DEFAULT: "rgb(var(--info))",
          foreground: "rgb(var(--info-fg))"
        },
        terminal: {
          green: "rgb(var(--terminal-green))",
          amber: "rgb(var(--terminal-amber))",
          cyan: "rgb(var(--terminal-cyan))"
        }
      },
      boxShadow: {
        // Tie glows to theme tokens (and avoid amber/orange hardcoding).
        "glow-amber": "0 0 20px rgb(var(--warning) / 0.15)",
        "glow-green": "0 0 20px rgb(var(--success) / 0.15)",
        "glow-red": "0 0 20px rgb(var(--danger) / 0.15)"
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-in-right": "slideInRight 0.2s ease-out",
        "pulse-subtle": "pulseSubtle 2s ease-in-out infinite"
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" }
        },
        slideInRight: {
          "0%": { opacity: "0", transform: "translateX(10px)" },
          "100%": { opacity: "1", transform: "translateX(0)" }
        },
        pulseSubtle: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" }
        }
      }
    }
  },
  plugins: []
};

export default config;
