import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["app/**/*.tsx", "components/**/*.tsx"],
    rules: {
      // Owner, 02/11/2026: no browser date / time boxes. Use components/ui/date-picker.tsx.
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='type'][value.value=/^(date|datetime-local|time|month|week)$/]",
          message: "Use DatePicker / DateRangePicker / DateTimePicker / TimePicker / MonthPicker from components/ui/date-picker.tsx, not a browser date box.",
        },
      ],
    },
  },
  globalIgnores([".next/**", "playwright-report/**", "test-results/**", "next-env.d.ts"]),
]);
