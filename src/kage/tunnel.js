import * as THREE from "three";

const RED = 0xd81324;
const CHROME = 0xc7ccd4;
const DARK = 0x0c0d10;

function chromeMaterial(color = CHROME) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 1,
    roughness: 0.28,
  });
}

function darkMaterial(color = DARK) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.6,
    roughness: 0.75,
  });
}

function emissiveMaterial(color, intensity = 2) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    metalness: 0.2,
    roughness: 0.4,
  });
}

/**
 * Builds one kidney-grille panel: a rounded frame packed with vertical slats.
 * Homage to a tall, vertical "angel-eye" sport-coupe front end — fully
 * procedural, no copyrighted marks or exact reference geometry.
 */
function buildKidneyPanel() {
  const group = new THREE.Group();

  const frame = new THREE.Mesh(
    new THREE.CapsuleGeometry(2.6, 8, 6, 12),
    darkMaterial(0x050506)
  );
  frame.rotation.z = 0;
  group.add(frame);

  const slatMat = chromeMaterial();
  const slatCount = 9;
  const slatGeo = new THREE.BoxGeometry(0.32, 9.4, 1.4);
  const slats = new THREE.InstancedMesh(slatGeo, slatMat, slatCount);
  const m = new THREE.Matrix4();
  for (let i = 0; i < slatCount; i++) {
    const t = i / (slatCount - 1) - 0.5;
    m.makeTranslation(t * 4.2, 0, 3.2);
    slats.setMatrixAt(i, m);
  }
  slats.instanceMatrix.needsUpdate = true;
  group.add(slats);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.05, 0.05, 8, 40),
    emissiveMaterial(RED, 3)
  );
  rim.scale.set(2.7, 5.2, 1);
  rim.position.z = 3.4;
  group.add(rim);

  return group;
}

function buildAngelEye() {
  const group = new THREE.Group();

  const housing = new THREE.Mesh(
    new THREE.SphereGeometry(2.3, 24, 24, 0, Math.PI * 2, 0, Math.PI / 1.6),
    darkMaterial(0x0a0b0d)
  );
  housing.rotation.x = Math.PI;
  group.add(housing);

  const corona = new THREE.Mesh(
    new THREE.TorusGeometry(1.5, 0.14, 12, 48),
    emissiveMaterial(0xeaf3ff, 4.5)
  );
  group.add(corona);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 16, 16),
    emissiveMaterial(0xbfd8ff, 3.5)
  );
  core.position.z = 0.3;
  group.add(core);

  const glow = new THREE.PointLight(0xbfd8ff, 8, 14);
  glow.position.z = 1;
  group.add(glow);

  return group;
}

function buildGrilleStage() {
  const group = new THREE.Group();

  const left = buildKidneyPanel();
  left.position.set(-2.6, 0, 0);
  group.add(left);

  const right = buildKidneyPanel();
  right.position.set(2.6, 0, 0);
  group.add(right);

  const eyeL = buildAngelEye();
  eyeL.position.set(-8.4, 0.4, -1.5);
  group.add(eyeL);

  const eyeR = buildAngelEye();
  eyeR.position.set(8.4, 0.4, -1.5);
  group.add(eyeR);

  const bumper = new THREE.Mesh(
    new THREE.BoxGeometry(24, 4.4, 3),
    darkMaterial(0x08090b)
  );
  bumper.position.set(0, -6.6, -1.2);
  group.add(bumper);

  return group;
}

/**
 * Radiator core: a dense tunnel of thin fins + coolant tubes the camera
 * flies straight through.
 */
function buildRadiatorStage() {
  const group = new THREE.Group();
  const finMat = new THREE.MeshStandardMaterial({
    color: 0x565c66,
    metalness: 0.7,
    roughness: 0.65,
  });
  const finGeo = new THREE.BoxGeometry(13, 13, 0.06);

  const rows = 26;
  const fins = new THREE.InstancedMesh(finGeo, finMat, rows);
  const m = new THREE.Matrix4();
  for (let i = 0; i < rows; i++) {
    m.makeTranslation(0, 0, -i * 1.6);
    fins.setMatrixAt(i, m);
  }
  fins.instanceMatrix.needsUpdate = true;
  group.add(fins);

  const tubeMat = emissiveMaterial(0xff5a2e, 0.8);
  const tubeGeo = new THREE.CylinderGeometry(0.16, 0.16, rows * 1.6, 8, 1, true);
  const tubeCols = 6;
  const tubeRows = 5;
  for (let x = 0; x < tubeCols; x++) {
    for (let y = 0; y < tubeRows; y++) {
      const tube = new THREE.Mesh(tubeGeo, tubeMat);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(
        (x / (tubeCols - 1) - 0.5) * 10.5,
        (y / (tubeRows - 1) - 0.5) * 10.5,
        -rows * 0.8
      );
      group.add(tube);
    }
  }

  return group;
}

/**
 * Engine bay: a block with a bank of pistons pumping in their bores.
 * Returns { group, update(t) } so main.js can animate the pistons.
 */
