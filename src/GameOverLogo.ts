// ─── GameOverLogo ─────────────────────────────────────────────────────────────
// Self-contained Three.js renderer for the animated GAME / OVER 3D title.
// Mirrors the NeonFluxLogo approach but uses red/orange palette.

import * as THREE from 'three';

const LH   = 4.0;
const LW   = 3.0;
const GAP  = 0.55;
const ROWG = 0.6;
const BARW = LW * 0.24;
const BARH = LH * 0.16;
const CH   = LH * 0.11;
const DEPTH = 0.55;

const RED = 0xff2233;
const ORG = 0xff7700;

function _shape(pts: [number, number][]): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}

// ─── G ───────────────────────────────────────────────────────────────────────
function _shapesG(): THREE.Shape[] {
  const x0 = 0, x1 = LW, b = 0, t = LH, m = LH / 2;
  return [_shape([
    [x1 - CH, t], [x0 + CH, t],
    [x0, t - CH], [x0, b + CH],
    [x0 + CH, b], [x1 - CH, b],
    [x1, b + CH], [x1, m],
    [x1 - BARW, m], [x1 - BARW, b + BARH],
    [x0 + BARW, b + BARH], [x0 + BARW, t - BARH],
    [x1 - CH, t - BARH],
  ])];
}

// ─── A ───────────────────────────────────────────────────────────────────────
// Simple upside-down V — no crossbar, single non-self-intersecting polygon.
function _shapesA(): THREE.Shape[] {
  const x0 = 0, x1 = LW, b = 0, t = LH;
  const peak = LW / 2;
  const hw = BARW * 0.55;
  return [_shape([
    [x0, b],
    [peak - hw, t],
    [peak + hw, t],
    [x1, b],
    [x1 - BARW, b],
    [peak, t],          // inner peak — splits V cleanly into two halves
    [x0 + BARW, b],
  ])];
}

// ─── M ───────────────────────────────────────────────────────────────────────
function _shapesM(): THREE.Shape[] {
  const x0 = 0, x1 = LW, b = 0, t = LH, d = BARW, s = 1.0;
  return [_shape([
    [x0, b], [x0, t], [d + s, t],
    [x1 / 2, t - LH * 0.4],
    [x1 - d - s, t], [x1, t], [x1, b],
    [x1 - d, b],
    [x1 / 2, t - LH * 0.4 - BARH * 1.2],
    [d, b],
  ])];
}

// ─── E ───────────────────────────────────────────────────────────────────────
function _shapesE(): THREE.Shape[] {
  const x0 = 0, x1 = LW, b = 0, t = LH, m = LH / 2;
  return [_shape([
    [x0, t - CH], [x0 + CH, t],
    [x1, t], [x1, t - BARH],
    [x0 + BARW, t - BARH],
    [x0 + BARW, m + BARH * 0.5],
    [x1 - LW * 0.12, m + BARH * 0.5],
    [x1 - LW * 0.12, m - BARH * 0.5],
    [x0 + BARW, m - BARH * 0.5],
    [x0 + BARW, b + BARH],
    [x1, b + BARH], [x1, b],
    [x0 + CH, b], [x0, b + CH],
  ])];
}

// ─── O ───────────────────────────────────────────────────────────────────────
function _shapesO(): THREE.Shape[] {
  const x0 = 0, x1 = LW, b = 0, t = LH;
  const outer = _shape([
    [x0 + CH, t], [x1 - CH, t], [x1, t - CH],
    [x1, b + CH], [x1 - CH, b], [x0 + CH, b],
    [x0, b + CH], [x0, t - CH],
  ]);
  const d = BARW;
  const hole = new THREE.Path();
  const hp: [number, number][] = [
    [x0 + CH + d * 0.6, t - d], [x1 - CH - d * 0.6, t - d], [x1 - d, t - CH - d * 0.2],
    [x1 - d, b + CH + d * 0.2], [x1 - CH - d * 0.6, b + d], [x0 + CH + d * 0.6, b + d],
    [x0 + d, b + CH + d * 0.2], [x0 + d, t - CH - d * 0.2],
  ];
  hole.moveTo(hp[0][0], hp[0][1]);
  for (let i = 1; i < hp.length; i++) hole.lineTo(hp[i][0], hp[i][1]);
  hole.closePath();
  outer.holes.push(hole);
  return [outer];
}

