// ─── Ship wireframe model data ─────────────────────────────────────────────────
// Coordinate convention (Three.js right-hand): +X = right, +Y = up, -Z = forward (nose)
// All models are centered at origin. Scale applied at render time.

export interface Vec3Data { x: number; y: number; z: number }
export interface EdgeData  { v1: number; v2: number }

export interface ShipModel {
  vertices: Vec3Data[];
  edges: EdgeData[];
  scale: number;
  engineVerts: number[];    // vertex indices for engine glow effects
  gunVert: number;          // vertex index for laser spawn
  combatVertices?: Vec3Data[];  // morph target for wind-up transformation
}

// ─── Cobra Mk III (player ship) ───────────────────────────────────────────────
// Classic player ship: wide delta wings, twin engine pods
const COBRA_VERTICES: Vec3Data[] = [
  { x:  0,    y:  0,    z: -7   },  // 0  nose tip
  { x:  0,    y:  1.5,  z: -2   },  // 1  cockpit top
  { x:  0,    y: -1.5,  z:  0   },  // 2  belly keel
  { x:  6,    y: -1,    z:  0   },  // 3  right wing inner
  { x: -6,    y: -1,    z:  0   },  // 4  left wing inner
  { x:  9,    y: -1,    z:  3   },  // 5  right wing tip
  { x: -9,    y: -1,    z:  3   },  // 6  left wing tip
  { x:  2.5,  y:  0,    z:  5   },  // 7  right engine front
  { x: -2.5,  y:  0,    z:  5   },  // 8  left engine front
  { x:  2.5,  y:  0,    z:  7   },  // 9  right engine rear
  { x: -2.5,  y:  0,    z:  7   },  // 10 left engine rear
  { x:  0,    y:  2,    z:  5   },  // 11 tail fin top
  { x:  2.5,  y: -1.5,  z:  5.5 },  // 12 right engine lower
  { x: -2.5,  y: -1.5,  z:  5.5 },  // 13 left engine lower
];

const COBRA_EDGES: EdgeData[] = [
  { v1: 0, v2: 1 }, { v1: 0, v2: 2 },
  { v1: 0, v2: 3 }, { v1: 0, v2: 4 },
  { v1: 1, v2: 3 }, { v1: 1, v2: 4 },
  { v1: 2, v2: 3 }, { v1: 2, v2: 4 },
  { v1: 3, v2: 5 }, { v1: 4, v2: 6 },
  { v1: 5, v2: 7 }, { v1: 6, v2: 8 },
  { v1: 7, v2: 9 }, { v1: 8, v2: 10 },
  { v1: 9, v2: 10 },
  { v1: 9, v2: 11 }, { v1: 10, v2: 11 },
  { v1: 7, v2: 11 }, { v1: 8, v2: 11 },
  { v1: 7, v2: 12 }, { v1: 8, v2: 13 },
  { v1: 9, v2: 12 }, { v1: 10, v2: 13 },
  { v1: 12, v2: 13 },
  { v1: 3, v2: 7 }, { v1: 4, v2: 8 },
  { v1: 1, v2: 11 },
  { v1: 2, v2: 12 }, { v1: 2, v2: 13 },
];

export const COBRA_MK3: ShipModel = {
  vertices: COBRA_VERTICES,
  edges:    COBRA_EDGES,
  scale:    1.0,
  engineVerts: [9, 10],
  gunVert:  0,
};

// ─── Sidewinder → SWEPT DELTA ARROWHEAD ───────────────────────────────────────
// Very wide, very flat. Span 14 units, depth 9 units, height only 3.5 units.
// Reads as a wide swept triangle from any angle — unmistakably "arrow" shaped.
const SIDEWINDER_VERTICES: Vec3Data[] = [
  { x:  0,    y:  0,    z: -5 },  // 0 nose
  { x:  7,    y:  0,    z:  3 },  // 1 right wing tip
  { x: -7,    y:  0,    z:  3 },  // 2 left wing tip
  { x:  0,    y:  0,    z:  4 },  // 3 tail notch
  { x:  0,    y:  2,    z:  0 },  // 4 top fin
  { x:  0,    y: -1.5,  z:  0 },  // 5 belly keel
];

