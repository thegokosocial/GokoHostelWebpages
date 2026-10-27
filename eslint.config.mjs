import nextVitals from "eslint-config-next/core-web-vitals";
import { globalIgnores } from "eslint/config";

export default [
  globalIgnores([
    ".next/**",
    ".open-next/**",
    ".wrangler/**",
    "node_modules/**",
    "public/ffmpeg/**",
    "scripts/**",
  ]),
  ...nextVitals,
  {
    rules: {
      "react-hooks/error-boundaries": "off",
      "react-hooks/immutability": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
      "react-hooks/use-memo": "off",
    },
  },
];
