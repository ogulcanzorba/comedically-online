export interface Theme {
  id: string;
  name: string;
  deep: string;
  mid: string;
  glow: string;
}

export const THEMES: Theme[] = [
  { id: 'ember', name: 'Ember', deep: '#431407', mid: '#9a3412', glow: '#fbbf24' },
  { id: 'slate', name: 'Slate', deep: '#020617', mid: '#334155', glow: '#94a3b8' },
  { id: 'teal', name: 'Teal', deep: '#042f2e', mid: '#0f766e', glow: '#5eead4' },
  { id: 'rose', name: 'Rose', deep: '#4c0519', mid: '#be123c', glow: '#fda4af' },
  { id: 'gold', name: 'Gold', deep: '#451a03', mid: '#b45309', glow: '#fde68a' },
  { id: 'forest', name: 'Forest', deep: '#052e16', mid: '#15803d', glow: '#86efac' },
  { id: 'coral', name: 'Coral', deep: '#431407', mid: '#c2410c', glow: '#fdba74' },
  { id: 'moss', name: 'Moss', deep: '#1a2e05', mid: '#4d7c0f', glow: '#bef264' },
  { id: 'ocean', name: 'Ocean', deep: '#082f49', mid: '#0369a1', glow: '#7dd3fc' },
  { id: 'copper', name: 'Copper', deep: '#3b0a0a', mid: '#9a3412', glow: '#fca5a5' },
  { id: 'night', name: 'Night', deep: '#0c0a09', mid: '#44403c', glow: '#e7e5e4' },
  { id: 'berry', name: 'Berry', deep: '#3b0764', mid: '#7e22ce', glow: '#d8b4fe' },
];

export function themeById(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
