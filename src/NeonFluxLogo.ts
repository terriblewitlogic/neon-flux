// ─── NeonFluxLogo ────────────────────────────────────────────────────────────
// Self-contained Three.js renderer for the animated NEON / FLUX 3D title.
// Ported from the user-supplied neon-flux-3d.html reference, adapted for
// Three.js ^0.176 module syntax.  No OrbitControls — pure auto-animation.

import * as THREE from 'three';

// ─── Metrics (match reference HTML exactly) ──────────────────────────────────
const LH   = 4.0;   // letter height
const LW   = 3.0;   // letter width
const GAP  = 0.55;  // gap between letters
const ROWG = 0.6;   // gap between rows
const BARW = LW * 0.24;
const BARH = LH * 0.16;
const CH   = LH * 0.11;
const DEPTH = 0.55;

const CYAN = 0x00ccff;
const MAG  = 0xff1199;

// ─── Shape helpers ───────────────────────────────────────────────────────────
function _shape(pts: [number, number][]): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}

// ─── Letter shapes ───────────────────────────────────────────────────────────
function _shapesN(): THREE.Shape[] {
  const x0 = 0, x1 = LW, b = 0, t = LH;
  const pt = t - LH * 0.1; // inner tip of left bar — 10% below top
  const pb = b + LH * 0.1; // inner tip of right bar — 10% above bottom
  return [_shape([
    [x0, t - CH], [x0 + CH, t],
    [x0 + BARW * 2.1, t],          // hat stays flat at top
    [x1 - BARW, pb], [x1 - BARW, t],
    [x1, t],
    [x1, b + CH], [x1 - CH, b],
    [x1 - BARW * 2.1, b],          // foot stays flat at bottom
    [x0 + BARW, pt], [x0 + BARW, b],
    [x0, b],
  ])];
}

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

function _shapesF(): THREE.Shape[] {
  const x0 = 0, x1 = LW, b = 0, t = LH, m = LH / 2 + LH * 0.06;
  return [_shape([
    [x0, t - CH], [x0 + CH, t],
    [x1, t], [x1, t - BARH],
    [x0 + BARW, t - BARH],
    [x0 + BARW, m + BARH * 0.5],
    [x1 - LW * 0.15, m + BARH * 0.5],
    [x1 - LW * 0.15, m - BARH * 0.5],
    [x0 + BARW, m - BARH * 0.5],
    [x0 + BARW, b],
    [x0, b],
  ])];
}

function _shapesL(): THREE.Shape[] {
  const x0 = 0, x1 = LW, b = 0, t = LH;
  return [_shape([
    [x0, t - CH], [x0 + CH, t],
    [x0 + BARW, t],
    [x0 + BARW, b + BARH],
    [x1, b + BARH],
    [x1, b + CH], [x1 - CH, b],
    [x0, b],
  ])];
}

function _shapesU(): THREE.Shape[] {
  const x0 = 0, x1 = LW, b = 0, t = LH;
  const ich = CH * 0.7;
  return [_shape([
    [x0, t],
    [x0 + BARW, t],
    [x0 + BARW, b + BARH + ich],
    [x0 + BARW + ich, b + BARH],
    [x1 - BARW - ich, b + BARH],
    [x1 - BARW, b + BARH + ich],
    [x1 - BARW, t],
    [x1, t],
    [x1, b + CH],
    [x1 - CH, b],
    [x0 + CH, b],
    [x0, b + CH],
  ])];
}

function _shapesX(): THREE.Shape[] {
  const x0 = 0, x1 = LW, b = 0, t = LH;
  const sTB   = (LW - 2 * BARW) / (2 * (LW - BARW));
  const yTop  = t - sTB * (LH - CH);
  const yBot  = b + sTB * (LH - CH);
  const sLR   = (LH - 2 * CH) / (2 * (LH - CH));
  const xLeft  = sLR * (LW - BARW);
  const xRight = LW - xLeft;
  return [_shape([
    [x0, t - CH], [x0 + CH, t],
    [x0 + BARW, t],
    [LW / 2, yTop],
    [x1 - BARW, t],
    [x1 - CH, t], [x1, t - CH],
    [xRight, LH / 2],
    [x1, b + CH], [x1 - CH, b],
    [x1 - BARW, b],
    [LW / 2, yBot],
    [x0 + BARW, b],
    [x0 + CH, b], [x0, b + CH],
    [xLeft, LH / 2],
  ])];
}

// ─── Extrude settings ────────────────────────────────────────────────────────
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
  const edges  = new THREE.EdgesGeometry(geo, 20);
  const mat    = new THREE.LineBasicMaterial({ color });
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
  const stride  = LW + GAP;
  const totalW  = stride * (letterFns.length - 1);
  letterFns.forEach((fn, i) => {
    const mesh = _buildLetter(fn(), color);
    mesh.position.set(-totalW / 2 + i * stride, rowY, 0);
    parent.add(mesh);
  });
}

// ─── NeonFluxLogo class ──────────────────────────────────────────────────────
// Pass word='neon' or word='flux' to render a single row on its own canvas.
// Default ('both') renders both rows on one canvas (legacy behaviour).

export class NeonFluxLogo {
  private readonly _word: 'neon' | 'flux' | 'both';
  private _renderer:  THREE.WebGLRenderer;
  private _scene:     THREE.Scene;
  private _camera:    THREE.PerspectiveCamera;
  private _root:      THREE.Group;
  private _cyanLight: THREE.PointLight | null = null;
  private _magLight:  THREE.PointLight | null = null;
  private _raf = 0;
  private _t   = 0;

