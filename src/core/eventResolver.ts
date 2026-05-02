export interface EventInfo {
  idmanif: string;
  slug: string;
  url: string;
}

// Parse a TM France event URL to extract idmanif and slug
// Supports formats:
//   https://www.ticketmaster.fr/fr/manifestation/gims-billet/idmanif/645637
//   https://www.ticketmaster.fr/fr/manifestation/gims-billet/idmanif/645637?...
export const resolveEventUrl = (input: string): EventInfo => {
  const trimmed = input.trim();

  // Direct idmanif number
  if (/^\d+$/.test(trimmed)) {
    return { idmanif: trimmed, slug: 'event', url: `https://www.ticketmaster.fr/fr/manifestation/event-billet/idmanif/${trimmed}` };
  }

  // Full URL parsing
  const idmanifMatch = trimmed.match(/idmanif[\/=](\d+)/i);
  if (!idmanifMatch) throw new Error(`URL invalide — idmanif introuvable dans: ${trimmed}`);

  const idmanif = idmanifMatch[1];

  // Extract slug from URL path
  const slugMatch = trimmed.match(/manifestation\/([^/]+)-billet/i);
  const slug = slugMatch ? slugMatch[1] : 'event';

  // Normalize URL
  const url = `https://www.ticketmaster.fr/fr/manifestation/${slug}-billet/idmanif/${idmanif}`;

  return { idmanif, slug, url };
};
