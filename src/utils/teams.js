// src/utils/teams.js
// Catálogo de "equipo del que sos hincha" para el perfil del jugador.
// Escudos en public/team-badges/{a,b}/{slug}.svg — bajados a mano de
// footylogos.com por el usuario (no hay descarga masiva gratuita disponible,
// se investigó y se descartó). Cobertura: Liga Profesional (A, sin Barracas
// Central ni Deportivo Riestra, criterio del usuario) y una selección de
// Primera Nacional (B) con los clubes que sus grupos realmente siguen.
export const TEAM_OPTIONS = [
  // ── Primera División (Liga Profesional) ───────────────────────────────────
  { value: 'aldosivi', label: 'Aldosivi', league: 'A', badge: '/team-badges/a/aldosivi.svg' },
  { value: 'argentinos-juniors', label: 'Argentinos Juniors', league: 'A', badge: '/team-badges/a/argentinos-juniors.svg' },
  { value: 'atletico-platense', label: 'Atlético Platense', league: 'A', badge: '/team-badges/a/atletico-platense.svg' },
  { value: 'atletico-tucuman', label: 'Atlético Tucumán', league: 'A', badge: '/team-badges/a/atletico-tucuman.svg' },
  { value: 'banfield', label: 'Banfield', league: 'A', badge: '/team-badges/a/banfield.svg' },
  { value: 'belgrano', label: 'Belgrano', league: 'A', badge: '/team-badges/a/belgrano.svg' },
  { value: 'boca-juniors', label: 'Boca Juniors', league: 'A', badge: '/team-badges/a/boca-juniors.svg' },
  { value: 'central-cordoba-se', label: 'Central Córdoba (SE)', league: 'A', badge: '/team-badges/a/central-cordoba-se.svg' },
  { value: 'defensa-y-justicia', label: 'Defensa y Justicia', league: 'A', badge: '/team-badges/a/defensa-y-justicia.svg' },
  { value: 'estudiantes-de-la-plata', label: 'Estudiantes de La Plata', league: 'A', badge: '/team-badges/a/estudiantes-de-la-plata.svg' },
  { value: 'estudiantes-de-rio-cuarto', label: 'Estudiantes de Río Cuarto', league: 'A', badge: '/team-badges/a/estudiantes-de-rio-cuarto.svg' },
  { value: 'gimnasia-y-esgrima-lp', label: 'Gimnasia y Esgrima (LP)', league: 'A', badge: '/team-badges/a/gimnasia-y-esgrima-lp.svg' },
  { value: 'huracan', label: 'Huracán', league: 'A', badge: '/team-badges/a/huracan.svg' },
  { value: 'independiente', label: 'Independiente', league: 'A', badge: '/team-badges/a/independiente.svg' },
  { value: 'independiente-rivadavia', label: 'Independiente Rivadavia', league: 'A', badge: '/team-badges/a/independiente-rivadavia.svg' },
  { value: 'instituto-cordoba', label: 'Instituto Córdoba', league: 'A', badge: '/team-badges/a/instituto-cordoba.svg' },
  { value: 'lanus', label: 'Lanús', league: 'A', badge: '/team-badges/a/lanus.svg' },
  { value: 'newells-old-boys', label: "Newell's Old Boys", league: 'A', badge: '/team-badges/a/newells-old-boys.svg' },
  { value: 'racing-club', label: 'Racing Club', league: 'A', badge: '/team-badges/a/racing-club.svg' },
  { value: 'river-plate', label: 'River Plate', league: 'A', badge: '/team-badges/a/river-plate.svg' },
  { value: 'rosario-central', label: 'Rosario Central', league: 'A', badge: '/team-badges/a/rosario-central.svg' },
  { value: 'san-lorenzo', label: 'San Lorenzo', league: 'A', badge: '/team-badges/a/san-lorenzo.svg' },
  { value: 'sarmiento', label: 'Sarmiento', league: 'A', badge: '/team-badges/a/sarmiento.svg' },
  { value: 'talleres', label: 'Talleres', league: 'A', badge: '/team-badges/a/talleres.svg' },
  { value: 'tigre', label: 'Tigre', league: 'A', badge: '/team-badges/a/tigre.svg' },
  { value: 'union', label: 'Unión', league: 'A', badge: '/team-badges/a/union.svg' },
  { value: 'velez-sarsfield', label: 'Vélez Sarsfield', league: 'A', badge: '/team-badges/a/velez-sarsfield.svg' },

  // ── Primera Nacional (B) ────────────────────────────────────────────────
  { value: 'atletico-atlanta', label: 'Atlético Atlanta', league: 'B', badge: '/team-badges/b/atletico-atlanta.svg' },
  { value: 'central-norte', label: 'Central Norte', league: 'B', badge: '/team-badges/b/central-norte.svg' },
  { value: 'chacarita-juniors', label: 'Chacarita Juniors', league: 'B', badge: '/team-badges/b/chacarita-juniors.svg' },
  { value: 'colon-santa-fe', label: 'Colón', league: 'B', badge: '/team-badges/b/colon-santa-fe.svg' },
  { value: 'deportivo-moron', label: 'Deportivo Morón', league: 'B', badge: '/team-badges/b/deportivo-moron.svg' },
  { value: 'ferro-carril-oeste', label: 'Ferro Carril Oeste', league: 'B', badge: '/team-badges/b/ferro-carril-oeste.svg' },
  { value: 'gimnasia-de-jujuy', label: 'Gimnasia de Jujuy', league: 'B', badge: '/team-badges/b/gimnasia-de-jujuy.svg' },
  { value: 'gimnasia-y-tiro', label: 'Gimnasia y Tiro', league: 'B', badge: '/team-badges/b/gimnasia-y-tiro.svg' },
  { value: 'godoy-cruz', label: 'Godoy Cruz', league: 'B', badge: '/team-badges/b/godoy-cruz.svg' },
  { value: 'patronato', label: 'Patronato', league: 'B', badge: '/team-badges/b/patronato.svg' },
  { value: 'racing-cordoba', label: 'Racing (Córdoba)', league: 'B', badge: '/team-badges/b/racing.svg' },
  { value: 'san-martin-sj', label: 'San Martín (SJ)', league: 'B', badge: '/team-badges/b/san-martin-sj.svg' },
  { value: 'san-martin-tucuman', label: 'San Martín de Tucumán', league: 'B', badge: '/team-badges/b/san-martin-tucuman.svg' },
  { value: 'temperley', label: 'Temperley', league: 'B', badge: '/team-badges/b/temperley.svg' },
]

export const LEAGUE_BADGES = {
  A: '/team-badges/a/liga-profesional-argentina.svg',
  B: '/team-badges/b/primera-nacional-argentina.svg',
}

export function findTeam(value) {
  return TEAM_OPTIONS.find((t) => t.value === value) ?? null
}