  // Per-letter materials collected after construction for color cycling
  private _neonMats: THREE.LineBasicMaterial[] = [];
  private _fluxMats: THREE.LineBasicMaterial[] = [];
  private _neonColor = new THREE.Color();
  private _fluxColor = new THREE.Color();

  /** The canvas element — append this to your container. */
  readonly canvas: HTMLCanvasElement;

  constructor(word: 'neon' | 'flux' | 'both' = 'both') {
    this._word = word;

    this._renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = this._renderer.domElement;

    // Each word gets its own CSS class for colour-matched drop-shadow
    this.canvas.className =
      word === 'neon' ? 'neon-logo-canvas' :
      word === 'flux' ? 'flux-logo-canvas' :
      'neon-flux-canvas';

    this._scene = new THREE.Scene();

    // Single-word mode: camera closer so one row fills the canvas.
    // Narrow 20° FOV (~telephoto) avoids perspective distortion on end letters.
    // baseZ is scaled from original 38°→20° FOV change (factor ≈1.95).
    const baseZ = word === 'both' ? 47 : 18;
    const aspect = word === 'both' ? 2.0 : 3.5;
    this._camera = new THREE.PerspectiveCamera(20, aspect, 0.1, 300);
    this._camera.position.set(0, 0, baseZ);

    // Only create the light that matches this word
    if (word === 'neon' || word === 'both') {
      this._cyanLight = new THREE.PointLight(0x55ddff, 2.0, 40, 2);
      this._cyanLight.position.set(-6, 6, 6);
      this._scene.add(this._cyanLight);
    }
    if (word === 'flux' || word === 'both') {
      this._magLight = new THREE.PointLight(0xff1199, 2.0, 40, 2);
      this._magLight.position.set(6, -6, 6);
      this._scene.add(this._magLight);
    }

    // Letters — single-word mode places the row at y=0
    this._root = new THREE.Group();
    this._scene.add(this._root);

    if (word === 'neon') {
      _placeWord([_shapesN, _shapesE, _shapesO, _shapesN], CYAN, 0, this._root);
    } else if (word === 'flux') {
      _placeWord([_shapesF, _shapesL, _shapesU, _shapesX], MAG, 0, this._root);
    } else {
      const rowSpacing = LH + ROWG;
      _placeWord([_shapesN, _shapesE, _shapesO, _shapesN], CYAN,  rowSpacing / 2,  this._root);
      _placeWord([_shapesF, _shapesL, _shapesU, _shapesX], MAG,  -rowSpacing / 2, this._root);
    }

    // Collect materials for color cycling
    this._root.children.forEach((child, idx) => {
      child.traverse(obj => {
        const ls = obj as THREE.LineSegments;
        if (ls.isLineSegments) {
          const mat = ls.material as THREE.LineBasicMaterial;
          if (word === 'flux')              this._fluxMats.push(mat);
          else if (word === 'neon')         this._neonMats.push(mat);
          else if (idx < 4)                 this._neonMats.push(mat);
          else                              this._fluxMats.push(mat);
        }
      });
    });

    // Default size — caller should call resize() after inserting into the DOM
    const defW = word === 'both' ? 480 : 420;
    const defH = word === 'both' ? 220 : 120;
    this._setSize(defW, defH);
  }

  private _setSize(w: number, h: number): void {
    this._renderer.setSize(w, h, false);
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
  }

  /** Call whenever the container's pixel dimensions change. */
  resize(w: number, h: number): void {
    this._setSize(w, h);
  }

  /** Move camera closer (zoom > 1) or farther (zoom < 1). */
  setCameraZoom(zoom: number): void {
    const baseZ = this._word === 'both' ? 47 : 18;
    this._camera.position.z = baseZ / zoom;
    this._camera.updateProjectionMatrix();
  }

  /** Render one frame at the given time value (used for external sync loops). */
  renderAtTime(t: number): void {
    this._t = t;
    this._doFrame();
  }

  /** Self-driven loop — use when only one logo is on screen (e.g. game-over). */
  start(): void {
    if (this._raf) return;
    const tick = () => {
      this._raf = requestAnimationFrame(tick);
      this._t += 0.008;
      this._doFrame();
    };
    tick();
  }

  private _doFrame(): void {
    this._root.rotation.y = Math.sin(this._t) * 0.25;
    this._root.rotation.x = Math.sin(this._t * 0.7) * 0.06;
    this._root.rotation.z = Math.sin(this._t * 0.5) * 0.08;
    if (this._cyanLight) {
      this._cyanLight.position.x = Math.cos(this._t * 0.6) * 8 - 2;
      this._cyanLight.position.y = Math.sin(this._t * 0.4) * 4 + 3;
    }
    if (this._magLight) {
      this._magLight.position.x = Math.cos(this._t * 0.6 + Math.PI) * 8 + 2;
      this._magLight.position.y = Math.sin(this._t * 0.4 + Math.PI) * 4 - 3;
    }
    if (this._neonMats.length > 0) {
      this._neonColor.setHSL(0.54 + Math.sin(this._t * 0.28) * 0.05, 1.0, 0.60);
      for (const m of this._neonMats) m.color.copy(this._neonColor);
      if (this._cyanLight) this._cyanLight.color.copy(this._neonColor);
    }
    if (this._fluxMats.length > 0) {
      this._fluxColor.setHSL(0.91 + Math.sin(this._t * 0.28 + Math.PI) * 0.09, 1.0, 0.68);
      for (const m of this._fluxMats) m.color.copy(this._fluxColor);
      if (this._magLight) this._magLight.color.copy(this._fluxColor);
    }
    this._renderer.render(this._scene, this._camera);
  }

  stop(): void {
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
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
