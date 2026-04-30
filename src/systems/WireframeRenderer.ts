import * as THREE from 'three';
import { ShipModel, Vec3Data, EdgeData } from '../data/ShipModels';

// ─── WireframeRenderer ─────────────────────────────────────────────────────────
// Builds a THREE.LineSegments object from a ShipModel definition.
// Supports vertex morphing (setMorphTarget / setMorph) for combat-form animations.

export class WireframeRenderer {
  readonly group: THREE.Group;
  private lineSegments: THREE.LineSegments;
  private mat: THREE.LineBasicMaterial;

  // Morph support
  private _posAttr:      THREE.Float32BufferAttribute;
  private _origPos:      Float32Array;
  private _morphPos:     Float32Array | null = null;
  private _scale:        number;
  private _edges:        EdgeData[];

  // Engine glow: small point lights at engine vert positions
  private enginePoints: THREE.Mesh[] = [];
  private enginePositions: THREE.Vector3[] = [];

  constructor(model: ShipModel, color: THREE.Color, emissiveScale = 1.0) {
    this.group  = new THREE.Group();
    this._scale = model.scale;
    this._edges = model.edges;
    this.mat = new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.95,
      toneMapped: false,
    });

    const positions: number[] = [];
    const sc = model.scale;

    for (const edge of model.edges) {
      const v1 = model.vertices[edge.v1];
      const v2 = model.vertices[edge.v2];
      positions.push(v1.x * sc, v1.y * sc, v1.z * sc);
      positions.push(v2.x * sc, v2.y * sc, v2.z * sc);
    }

    const floatBuf   = new Float32Array(positions);
    this._origPos    = floatBuf.slice();
    this._posAttr    = new THREE.Float32BufferAttribute(floatBuf, 3);
    this._posAttr.setUsage(THREE.DynamicDrawUsage);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', this._posAttr);
    this.lineSegments = new THREE.LineSegments(geo, this.mat);
    this.group.add(this.lineSegments);

    // Small glowing sphere at each engine vent
    const engGeo = new THREE.SphereGeometry(0.22, 4, 4);
    const engMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(emissiveScale), toneMapped: false });

    for (const vi of model.engineVerts) {
      const v = model.vertices[vi];
      const ep = new THREE.Vector3(v.x * sc, v.y * sc, v.z * sc);
      this.enginePositions.push(ep);
      const m = new THREE.Mesh(engGeo, engMat);
      m.position.copy(ep);
      this.enginePoints.push(m);
      this.group.add(m);
    }
  }

  /** Update line color (call each frame during color cycling) */
  setColor(color: THREE.Color): void {
    this.mat.color.copy(color);
    for (const ep of this.enginePoints) {
      (ep.material as THREE.MeshBasicMaterial).color.copy(color);
    }
  }

  /** Pulse engine glow intensity with thrust value (0–1) */
  setEngineIntensity(thrust: number): void {
    const s = 0.8 + thrust * 1.4;
    for (const ep of this.enginePoints) {
      ep.scale.setScalar(s);
    }
  }

  /** Flash the ship (damage hit indicator) */
  flash(color: THREE.Color): void {
    this.mat.color.copy(color);
  }

  /** Set the combat-form vertex positions for morphing (must match original vertex count) */
  setMorphTarget(morphVerts: Vec3Data[]): void {
    const sc  = this._scale;
    const buf = new Float32Array(this._edges.length * 6);
    let i = 0;
    for (const edge of this._edges) {
      const v1 = morphVerts[edge.v1];
      const v2 = morphVerts[edge.v2];
      buf[i++] = v1.x * sc;  buf[i++] = v1.y * sc;  buf[i++] = v1.z * sc;
      buf[i++] = v2.x * sc;  buf[i++] = v2.y * sc;  buf[i++] = v2.z * sc;
    }
    this._morphPos = buf;
  }

  /** Blend geometry toward combat form (t=0: original shape, t=1: combat form) */
  setMorph(t: number): void {
    if (!this._morphPos) return;
    const arr = this._posAttr.array as Float32Array;
    for (let i = 0; i < arr.length; i++) {
      arr[i] = this._origPos[i] + (this._morphPos[i] - this._origPos[i]) * t;
    }
    this._posAttr.needsUpdate = true;
  }

  /** Reset geometry back to its original shape */
  resetMorph(): void {
    const arr = this._posAttr.array as Float32Array;
    arr.set(this._origPos);
    this._posAttr.needsUpdate = true;
    this._morphPos = null;
  }

  addToScene(scene: THREE.Scene): void {
    scene.add(this.group);
  }

  removeFromScene(scene: THREE.Scene): void {
    scene.remove(this.group);
  }
}

// ─── LaserBolt visual ─────────────────────────────────────────────────────────
export class LaserBoltMesh {
  readonly mesh: THREE.LineSegments;
  private mat: THREE.LineBasicMaterial;

  constructor(color: THREE.Color, length = 6) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      0, 0, length,
    ], 3));
    this.mat = new THREE.LineBasicMaterial({ color });
    this.mesh = new THREE.LineSegments(geo, this.mat);
  }

  setColor(color: THREE.Color): void {
    this.mat.color.copy(color);
  }
}
