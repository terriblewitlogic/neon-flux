import * as THREE from 'three';
import { VISUAL, RAIL } from '../config';

// ─── StarField ─────────────────────────────────────────────────────────────────
// Stars laid out in an annular cylinder (hollow centre to avoid perspective
// crowding).  Each frame their relative-Z drifts toward the camera and they
// fade in from black — appearing out of the void as they approach.

const STAR_DEPTH   = 1400;   // total depth of the cylinder (units)
const STAR_RADIUS  = 380;    // outer radius of cylinder
const STAR_RMIN    = 100;    // inner hollow radius — keeps centre clear
const PASS_Z       =  55;    // how far past camera before wrapping

// Distance-fade window (relative Z: 0 = at camera, negative = ahead)
const FADE_START_Z = -900;   // stars begin appearing here
const FADE_END_Z   =  -80;   // fully bright here

export class StarField {
  readonly mesh: THREE.Points;
  private positions:  Float32Array;
  private colors:     Float32Array;  // live RGB (written every frame)
  private baseColors: Float32Array;  // original RGB at full brightness
  private count: number;

  constructor() {
    this.count      = VISUAL.STAR_COUNT;
    this.positions  = new Float32Array(this.count * 3);
    this.colors     = new Float32Array(this.count * 3);
    this.baseColors = new Float32Array(this.count * 3);

    for (let i = 0; i < this.count; i++) {
      const angle = Math.random() * Math.PI * 2;
      // Uniform area distribution in an annular ring (hollow centre)
      const r = Math.sqrt(
        STAR_RMIN * STAR_RMIN +
        Math.random() * (STAR_RADIUS * STAR_RADIUS - STAR_RMIN * STAR_RMIN),
      );
      this.positions[i * 3]     = Math.cos(angle) * r;
      this.positions[i * 3 + 1] = Math.sin(angle) * r * 0.65;   // squished Y
      this.positions[i * 3 + 2] = -(Math.random() * STAR_DEPTH); // spread ahead

      // Base colour: blue-white, warm, or plain white
      const t = Math.random();
      let cr: number, cg: number, cb: number;
      if (t < 0.15) {
        cr = 0.7;  cg = 0.85; cb = 1.0;  // blue-white
      } else if (t < 0.25) {
        cr = 1.0;  cg = 0.9;  cb = 0.6;  // warm
      } else {
        const b = 0.4 + Math.random() * 0.6;
        cr = b; cg = b; cb = b;           // neutral white
      }
      this.baseColors[i * 3]     = cr;
      this.baseColors[i * 3 + 1] = cg;
      this.baseColors[i * 3 + 2] = cb;
      // Start invisible — scroll() fills in real values on first frame
      this.colors[i * 3] = 0; this.colors[i * 3 + 1] = 0; this.colors[i * 3 + 2] = 0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(this.colors, 3));

    const mat = new THREE.PointsMaterial({
      size:            2.0,
      vertexColors:    true,
      sizeAttenuation: false,
      transparent:     true,
      opacity:         1.0,
      depthWrite:      false,
    });

    this.mesh = new THREE.Points(geo, mat);
  }

  /**
   * Call every frame.  Stars drift +Z at rail speed (wrapping) and their
   * colour is scaled by how close they are — dark far ahead, bright nearby.
   */
  scroll(playerZ: number, dt: number): void {
    const speed     = RAIL.SPEED;
    const fadeRange = FADE_END_Z - FADE_START_Z; // positive

    for (let i = 0; i < this.count; i++) {
      const iz = i * 3 + 2;

      // Advance toward camera
      this.positions[iz] += speed * dt;
      if (this.positions[iz] > PASS_Z) {
        this.positions[iz] -= STAR_DEPTH + PASS_Z;
      }

      // Fade: 0 = invisible (far), 1 = full brightness (near)
      const z = this.positions[iz];
      let fade: number;
      if (z <= FADE_START_Z) {
        fade = 0;
      } else if (z >= FADE_END_Z) {
        fade = 1;
      } else {
        fade = (z - FADE_START_Z) / fadeRange;
        fade = fade * fade; // ease-in curve for smoother appearance
      }

      this.colors[i * 3]     = this.baseColors[i * 3]     * fade;
      this.colors[i * 3 + 1] = this.baseColors[i * 3 + 1] * fade;
      this.colors[i * 3 + 2] = this.baseColors[i * 3 + 2] * fade;
    }

    (this.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.mesh.geometry.attributes.color    as THREE.BufferAttribute).needsUpdate = true;

    // Anchor mesh at player world Z; star positions are relative Z offsets
    this.mesh.position.set(0, 0, playerZ);
  }

  /** Legacy stub */
  followCamera(_cameraPos: THREE.Vector3): void {}

  addToScene(scene: THREE.Scene): void {
    scene.add(this.mesh);
  }
}
