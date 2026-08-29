import * as THREE from "three";
import gsap from "gsap";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildEmblemGeometry } from "./emblem.js";
import { buildTunnel } from "./tunnel.js";
import { loadCarModel, CAR_AIM } from "./car.js";

const RED = 0xd81324;

export class World {
  constructor(canvas, { onLoadProgress } = {}) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();
    this.pointer = new THREE.Vector2();
    this.state = "logo";
    this.ready = false;
    this.car = null;
    // 0 = aim down the direction of travel, 1 = aim at the car. Tweened by
    // the transition timeline so the two crossfade.
    this._revealBlend = 0;
    // Where the reveal camera points; derived from the car placement constants.
    this._carAim = new THREE.Vector3(CAR_AIM.x, CAR_AIM.y, CAR_AIM.z);
    this._slowFrames = 0;
    this._degraded = false;

    this._initRenderer();
    this._initScene();
    this._initLogo();
    this._bindEvents();

    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);

    // Defer the expensive, not-immediately-visible setup (env map prefiltering,
    // tunnel geometry, the car model) so first paint of the spinning logo
    // isn't blocked by it. The car is the only real download, so it drives
    // the reported progress.
    setTimeout(() => {
      this._initEnvironment();
      this._initTunnel();
      onLoadProgress?.(0.12);

      loadCarModel({ onProgress: (p) => onLoadProgress?.(0.12 + p * 0.83) })
        .then(({ group, noseZ, tailZ }) => {
          group.visible = false;
          this.scene.add(group);
          this.car = { group, noseZ, tailZ };
        })
        .catch((err) => {
          console.error("BMW model failed to load, continuing without it", err);
        })
        .finally(() => {
          this._warmUp();
          this.ready = true;
          onLoadProgress?.(1);
        });
    }, 0);
  }

  _initRenderer() {
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    // Capped at 1.5 rather than 2. Everything here is fill-rate bound — the
    // bloom pass alone resolves the full frame several times — so on a retina
    // display a ratio of 2 costs ~1.8x the pixels of 1.5 for a difference
    // that is essentially invisible at this contrast. This is the single
    // biggest framerate lever on phones and tablets.
    this._maxPixelRatio = 1.5;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, this._maxPixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    // Real-time shadows are off entirely: the car was the only caster and it
    // now uses a baked contact shadow, so the shadow pass would re-render the
    // scene each frame to produce nothing.
    renderer.shadowMap.enabled = false;
    this.renderer = renderer;

    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      600
    );
    this.camera.position.set(0, 0.4, 15);

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(new THREE.Scene(), this.camera)); // placeholder, fixed after scene init
    // Bloom runs at half the frame's resolution. It is a blur — the result is
    // indistinguishable from full-res here, at a quarter of the fill cost.
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2),
      0.42,
      0.5,
      0.95
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  _initScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050506);
    scene.fog = new THREE.FogExp2(0x050506, 0.016);
    this.scene = scene;

    // fix the RenderPass created before the scene existed
    this.composer.passes[0] = new RenderPass(scene, this.camera);

    const key = new THREE.DirectionalLight(0xffffff, 1.3);
    key.position.set(4, 6, 8);
    scene.add(key);

    // Kept tight to the logo's own footprint — at full range these were
    // tinting the car's paint and carbon hood with stray red/blue highlights.
    const rim = new THREE.PointLight(RED, 3.2, 9);
    rim.position.set(-6, 2, -4);
    scene.add(rim);

    const fillBlue = new THREE.PointLight(0x3a6bff, 1.3, 8);
    fillBlue.position.set(6, -2, 4);
    scene.add(fillBlue);

    scene.add(new THREE.AmbientLight(0x30323c, 0.4));

    // Key light over the car-reveal area. Kept modest — combined with the
    // (also-directional, no-falloff) `key` light above, this was blowing out
    // the paint's highlights to near-white and reading as a color shift
    // rather than a lit red.
    const carKey = new THREE.DirectionalLight(0xfff4e0, 1.35);
    carKey.position.set(12, 22, -14);
    const carKeyTarget = new THREE.Object3D();
    carKeyTarget.position.set(0, 0, -25);
    scene.add(carKeyTarget);
    carKey.target = carKeyTarget;
    scene.add(carKey);

    // A light that rides with the camera — keeps the tunnel interior readable
    // as it travels, without needing distant fixed lights to overexpose the
    // near geometry it passes close by.
    const travelLight = new THREE.PointLight(0xfff2e6, 1.1, 22, 2);
    this.camera.add(travelLight);
    scene.add(this.camera);

    const floorGeo = new THREE.PlaneGeometry(120, 400);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x08090b,
      metalness: 0.5,
      roughness: 0.55,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -5.4;
    scene.add(floor);

    this._initParticles();
  }

  _initEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = env;
    pmrem.dispose();
  }

  _initParticles() {
    const count = 260;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 60;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 30;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 220 - 20;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xaab3c2,
      size: 0.05,
      transparent: true,
      opacity: 0.5,
      sizeAttenuation: true,
    });
    this.particles = new THREE.Points(geo, mat);
    this.scene.add(this.particles);
  }

  _initLogo() {
    const geometry = buildEmblemGeometry({ depth: 9 });
    const material = new THREE.MeshPhysicalMaterial({
      color: RED,
      metalness: 0.55,
      roughness: 0.28,
      clearcoat: 1,
      clearcoatRoughness: 0.18,
      envMapIntensity: 1.3,
      emissive: RED,
      emissiveIntensity: 0.4,
    });
    this.logoMaterial = material;

    const emblem = new THREE.Mesh(geometry, material);
    this.logoGroup = new THREE.Group();
    this.logoGroup.add(emblem);
    this.scene.add(this.logoGroup);

    const spot = new THREE.SpotLight(0xffffff, 3.4, 40, Math.PI / 6, 0.5, 1);
    spot.position.set(0, 8, 10);
    spot.target = this.logoGroup;
    this.scene.add(spot);
  }

  /**
   * Renders one full frame with the car and tunnel showing, while the loading
   * overlay still covers the canvas.
   *
   * Everything in the cinematic is hidden until its own phase, and
   * WebGLRenderer.compile() walks the scene with traverseVisible — so a
   * pre-compile while they are hidden silently does nothing, and the cost of
   * compiling ~90 shader programs and uploading the car's geometry all landed
   * on the first frames after ENTER instead. The transition timeline is locked
   * to wall-clock, so that stall used to eat a chunk of the cinematic outright.
   *
   * Drawing them once here pays that cost behind the loading screen.
   */
  _warmUp() {
    const tunnelWas = this.tunnel ? this.tunnel.root.visible : null;
    const carWas = this.car ? this.car.group.visible : null;

    if (this.tunnel) this.tunnel.root.visible = true;
    if (this.car) this.car.group.visible = true;

    // The tunnel sits far down -Z and would be frustum-culled from where the
    // camera stands during the logo, which would leave exactly the shaders we
    // are trying to warm up uncompiled. Force it to draw for this one frame.
    const culled = [];
    if (this.tunnel) {
      this.tunnel.root.traverse((o) => {
        if (o.isMesh || o.isInstancedMesh) {
          culled.push([o, o.frustumCulled]);
          o.frustumCulled = false;
        }
      });
    }

    try {
      // Through the composer, so the post-processing passes warm up too.
      this.composer.render();
    } catch (err) {
      console.error("warm-up render failed", err);
    }

    for (const [o, was] of culled) o.frustumCulled = was;
    if (this.tunnel) this.tunnel.root.visible = tunnelWas;
    if (this.car) this.car.group.visible = carWas;
  }

  _initTunnel() {
    const tunnel = buildTunnel();
    this.tunnel = tunnel;
    this.scene.add(tunnel.root);

    // Pre-compile every tunnel shader now, while the logo is idling, so the
    // click → flythrough doesn't stall on first-time shader compilation.
    this.renderer.compile(this.scene, this.camera);
    tunnel.root.visible = false;
  }

  _bindEvents() {
    window.addEventListener("resize", () => this._onResize());
    window.addEventListener("pointermove", (e) => {
      this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    });
  }

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w / 2, h / 2);
  }

  /** Kicks off the click → flythrough → hero-reveal cinematic. */
  playTransition({ onIntroFade, onComplete, flashEl } = {}) {
    if (this.state !== "logo" || !this.ready) return;
    this.state = "transition";
    // The tunnel stays hidden until we punch through the grille, and the car
    // is hidden the moment we're inside. Only one of the two is ever drawn:
    // rendering both at once put the reveal at ~815 draw calls, most of them
    // tunnel geometry sitting unseen behind the car.
    this.tunnel.root.visible = false;
    if (this.car) this.car.group.visible = true;

    const cam = this.camera.position;
    const proxy = { roll: 0 };
    const tl = gsap.timeline({
      defaults: { ease: "power2.inOut" },
      onComplete: () => {
        this.state = "site";
        onComplete?.();
      },
    });

    onIntroFade?.();

    // Phase A — punch in on the emblem, then dissolve it as the real car appears.
    tl.to(this.logoGroup.scale, { x: 1.35, y: 1.35, z: 1.35, duration: 0.5, ease: "power1.in" }, 0);
    tl.to(cam, { z: 3.2, duration: 0.9, ease: "power2.in" }, 0);
    tl.to(this.camera, { fov: 34, duration: 0.9, onUpdate: () => this.camera.updateProjectionMatrix() }, 0);
    tl.to(this.logoMaterial, { emissiveIntensity: 2.4, duration: 0.36, ease: "power2.in" }, 0.5);
    tl.to(this.logoGroup, { visible: false, duration: 0.01 }, 0.86);

    // Phase A2 — the M3 reveal: a sweeping hero pass that closes all the way
    // in on the grille (not just toward the car), so the punch-through that
    // follows actually crosses through it rather than cutting away early.
    // Camera tracks the car's centerline rather than looking dead ahead, so
    // the sweep reads as an orbit instead of a sideways slide.
    tl.to(this, { _revealBlend: 1, duration: 0.45, ease: "sine.inOut" }, 0.82);
    tl.to(cam, { z: -9, duration: 1.7, ease: "power1.inOut" }, 0.82);
    tl.to(cam, { x: -2.6, duration: 0.9, ease: "sine.inOut" }, 0.82);
    tl.to(cam, { x: 0.6, duration: 0.8, ease: "sine.inOut" }, 1.72);
    tl.to(cam, { y: 1.9, duration: 0.9, ease: "sine.inOut" }, 0.82);
    tl.to(cam, { y: 1.1, duration: 0.8, ease: "sine.inOut" }, 1.72);
    tl.to(this.camera, { fov: 42, duration: 0.9, ease: "sine.inOut" }, 0.82);
    tl.to(this.camera, { fov: 34, duration: 0.8, ease: "power1.in" }, 1.72);

    // Phase B — punch through the grille: the camera actually crosses the
    // grille plane (z = -15, the car's nose) partway through this tween —
    // the flash is timed to peak right at that crossing, then the car is
    // hidden once we're already past it, so the cut lands mid-flash instead
    // of before we've reached the car.
    // Unwind the aim back to straight-ahead just before the punch-through, so
    // the camera is already pointed down the tunnel when the flash cuts.
    const stages = this.tunnel.stages;

    tl.to(this, { _revealBlend: 0, duration: 0.4, ease: "sine.inOut" }, 2.3);
    // Land right at the mouth of the radiator, so the fins are already filling
    // the frame as the flash clears.
    tl.to(cam, { z: stages.radiatorStartZ, duration: 0.85, ease: "power2.in" }, 2.45);
    tl.to(this.camera, { fov: 54, duration: 0.85, ease: "power1.in" }, 2.45);
    if (flashEl) {
      tl.to(flashEl, { opacity: 1, duration: 0.2, ease: "power2.in" }, 2.53);
      tl.to(flashEl, { opacity: 0, duration: 0.5, ease: "power1.out" }, 2.73);
    }
    // Swap car out for tunnel at the peak of the flash, so the hand-off is
    // hidden and only one of the two is ever being drawn.
    tl.call(() => {
      this.tunnel.root.visible = true;
      if (this.car) this.car.group.visible = false;
    }, [], 2.7);

    // Phase B's z-tween runs until 3.3 — starting Phase C's z-tween any
    // earlier would fight it for the same property (gsap would silently cut
    // Phase B short). Handing off right at 3.3 keeps the crossing predictable.
    const radiatorStart = 3.3;

    // Phase C — radiator core rush, handing off exactly where the fins end.
    tl.to(cam, { z: stages.radiatorEndZ, duration: 0.95, ease: "power1.in" }, radiatorStart);
    tl.to(this.camera, { fov: 50, duration: 0.95 }, radiatorStart);
    tl.to(proxy, { roll: -0.05, duration: 0.9 }, radiatorStart);

    const engineStart = radiatorStart + 0.95; // 4.25, right as the radiator hands off

    // Rise to piston height before we reach the engine bay (its base deck is
    // a solid mesh well below this line, so the flyover clears it entirely).
    tl.to(cam, { y: 2.3, duration: 0.55, ease: "sine.inOut" }, radiatorStart + 0.3);

    // Phase D — engine bay flyover, a long weave down the full piston
    // corridor (nine banks deep) so the pumping pistons stay in view the
    // whole way through instead of flashing past in an instant.
    const engineDuration = 3.4;
    tl.to(cam, { z: stages.engineEndZ, duration: engineDuration, ease: "power1.inOut" }, engineStart);
    tl.to(this.camera, { fov: 40, duration: 1.0 }, engineStart);
    tl.to(cam, { x: 1.8, duration: 0.85, yoyo: true, repeat: 3, ease: "sine.inOut" }, engineStart);
    tl.to(proxy, { roll: 0, duration: 0.6 }, engineStart);
    tl.to(cam, { y: 0.4, duration: 0.55, ease: "sine.inOut" }, engineStart + engineDuration - 0.55);

    const exhaustStart = engineStart + engineDuration - 0.05; // 7.6, tiny overlap on non-z props only

    // Phase E — exhaust pipe, full send.
    tl.to(cam, { z: stages.exhaustStartZ - 58, duration: 1.05, ease: "power3.in" }, exhaustStart);
    tl.to(this.camera, { fov: 66, duration: 1.05, ease: "power2.in" }, exhaustStart);
    tl.to(proxy, { roll: 0.4, duration: 1.05 }, exhaustStart);
    tl.to(this.tunnel.stages.exhaustFlare, { intensity: 26, duration: 0.5 }, exhaustStart + 0.45);

    const exitStart = exhaustStart + 1.05;

    // Phase F — exit flare and settle into the hero backdrop.
    tl.to(cam, { z: stages.exhaustEndZ - 4, duration: 0.35, ease: "power1.out" }, exitStart);
    tl.to(this.camera, { fov: 42, duration: 0.6, ease: "power2.out" }, exitStart);
    tl.to(this.tunnel.stages.exhaustFlare, { intensity: 0, duration: 0.8 }, exitStart + 0.35);
    tl.to(proxy, { roll: 0, duration: 0.6 }, exitStart);

    this._roll = proxy;
    this._transitionTimeline = tl;
  }

  skipTransition() {
    if (this._transitionTimeline) this._transitionTimeline.progress(1).kill();
    this.state = "site";
    this.logoGroup.visible = false;
    this._revealBlend = 0;
    if (this.tunnel) this.tunnel.root.visible = true;
    if (this.car) this.car.group.visible = false;
    const restZ = this.tunnel ? this.tunnel.stages.exhaustEndZ - 4 : -222;
    this.camera.position.set(0, 0.4, restZ);
    this.camera.fov = 42;
    this.camera.updateProjectionMatrix();
    // Skipping jumps straight to the end, so snap the aim rather than letting
    // the per-frame easing swing the camera around from wherever it was.
    this._roll = null;
    this.camera.lookAt(0, 0.4, restZ - 10);
  }

  /**
   * Drops resolution once if the device clearly cannot hold a smooth frame.
   * Cheaper than stuttering through the whole cinematic, and only ever fires
   * once so it can't oscillate between quality levels.
   */
  _checkAdaptiveQuality(delta) {
    if (this._degraded || this.state === "site") return;
    if (delta > 1 / 30) this._slowFrames++;
    else this._slowFrames = Math.max(0, this._slowFrames - 1);

    if (this._slowFrames > 45) {
      this._degraded = true;
      this._maxPixelRatio = 1;
      this.renderer.setPixelRatio(1);
      this.composer.setSize(window.innerWidth, window.innerHeight);
      this.bloom.setSize(window.innerWidth / 2, window.innerHeight / 2);
    }
  }

  _animate() {
    requestAnimationFrame(this._animate);
    const delta = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime;
    this._checkAdaptiveQuality(delta);

    if (this.state === "logo") {
      this.logoGroup.rotation.y = elapsed * 0.6;
      this.logoGroup.rotation.x = Math.sin(elapsed * 0.4) * 0.08;
      this.logoGroup.position.y = Math.sin(elapsed * 0.9) * 0.15;
      this.camera.position.x += (this.pointer.x * 1.2 - this.camera.position.x) * 0.04;
      this.camera.position.y += (0.4 - this.pointer.y * 0.6 - this.camera.position.y) * 0.04;
      this.camera.lookAt(0, 0, 0);
    } else {
      const p = this.camera.position;
      // Blend between two aims rather than switching between them: looking
      // down the direction of travel (inside the machine), and looking at the
      // car itself (during the reveal). `_revealBlend` is tweened by the
      // timeline, so this crossfades instead of jumping.
      //
      // Aiming at the car's measured centre — not at a fixed point 10 units
      // ahead — is what keeps it framed: a short look-ahead at grille height
      // pitches the camera down steeply enough that the car sits outside the
      // frustum entirely, which is what left the reveal looking blank.
      const b = this._revealBlend;
      const c = this._carAim;
      const lookX = p.x + (c.x - p.x) * b;
      const lookY = p.y + (c.y - p.y) * b;
      const lookZ = (p.z - 10) + (c.z - (p.z - 10)) * b;

      this.camera.lookAt(lookX, lookY, lookZ);
      if (this._roll) this.camera.rotateZ(this._roll.roll);
    }

    if (this.tunnel) this.tunnel.update(delta);
    if (this.particles) this.particles.rotation.z += delta * 0.01;

    this.composer.render();
  }
}
