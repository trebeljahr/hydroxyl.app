/**
 * The 3D view's renderer: three.js, orbit controls, and an off-screen render
 * for the PNG export (decision 232 says why three.js and not a molecular
 * viewer library).
 *
 * Loaded with `import()` by the 3D panel, so three.js is fetched the first
 * time the view opens and never by a session that does not open it.
 *
 * WHAT IS DRAWN is `primitives.ts`'s, so the modes are decided and tested
 * without WebGL; this file only turns spheres and rods into meshes. One
 * shared unit sphere and one unit cylinder are scaled per instance, and one
 * material per colour is shared, so a 300-atom conformer is a few hundred
 * meshes over two geometries.
 *
 * THE BACKGROUND IS WHITE in both themes, as the 2D canvas's ground is: the
 * view is a figure preview, and the PNG is exported on white.
 */

import {
  AmbientLight,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { ConformerResult } from "@/lib/conformer";
import { RASTER_BACKGROUND } from "@/lib/export/figure";

import { primitives, type ThreeDMode } from "./primitives";

type Conformer = Extract<ConformerResult, { ok: true }>;

const FIELD_OF_VIEW = 30;
const UP = new Vector3(0, 1, 0);

export class MoleculeViewer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, 0.1, 1000);
  private readonly controls: OrbitControls;
  private readonly sphere = new SphereGeometry(1, 32, 24);
  private readonly cylinder = new CylinderGeometry(1, 1, 1, 20, 1, true);
  private readonly materials = new Map<string, MeshStandardMaterial>();
  private readonly resizeObserver: ResizeObserver;
  private model: Group | undefined;
  private conformer: Conformer | undefined;
  private mode: ThreeDMode = "ball-and-stick";
  private pendingFrame = 0;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    host.appendChild(this.renderer.domElement);

    this.scene.background = new Color(RASTER_BACKGROUND);
    this.scene.add(new AmbientLight(0xffffff, 0.9));
    // A key light that rides with the camera, so the lit side is always the
    // side being looked at, however the molecule is turned.
    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(1, 1.2, 2);
    this.camera.add(key);
    this.scene.add(this.camera);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.addEventListener("change", () => this.requestRender());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }

  /**
   * Show `conformer`. `refit` frames it from the front; without it the
   * camera keeps the direction it looks from, so an edit does not throw away
   * the angle the user turned the molecule to, and only its distance changes
   * so the new structure fits.
   */
  setStructure(conformer: Conformer | undefined, refit: boolean): void {
    this.conformer = conformer;
    this.rebuild();
    if (refit) this.fit();
    else this.refitKeepingAngle();
  }

  setMode(mode: ThreeDMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.rebuild();
    // Space-fill is bigger than ball and stick by a van der Waals radius.
    this.refitKeepingAngle();
  }

  /** Frame the structure from the front (+z), as the 2D drawing faces. */
  fit(): void {
    this.camera.up.copy(UP);
    this.frameFrom(new Vector3(0, 0, 1));
  }

  private refitKeepingAngle(): void {
    const direction = new Vector3().subVectors(this.camera.position, this.controls.target);
    if (direction.lengthSq() === 0) direction.set(0, 0, 1);
    this.frameFrom(direction.normalize());
  }

  /** Look at the origin from `direction`, far enough back to see it all. */
  private frameFrom(direction: Vector3): void {
    const extent = this.model === undefined ? 5 : this.extent();
    // The narrower of the two fields of view decides: a wide panel is
    // limited by its height, a tall one by its width.
    const vertical = (FIELD_OF_VIEW * Math.PI) / 180;
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * this.camera.aspect);
    const distance = extent / Math.sin(Math.min(vertical, horizontal) / 2);
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(direction).multiplyScalar(distance * 1.05);
    this.camera.near = Math.max(0.1, distance / 100);
    this.camera.far = distance * 10;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.requestRender();
  }

  /** Width / height of the view as it is on screen. */
  aspect(): number {
    const { clientWidth, clientHeight } = this.host;
    return clientHeight > 0 ? clientWidth / clientHeight : 1;
  }

  /**
   * The current view rendered at exactly `widthPx` × `heightPx` as PNG
   * bytes, on `background` (a colour) or transparent (`null`), following the
   * export dialog's PNG background choice. A separate renderer, so the size and pixel ratio of the one
   * on screen are never touched. Throws with a sentence if the GPU cannot
   * hold the size.
   */
  async renderPng(widthPx: number, heightPx: number, background: string | null): Promise<Uint8Array> {
    const canvas = document.createElement("canvas");
    const renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: background === null,
      preserveDrawingBuffer: true,
    });
    const onScreen = this.scene.background;
    try {
      const gl = renderer.getContext();
      const maxRenderbuffer = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number;
      const maxViewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
      const limit = Math.min(maxRenderbuffer, maxViewport[0] ?? maxRenderbuffer, maxViewport[1] ?? maxRenderbuffer);
      if (widthPx > limit || heightPx > limit) {
        throw new Error(
          `This graphics card renders at most ${limit} px on a side; the 3D PNG needs ${widthPx} × ${heightPx} px. Choose 300 dpi or a narrower width.`,
        );
      }
      renderer.setPixelRatio(1);
      renderer.setSize(widthPx, heightPx, false);
      const camera = this.camera.clone();
      camera.aspect = widthPx / heightPx;
      camera.updateProjectionMatrix();
      this.scene.background = background === null ? null : new Color(background);
      renderer.setClearColor(0x000000, 0);
      renderer.render(this.scene, camera);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (blob === null) throw new Error("This browser could not encode the 3D view as a PNG.");
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      this.scene.background = onScreen;
      renderer.dispose();
      renderer.forceContextLoss();
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.pendingFrame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.clearModel();
    this.sphere.dispose();
    this.cylinder.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private extent(): number {
    return this.conformer === undefined ? 5 : Math.max(2, primitives(this.conformer, this.mode).extent);
  }

  private material(color: string): MeshStandardMaterial {
    let material = this.materials.get(color);
    if (material === undefined) {
      material = new MeshStandardMaterial({ color, roughness: 0.45, metalness: 0 });
      this.materials.set(color, material);
    }
    return material;
  }

  private clearModel(): void {
    if (this.model === undefined) return;
    this.scene.remove(this.model);
    this.model = undefined;
  }

  private rebuild(): void {
    this.clearModel();
    if (this.conformer === undefined) return;
    const group = new Group();
    const { spheres, rods } = primitives(this.conformer, this.mode);
    for (const sphere of spheres) {
      const mesh = new Mesh(this.sphere, this.material(sphere.color));
      mesh.position.set(...sphere.center);
      mesh.scale.setScalar(sphere.radius);
      group.add(mesh);
    }
    const from = new Vector3();
    const to = new Vector3();
    const direction = new Vector3();
    for (const rod of rods) {
      from.set(...rod.from);
      to.set(...rod.to);
      direction.subVectors(to, from);
      const length = direction.length();
      if (length === 0) continue;
      const mesh = new Mesh(this.cylinder, this.material(rod.color));
      mesh.position.addVectors(from, to).multiplyScalar(0.5);
      mesh.quaternion.copy(new Quaternion().setFromUnitVectors(UP, direction.normalize()));
      mesh.scale.set(rod.radius, length, rod.radius);
      group.add(mesh);
    }
    this.model = group;
    this.scene.add(group);
  }

  private resize(): void {
    const { clientWidth, clientHeight } = this.host;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  private requestRender(): void {
    cancelAnimationFrame(this.pendingFrame);
    this.pendingFrame = requestAnimationFrame(() => this.renderer.render(this.scene, this.camera));
  }
}
