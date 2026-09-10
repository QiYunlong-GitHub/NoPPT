export function generateId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function generateSlideId(): string {
  return generateId('slide');
}

export function generateElementId(): string {
  return generateId('el');
}

export function generatePresentationId(): string {
  return generateId('pres');
}

export function generateGroupId(): string {
  return generateId('group');
}

export function generateThemeId(): string {
  return generateId('theme');
}