const SIDEWINDER_EDGES: EdgeData[] = [
  // Outer delta outline
  { v1: 0, v2: 1 }, { v1: 0, v2: 2 },
  { v1: 1, v2: 3 }, { v1: 2, v2: 3 },
  // Centre spine
  { v1: 0, v2: 3 },
  // Top fin struts
  { v1: 0, v2: 4 }, { v1: 1, v2: 4 },
  { v1: 2, v2: 4 }, { v1: 3, v2: 4 },
  // Belly keel struts
  { v1: 0, v2: 5 }, { v1: 1, v2: 5 },
  { v1: 2, v2: 5 }, { v1: 3, v2: 5 },
];

export const SIDEWINDER: ShipModel = {
  vertices:    SIDEWINDER_VERTICES,
  edges:       SIDEWINDER_EDGES,
  scale:       3.5,
  engineVerts: [1, 2],
  gunVert:     0,
};

// ─── Viper → HEXAGON DISC ─────────────────────────────────────────────────────
// Flat six-sided disc: radius 5.5, height only 3 units.
// Looks nearly circular/hexagonal from all Y-rotation angles — distinct from all
// angular shapes.  Inner spokes converge to top and bottom cap points.
const VIPER_VERTICES: Vec3Data[] = [
  { x:  0,     y:  0,   z: -5.5  },  // 0 front point
  { x:  4.76,  y:  0,   z: -2.75 },  // 1 front-right
  { x:  4.76,  y:  0,   z:  2.75 },  // 2 rear-right
  { x:  0,     y:  0,   z:  5.5  },  // 3 rear point
  { x: -4.76,  y:  0,   z:  2.75 },  // 4 rear-left
  { x: -4.76,  y:  0,   z: -2.75 },  // 5 front-left
  { x:  0,     y:  1.5, z:  0    },  // 6 top cap
  { x:  0,     y: -1.5, z:  0    },  // 7 bottom cap
];

const VIPER_EDGES: EdgeData[] = [
  // Hexagon ring
  { v1: 0, v2: 1 }, { v1: 1, v2: 2 }, { v1: 2, v2: 3 },
  { v1: 3, v2: 4 }, { v1: 4, v2: 5 }, { v1: 5, v2: 0 },
  // Top spokes
  { v1: 0, v2: 6 }, { v1: 1, v2: 6 }, { v1: 2, v2: 6 },
  { v1: 3, v2: 6 }, { v1: 4, v2: 6 }, { v1: 5, v2: 6 },
  // Bottom spokes
  { v1: 0, v2: 7 }, { v1: 1, v2: 7 }, { v1: 2, v2: 7 },
  { v1: 3, v2: 7 }, { v1: 4, v2: 7 }, { v1: 5, v2: 7 },
];

export const VIPER: ShipModel = {
  vertices:    VIPER_VERTICES,
  edges:       VIPER_EDGES,
  scale:       4.0,
  engineVerts: [1, 2, 4, 5],
  gunVert:     0,
};

// ─── Krait → TALL MONOLITH ─────────────────────────────────────────────────────
// A tall, narrow rectangular column — height 9 units, width 4, depth 4.
// Crucially the height is in Y, so it remains visually TALL from every Y-rotation
// angle. Top and bottom spikes extend the silhouette further.  Completely unlike
// any flat/disc/delta shape.
const KRAIT_VERTICES: Vec3Data[] = [
  // Top face (Y = +4.5)
  { x:  2,  y:  4.5, z: -2 },  // 0 top front-right
  { x: -2,  y:  4.5, z: -2 },  // 1 top front-left
  { x: -2,  y:  4.5, z:  2 },  // 2 top rear-left
  { x:  2,  y:  4.5, z:  2 },  // 3 top rear-right
  // Bottom face (Y = -4.5)
  { x:  2,  y: -4.5, z: -2 },  // 4 bottom front-right
  { x: -2,  y: -4.5, z: -2 },  // 5 bottom front-left
  { x: -2,  y: -4.5, z:  2 },  // 6 bottom rear-left
  { x:  2,  y: -4.5, z:  2 },  // 7 bottom rear-right
  // Spikes
  { x:  0,  y:  6.5, z:  0 },  // 8 top spike
  { x:  0,  y: -6.5, z:  0 },  // 9 bottom spike
];

