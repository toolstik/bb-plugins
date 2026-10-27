// The session color palette, shared by server.ts (validation, CLI) and
// app.tsx (styles, picker).
//
// Each color is a muted OKLCH tone with a separate value for light and dark
// UI. Where a color is drawn, app.tsx mixes it with the theme's `--ink`, so
// custom palettes (Nord, Solarized, ...) tint it toward their own foreground.

export const SESSION_COLOR_IDS = [
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "purple",
  "pink",
] as const;

export type SessionColorId = (typeof SESSION_COLOR_IDS)[number];

export interface SessionColor {
  id: SessionColorId;
  label: string;
  /** CSS color for light themes. */
  light: string;
  /** CSS color for dark themes. */
  dark: string;
}

export const SESSION_COLORS: readonly SessionColor[] = [
  { id: "red", label: "Red", light: "oklch(0.60 0.13 25)", dark: "oklch(0.70 0.11 25)" },
  { id: "orange", label: "Orange", light: "oklch(0.66 0.12 55)", dark: "oklch(0.74 0.10 55)" },
  { id: "yellow", label: "Yellow", light: "oklch(0.72 0.11 90)", dark: "oklch(0.80 0.09 90)" },
  { id: "green", label: "Green", light: "oklch(0.62 0.11 150)", dark: "oklch(0.72 0.09 150)" },
  { id: "cyan", label: "Cyan", light: "oklch(0.62 0.09 210)", dark: "oklch(0.74 0.08 210)" },
  { id: "blue", label: "Blue", light: "oklch(0.58 0.12 255)", dark: "oklch(0.70 0.10 255)" },
  { id: "purple", label: "Purple", light: "oklch(0.58 0.12 300)", dark: "oklch(0.70 0.10 300)" },
  { id: "pink", label: "Pink", light: "oklch(0.64 0.12 350)", dark: "oklch(0.74 0.10 350)" },
];

export function isSessionColorId(value: unknown): value is SessionColorId {
  return (
    typeof value === "string" &&
    (SESSION_COLOR_IDS as readonly string[]).includes(value)
  );
}

/** The CSS custom property holding a palette color for the current theme. */
export function sessionColorVar(id: SessionColorId): string {
  return `--session-color-${id}`;
}
