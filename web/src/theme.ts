import { type MantineColorsTuple } from "@mantine/core";
import { baseTheme, extendTheme } from "@hca/mantine-workbench";

// Wave UI.8 (2026-05-20) — theme now inherits from `baseTheme` from
// `@hca/mantine-workbench` (font scale, defaultRadius, workbench
// component defaults). HCA's own brand color + a differing
// fontFamily on top.

const hcaPurple: MantineColorsTuple = [
  "#f5eef8",
  "#e6d5f0",
  "#d1b3e3",
  "#bb8fd5",
  "#a56ec7",
  "#8e4eb9",
  "#7a3aa8",
  "#652d91",
  "#3e1162",
  "#2a0b43",
];

export const theme = extendTheme(baseTheme, {
  primaryColor: "hca-purple",
  colors: {
    "hca-purple": hcaPurple,
  },
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  headings: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
});