const KRAIT_EDGES: EdgeData[] = [
  // Top face
  { v1: 0, v2: 1 }, { v1: 1, v2: 2 }, { v1: 2, v2: 3 }, { v1: 3, v2: 0 },
  // Bottom face
  { v1: 4, v2: 5 }, { v1: 5, v2: 6 }, { v1: 6, v2: 7 }, { v1: 7, v2: 4 },
  // Vertical pillars
  { v1: 0, v2: 4 }, { v1: 1, v2: 5 }, { v1: 2, v2: 6 }, { v1: 3, v2: 7 },
  // Top spike
  { v1: 0, v2: 8 }, { v1: 1, v2: 8 }, { v1: 2, v2: 8 }, { v1: 3, v2: 8 },
  // Bottom spike
  { v1: 4, v2: 9 }, { v1: 5, v2: 9 }, { v1: 6, v2: 9 }, { v1: 7, v2: 9 },
  // Cross braces (add visual interest, break up the flat faces)
  { v1: 0, v2: 6 }, { v1: 3, v2: 5 },
];

export const KRAIT: ShipModel = {
  vertices:    KRAIT_VERTICES,
  edges:       KRAIT_EDGES,
  scale:       4.5,
  engineVerts: [4, 5, 6, 7],
  gunVert:     8,
};

// ─── Thargoid ─────────────────────────────────────────────────────────────────
// Alien saucer: octagonal design, built procedurally
function buildThargoid(): ShipModel {
  const vertices: Vec3Data[] = [];
  const edges: EdgeData[] = [];
  const SIDES = 8;
  const R_OUTER = 7;
  const R_INNER = 3;
  const H = 2;

  // Outer ring
  for (let i = 0; i < SIDES; i++) {
    const a = (i / SIDES) * Math.PI * 2;
    vertices.push({ x: Math.cos(a) * R_OUTER, y: 0,  z: Math.sin(a) * R_OUTER });  // outer mid
    vertices.push({ x: Math.cos(a) * R_INNER, y:  H, z: Math.sin(a) * R_INNER });  // inner top
    vertices.push({ x: Math.cos(a) * R_INNER, y: -H, z: Math.sin(a) * R_INNER });  // inner bottom
  }
  const topCrown = SIDES * 3;
  const botCrown = SIDES * 3 + 1;
  vertices.push({ x: 0, y:  H * 1.8, z: 0 });  // top dome
  vertices.push({ x: 0, y: -H * 1.8, z: 0 });  // bottom dome

  for (let i = 0; i < SIDES; i++) {
    const ni = (i + 1) % SIDES;
    const b = i * 3;
    const nb = ni * 3;
    edges.push({ v1: b,     v2: nb     });  // outer ring
    edges.push({ v1: b,     v2: b + 1  });  // spoke to inner top
    edges.push({ v1: b,     v2: b + 2  });  // spoke to inner bottom
    edges.push({ v1: b + 1, v2: nb + 1 });  // inner top ring
    edges.push({ v1: b + 2, v2: nb + 2 });  // inner bottom ring
    edges.push({ v1: b + 1, v2: topCrown }); // to top dome
    edges.push({ v1: b + 2, v2: botCrown }); // to bottom dome
    if (i % 2 === 0) {
      edges.push({ v1: b + 1, v2: b + 2 });
    }
  }

  const engineVerts: number[] = [];
  for (let i = 0; i < SIDES; i++) engineVerts.push(i * 3);

  return {
    vertices,
    edges,
    scale: 5.5,
    engineVerts,
    gunVert: topCrown,
  };
}

