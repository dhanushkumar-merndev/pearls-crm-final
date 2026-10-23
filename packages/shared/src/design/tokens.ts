import raw from "./tokens.json" with { type: "json" };

export type ThemeMode = "dark" | "light";

export type ColorTokens = (typeof raw.color)["dark"];
export type ChartTokens = (typeof raw.chart)["dark"];
export type StatusTokens = typeof raw.status;

export const tokens = raw;

export const colorTokens = (mode: ThemeMode): ColorTokens => raw.color[mode];
export const chartTokens = (mode: ThemeMode): ChartTokens => raw.chart[mode];
export const statusTokens: StatusTokens = raw.status;

export type StatusKind = keyof StatusTokens;
