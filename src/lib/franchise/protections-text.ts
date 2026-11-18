// src/lib/franchise/protections-text.ts
// Plain-words protections for a pick or swap. Pure.
//
// Unknown stays unknown: protections_known null or false says "Protections not
// recorded", never "Unprotected". Only a known pick with no recorded text is
// unprotected.

export interface ProtectionsFields {
  protections_known: boolean | null;
  protections_text: string | null;
}

export const PROTECTIONS_NOT_RECORDED = 'Protections not recorded';

export function protectionsLabel(p: ProtectionsFields): string {
  if (p.protections_known !== true) return PROTECTIONS_NOT_RECORDED;
  const text = p.protections_text?.trim();
  return text ? text : 'Unprotected';
}