// ─── V ───────────────────────────────────────────────────────────────────────
function _shapesV(): THREE.Shape[] {
  const x0 = 0, x1 = LW, b = 0, t = LH;
  const peak = LW / 2;
  return [_shape([
    [x0, t], [x0 + BARW, t],
    [peak, b + CH],
    [x1 - BARW, t], [x1, t],
    [peak + BARW * 0.5, b],
    [peak - BARW * 0.5, b],
  ])];
}

// ─── R ───────────────────────────────────────────────────────────────────────
function _shapesR(): THREE.Shape[] {
  const x0 = 0, x1 = LW, b = 0, t = LH, m = LH * 0.45;
  const outer = _shape([
    [x0, b], [x0, t],
    [x1 - CH, t], [x1, t - CH],
    [x1, m + CH], [x1 - CH, m],
    [x1, b], [x1 - BARW, b],
    [x1 - BARW - BARW * 0.5, m],
    [x0 + BARW, m], [x0 + BARW, b],
  ]);
  const hole = new THREE.Path();
  hole.moveTo(x0 + BARW, t - BARH);
  hole.lineTo(x1 - BARW - CH * 0.5, t - BARH);
  hole.lineTo(x1 - BARW, t - BARH - CH * 0.5);
  hole.lineTo(x1 - BARW, m + BARH + CH * 0.5);
  hole.lineTo(x1 - BARW - CH * 0.5, m + BARH);
  hole.lineTo(x0 + BARW, m + BARH);
  hole.closePath();
  outer.holes.push(hole);
  return [outer];
}

// ─── Scene-level group (for in-game death text) ──────────────────────────────
// Returns a Three.js Group containing block-letter LineSegments for each of the
// 8 letters in "GAME OVER", all initially hidden so callers can reveal them
// one by one.  Scale the group in world-space as needed.
export function buildGameOverGroup(): { group: THREE.Group; letters: THREE.LineSegments[] } {
  const group   = new THREE.Group();
  const letters: THREE.LineSegments[] = [];

  const addWord = (
    fns:   Array<() => THREE.Shape[]>,
    color: number,
    rowY:  number,
  ) => {
    const stride = LW + GAP;
    const totalW = stride * (fns.length - 1);
    fns.forEach((fn, i) => {
      const geo   = new THREE.ExtrudeGeometry(fn(), EXTRUDE);
      geo.center();
      const edges = new THREE.EdgesGeometry(geo, 20);
      const mat   = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity:     0.92,
        blending:    THREE.AdditiveBlending,
        depthWrite:  false,
        toneMapped:  false,
      });
      const ls = new THREE.LineSegments(edges, mat);
      ls.position.set(-totalW / 2 + i * stride, rowY, 0);
      ls.visible = false;
      geo.dispose();
      group.add(ls);
      letters.push(ls);
    });
  };

  addWord([_shapesG, _shapesA, _shapesM, _shapesE], RED,  (LH + ROWG) / 2);
  addWord([_shapesO, _shapesV, _shapesE, _shapesR], ORG, -(LH + ROWG) / 2);

  return { group, letters };
}

// ─── Build helpers ────────────────────────────────────────────────────────────
const EXTRUDE: THREE.ExtrudeGeometryOptions = {
  depth: DEPTH,
  bevelEnabled: true,
  bevelThickness: 0.06,
  bevelSize: 0.05,
  bevelSegments: 3,
  curveSegments: 4,
};

function _buildLetter(shapes: THREE.Shape[], color: number): THREE.Group {
  const group = new THREE.Group();
  const geo   = new THREE.ExtrudeGeometry(shapes, EXTRUDE);
  geo.center();
  const edges = new THREE.EdgesGeometry(geo, 20);
  const mat   = new THREE.LineBasicMaterial({ color });
  group.add(new THREE.LineSegments(edges, mat));
  geo.dispose();
  return group;
}