function buildEngineStage() {
  const group = new THREE.Group();
  const pistons = [];

  // A low base deck well below the flight path — the camera flies level
  // past the piston bank at its own height rather than through a solid mass.
  const base = new THREE.Mesh(new THREE.BoxGeometry(17, 2.4, 22), darkMaterial(0x111318));
  base.position.y = -5.2;
  group.add(base);

  const restY = 2.2;
  const cylCount = 4;
  const boreMat = chromeMaterial(0x9aa2ad);
  const pistonMat = chromeMaterial(0xe7eaef);
  const rodMat = darkMaterial(0x1a1c20);

  for (let i = 0; i < cylCount; i++) {
    const x = (i / (cylCount - 1) - 0.5) * 13;

    const bore = new THREE.Mesh(
      new THREE.CylinderGeometry(1.55, 1.55, 6, 20, 1, true),
      boreMat
    );
    bore.material.side = THREE.BackSide;
    bore.position.set(x, restY, 0);
    group.add(bore);

    const piston = new THREE.Mesh(
      new THREE.CylinderGeometry(1.42, 1.42, 1.6, 20),
      pistonMat
    );
    piston.position.set(x, restY, 0);
    group.add(piston);

    const rod = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4, 0.4), rodMat);
    rod.position.set(x, restY - 2.6, 0);
    group.add(rod);

    const spark = new THREE.PointLight(0xff8a3d, 0, 6);
    spark.position.set(x, restY + 3, 0);
    group.add(spark);

    pistons.push({ piston, rod, spark, restY, phase: (i / cylCount) * Math.PI * 2 });
  }

  function update(t) {
    for (const { piston, rod, spark, restY: base, phase } of pistons) {
      const cycle = Math.sin(t * 6 + phase);
      piston.position.y = base + cycle * 1.4;
      rod.position.y = piston.position.y - 2.6;
      rod.scale.y = 1 + cycle * 0.12;
      const ignite = Math.max(0, Math.sin(t * 6 + phase + Math.PI));
      spark.intensity = ignite > 0.85 ? (ignite - 0.85) * 40 : 0;
    }
  }

  return { group, update };
}

/**
 * Exhaust pipe interior: a long back-facing cylinder with ridge rings,
 * glowing hotter red toward the exit, plus streaking speed lines.
 */
function buildExhaustStage() {
  const group = new THREE.Group();

  const length = 60;
  const pipe = new THREE.Mesh(
    new THREE.CylinderGeometry(3.4, 2.6, length, 24, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x1a1213,
      metalness: 0.9,
      roughness: 0.4,
      side: THREE.BackSide,
      emissive: 0xff2200,
      emissiveIntensity: 0.35,
    })
  );
  pipe.rotation.x = Math.PI / 2;
  pipe.position.z = -length / 2;
  group.add(pipe);

  const ringCount = 14;
  for (let i = 0; i < ringCount; i++) {
    const t = i / (ringCount - 1);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(3, 0.05, 8, 32),
      emissiveMaterial(0xff5522, 1 + t * 4)
    );
    ring.position.z = -t * length;
    ring.scale.setScalar(1 - t * 0.15);
    group.add(ring);
  }

  const streakGeo = new THREE.BoxGeometry(0.04, 0.04, 2.4);
  const streakMat = new THREE.MeshBasicMaterial({
    color: 0xffb066,
    transparent: true,
    opacity: 0.8,
  });
  const streakCount = 36;
  const streaks = [];
  for (let i = 0; i < streakCount; i++) {
    const streak = new THREE.Mesh(streakGeo, streakMat);
    resetStreak(streak, length);
    group.add(streak);
    streaks.push(streak);
  }

  function resetStreak(streak, len) {
    const angle = Math.random() * Math.PI * 2;
    const r = 1.4 + Math.random() * 1.6;
    streak.position.set(Math.cos(angle) * r, Math.sin(angle) * r, -Math.random() * len);
    streak.userData.speed = 24 + Math.random() * 20;
  }

  function update(delta) {
    for (const streak of streaks) {
      streak.position.z += streak.userData.speed * delta;
      if (streak.position.z > 2) resetStreak(streak, length);
    }
  }

  const flare = new THREE.PointLight(0xff5a2e, 0, 40);
  flare.position.z = -length + 4;
  group.add(flare);

  return { group, update, length, flare };
}

export function buildTunnel() {
  const root = new THREE.Group();

  const grille = buildGrilleStage();
  grille.position.z = -30;
  root.add(grille);

  const radiator = buildRadiatorStage();
  radiator.position.z = -46;
  root.add(radiator);

  const engine = buildEngineStage();
  engine.group.position.z = -104;
  root.add(engine.group);

  const exhaust = buildExhaustStage();
  exhaust.group.position.z = -150;
  root.add(exhaust.group);

  const clock = { t: 0 };
  function update(delta) {
    clock.t += delta;
    engine.update(clock.t);
    exhaust.update(delta);
  }

  return {
    root,
    update,
    stages: {
      grilleZ: -30,
      radiatorStartZ: -46,
      radiatorEndZ: -46 - 26 * 1.6,
      engineZ: -104,
      exhaustStartZ: -150,
      exhaustEndZ: -150 - exhaust.length,
      exhaustFlare: exhaust.flare,
    },
  };
}
