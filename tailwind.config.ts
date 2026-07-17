import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        turf: {
          950: "#0a1f14",
          900: "#0f2c1c",
          800: "#153a24",
          700: "#1c4a2f",
        },
        chalk: "#f4f1ea",
        pigskin: "#c9682b",
      },
      fontFamily: {
        display: ["Georgia", "serif"],
      },
    },
  },
  plugins: [],
};
export default config;