function _placeWord(
  letterFns: Array<() => THREE.Shape[]>,
  color: number,
  rowY: number,
  parent: THREE.Group,
): void {
  const stride = LW + GAP;
  const totalW = stride * (letterFns.length - 1);
  letterFns.forEach((fn, i) => {
    const mesh = _buildLetter(fn(), color);
    mesh.position.set(-totalW / 2 + i * stride, rowY, 0);
    parent.add(mesh);
  });
}

// ─── GameOverLogo class ───────────────────────────────────────────────────────
export class GameOverLogo {
  private _renderer:  THREE.WebGLRenderer;
  private _scene:     THREE.Scene;
  private _camera:    THREE.PerspectiveCamera;
  private _root:      THREE.Group;
  private _redLight:  THREE.PointLight;
  private _orgLight:  THREE.PointLight;
  private _raf = 0;
  private _t   = 0;
  // Scale-down intro: _t runs at 0.008/frame → 0.48/s, so 0.72 ≈ 1.5 s
  private static readonly INTRO_T = 0.72;

  readonly canvas: HTMLCanvasElement;

  constructor() {
    this._renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = this._renderer.domElement;
    this.canvas.className = 'neon-flux-canvas';

    this._scene  = new THREE.Scene();
    this._camera = new THREE.PerspectiveCamera(38, 2, 0.1, 200);
    this._camera.position.set(0, 0, 24);

    this._scene.add(new THREE.AmbientLight(0x200010, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 0.5);
    key.position.set(6, 10, 14);
    this._scene.add(key);

    this._redLight = new THREE.PointLight(RED, 2.5, 40, 2);
    this._redLight.position.set(-6, 6, 6);
    this._scene.add(this._redLight);

    this._orgLight = new THREE.PointLight(ORG, 2.5, 40, 2);
    this._orgLight.position.set(6, -6, 6);
    this._scene.add(this._orgLight);

    this._root = new THREE.Group();
    this._scene.add(this._root);

    const rowSpacing = LH + ROWG;
    _placeWord([_shapesG, _shapesA, _shapesM, _shapesE], RED,  rowSpacing / 2,  this._root);
    _placeWord([_shapesO, _shapesV, _shapesE, _shapesR], ORG, -rowSpacing / 2, this._root);

    this._setSize(480, 220);
  }

  private _setSize(w: number, h: number): void {
    this._renderer.setSize(w, h, false);
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
  }

  resize(w: number, h: number): void { this._setSize(w, h); }

  start(): void {
    if (this._raf) return;
    const tick = () => {
      this._raf = requestAnimationFrame(tick);
      this._t += 0.008;
      // Scale-down intro: ease-out cubic from 2× → 1× over ~1.5 s
      const ip = Math.min(1, this._t / GameOverLogo.INTRO_T);
      this._root.scale.setScalar(1 + (1 - (1 - (1 - ip) * (1 - ip) * (1 - ip))));
      this._root.rotation.y = Math.sin(this._t) * 0.25;
      this._root.rotation.x = Math.sin(this._t * 0.7) * 0.06;
      this._root.rotation.z = Math.sin(this._t * 0.5) * 0.08;
      this._redLight.position.x = Math.cos(this._t * 0.6) * 8 - 2;
      this._redLight.position.y = Math.sin(this._t * 0.4) * 4 + 3;
      this._orgLight.position.x = Math.cos(this._t * 0.6 + Math.PI) * 8 + 2;
      this._orgLight.position.y = Math.sin(this._t * 0.4 + Math.PI) * 4 - 3;
      this._renderer.render(this._scene, this._camera);
    };
    tick();
  }

  stop(): void {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
  }

  dispose(): void {
    this.stop();
    this._scene.traverse(obj => {
      if ((obj as THREE.LineSegments).isLineSegments) {
        const ls = obj as THREE.LineSegments;
        ls.geometry.dispose();
        (ls.material as THREE.Material).dispose();
      }
    });
    this._renderer.dispose();
  }
}
