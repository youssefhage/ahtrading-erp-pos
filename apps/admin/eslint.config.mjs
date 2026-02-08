import next from "eslint-config-next";

const config = [
  // Next.js flat config (includes TypeScript + core rules + recommended ignores).
  ...next,
  // The app has many "load on mount" patterns which are idiomatic for data-fetching UIs.
  // Next's strict hook rule is too aggressive here and blocks linting.
  {
    rules: {
      "react-hooks/set-state-in-effect": "off"
    }
  }
];

export default config;