function buildThargoidCombat(): Vec3Data[] {
  const vertices: Vec3Data[] = [];
  const SIDES     = 8;
  const R_OUTER_C = 12;
  const R_INNER   = 3;
  const H         = 2;

  for (let i = 0; i < SIDES; i++) {
    const a      = (i / SIDES) * Math.PI * 2;
    const thornY = i % 2 === 0 ? H * 4 : -H * 4;
    vertices.push({ x: Math.cos(a) * R_OUTER_C, y: 0,         z: Math.sin(a) * R_OUTER_C });
    vertices.push({ x: Math.cos(a) * R_INNER,   y:  thornY,   z: Math.sin(a) * R_INNER   });
    vertices.push({ x: Math.cos(a) * R_INNER,   y: -thornY,   z: Math.sin(a) * R_INNER   });
  }
  vertices.push({ x: 0, y:  H * 5, z: 0 });
  vertices.push({ x: 0, y: -H * 5, z: 0 });
  return vertices;
}

export const THARGOID: ShipModel = { ...buildThargoid(), combatVertices: buildThargoidCombat() };

// ─── Gecko → 4-ARM CROSS ──────────────────────────────────────────────────────
// Four equal blades radiating from a central square body — reads as an X/pinwheel
// from above. Top and bottom dome perfectly symmetric. Very different from delta,
// disc, and monolith shapes.
const GECKO_VERTICES: Vec3Data[] = [
  { x:  0,    y:  0,   z: -6   },  // 0 forward blade tip
  { x:  6,    y:  0,   z:  0   },  // 1 right blade tip
  { x:  0,    y:  0,   z:  6   },  // 2 rear blade tip
  { x: -6,    y:  0,   z:  0   },  // 3 left blade tip
  { x:  2.5,  y:  0,   z: -2.5 },  // 4 forward-right body corner
  { x:  2.5,  y:  0,   z:  2.5 },  // 5 rear-right body corner
  { x: -2.5,  y:  0,   z:  2.5 },  // 6 rear-left body corner
  { x: -2.5,  y:  0,   z: -2.5 },  // 7 forward-left body corner
  { x:  0,    y:  2.5, z:  0   },  // 8 top dome   (symmetric with bottom)
  { x:  0,    y: -2.5, z:  0   },  // 9 bottom dome (symmetric with top)
];

const GECKO_EDGES: EdgeData[] = [
  // Four blade spokes
  { v1: 0, v2: 4 }, { v1: 0, v2: 7 },
  { v1: 1, v2: 4 }, { v1: 1, v2: 5 },
  { v1: 2, v2: 5 }, { v1: 2, v2: 6 },
  { v1: 3, v2: 6 }, { v1: 3, v2: 7 },
  // Central body ring
  { v1: 4, v2: 5 }, { v1: 5, v2: 6 }, { v1: 6, v2: 7 }, { v1: 7, v2: 4 },
  // Top dome
  { v1: 4, v2: 8 }, { v1: 5, v2: 8 }, { v1: 6, v2: 8 }, { v1: 7, v2: 8 },
  // Bottom dome
  { v1: 4, v2: 9 }, { v1: 5, v2: 9 }, { v1: 6, v2: 9 }, { v1: 7, v2: 9 },
];

export const GECKO: ShipModel = {
  vertices:    GECKO_VERTICES,
  edges:       GECKO_EDGES,
  scale:       4.0,
  engineVerts: [4, 5, 6, 7],
  gunVert:     0,
};

// ─── Model registry ───────────────────────────────────────────────────────────
export type ShipType = 'player' | 'sidewinder' | 'viper' | 'krait' | 'gecko' | 'thargoid';

export function getModel(type: ShipType): ShipModel {
  switch (type) {
    case 'player':     return COBRA_MK3;
    case 'sidewinder': return SIDEWINDER;
    case 'viper':      return VIPER;
    case 'krait':      return KRAIT;
    case 'gecko':      return GECKO;
    case 'thargoid':   return THARGOID;
  }
}
