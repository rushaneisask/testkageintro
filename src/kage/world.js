import * as THREE from "three";
import gsap from "gsap";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildEmblemGeometry } from "./emblem.js";
import { buildTunnel } from "./tunnel.js";

const RED = 0xd81324;

export class World {
  constructor(canvas, { onArrive } = {}) {
    this.canvas = canvas;
    this.onArrive = onArrive;
    this.clock = new THREE.Clock();
    this.pointer = new THREE.Vector2();
    this.state = "logo";

    this._initRenderer();
    this._initScene();
    this._initLogo();
    this._bindEvents();

    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);

    // Defer the expensive, not-immediately-visible setup (env map prefiltering,
    // tunnel geometry) so first paint of the spinning logo isn't blocked by it.
    setTimeout(() => {
      this._initEnvironment();
      this._initTunnel();
    }, 0);
  }

  _initRenderer() {
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
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
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.5,
      0.5,
      0.92
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

    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(4, 6, 8);
    scene.add(key);

    const rim = new THREE.PointLight(RED, 3.2, 18);
    rim.position.set(-6, 2, -4);
    scene.add(rim);

    const fillBlue = new THREE.PointLight(0x3a6bff, 1.3, 16);
    fillBlue.position.set(6, -2, 4);
    scene.add(fillBlue);

    scene.add(new THREE.AmbientLight(0x30323c, 0.5));

    // A light that rides with the camera — keeps the tunnel interior readable
    // as it travels, without needing distant fixed lights to overexpose the
    // near geometry it passes close by.
    const travelLight = new THREE.PointLight(0xfff2e6, 2.2, 22, 2);
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
    this.bloom.setSize(w, h);
  }

  /** Kicks off the click → flythrough → hero-reveal cinematic. */
  playTransition({ onIntroFade, onComplete } = {}) {
    if (this.state !== "logo" || !this.tunnel) return;
    this.state = "transition";
    this.tunnel.root.visible = true;

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

    // Phase A — punch in on the emblem, then dissolve it into the grille.
    tl.to(this.logoGroup.scale, { x: 1.35, y: 1.35, z: 1.35, duration: 0.5, ease: "power1.in" }, 0);
    tl.to(cam, { z: 3.2, duration: 0.9, ease: "power2.in" }, 0);
    tl.to(this.camera, { fov: 34, duration: 0.9, onUpdate: () => this.camera.updateProjectionMatrix() }, 0);
    tl.to(this.logoMaterial, { emissiveIntensity: 2.4, duration: 0.36, ease: "power2.in" }, 0.5);
    tl.to(this.logoGroup, { visible: false, duration: 0.01 }, 0.86);

    // Phase B — through the grille.
    tl.to(cam, { z: -34, duration: 1.0, ease: "power1.inOut" }, 0.82);
    tl.to(this.camera, { fov: 46, duration: 1.0 }, 0.82);
    tl.to(proxy, { roll: 0.03, duration: 0.5, yoyo: true, repeat: 1 }, 0.82);

    // Phase C — radiator core rush.
    tl.to(cam, { z: -100, duration: 1.0, ease: "power1.in" }, 1.75);
    tl.to(this.camera, { fov: 50, duration: 1.0 }, 1.75);
    tl.to(proxy, { roll: -0.05, duration: 0.9 }, 1.75);

    // Rise to piston height before we reach the engine bay (its base deck is
    // a solid mesh well below this line, so the flyover clears it entirely).
    tl.to(cam, { y: 2.3, duration: 0.55, ease: "sine.inOut" }, 2.05);
    tl.to(cam, { y: 0.4, duration: 0.55, ease: "sine.inOut" }, 3.95);

    // Phase D — engine bay flyover, slow to let the pistons read.
    tl.to(cam, { z: -148, duration: 1.35, ease: "power1.inOut" }, 2.7);
    tl.to(this.camera, { fov: 40, duration: 1.0 }, 2.7);
    tl.to(cam, { x: 1.6, duration: 0.7, yoyo: true, repeat: 1, ease: "sine.inOut" }, 2.7);
    tl.to(proxy, { roll: 0, duration: 0.6 }, 2.7);

    // Phase E — exhaust pipe, full send.
    tl.to(cam, { z: -204, duration: 1.05, ease: "power3.in" }, 4.15);
    tl.to(this.camera, { fov: 66, duration: 1.05, ease: "power2.in" }, 4.15);
    tl.to(proxy, { roll: 0.4, duration: 1.05 }, 4.15);
    tl.to(this.tunnel.stages.exhaustFlare, { intensity: 26, duration: 0.5 }, 4.6);

    // Phase F — exit flare and settle into the hero backdrop.
    tl.to(cam, { z: -214, duration: 0.35, ease: "power1.out" }, 5.2);
    tl.to(this.camera, { fov: 42, duration: 0.6, ease: "power2.out" }, 5.2);
    tl.to(this.tunnel.stages.exhaustFlare, { intensity: 0, duration: 0.8 }, 5.55);
    tl.to(proxy, { roll: 0, duration: 0.6 }, 5.2);

    this._roll = proxy;
    this._transitionTimeline = tl;
  }

  skipTransition() {
    if (this._transitionTimeline) this._transitionTimeline.progress(1).kill();
    this.state = "site";
    this.logoGroup.visible = false;
    if (this.tunnel) this.tunnel.root.visible = true;
    this.camera.position.set(0, 0.4, -214);
    this.camera.fov = 42;
    this.camera.updateProjectionMatrix();
  }

  _animate() {
    requestAnimationFrame(this._animate);
    const delta = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime;

    if (this.state === "logo") {
      this.logoGroup.rotation.y = elapsed * 0.6;
      this.logoGroup.rotation.x = Math.sin(elapsed * 0.4) * 0.08;
      this.logoGroup.position.y = Math.sin(elapsed * 0.9) * 0.15;
      this.camera.position.x += (this.pointer.x * 1.2 - this.camera.position.x) * 0.04;
      this.camera.position.y += (0.4 - this.pointer.y * 0.6 - this.camera.position.y) * 0.04;
      this.camera.lookAt(0, 0, 0);
    } else {
      const lookZ = this.camera.position.z - 10;
      this.camera.lookAt(this.camera.position.x, this.camera.position.y, lookZ);
      if (this._roll) this.camera.rotation.z = this._roll.roll;
    }

    if (this.tunnel) this.tunnel.update(delta);
    if (this.particles) this.particles.rotation.z += delta * 0.01;

    this.composer.render();
  }
}
