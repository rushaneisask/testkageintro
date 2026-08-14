import * as THREE from "three";

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
 * Engine bay: a long corridor of repeated piston banks pumping in their
 * bores, so the camera flies alongside continuously-visible pistons for
 * the whole engine phase instead of passing a single thin row in an instant.
 * Returns { group, length, update(t) } so main.js can animate the pistons.
 */
function buildEngineStage() {
  const group = new THREE.Group();
  const pistons = [];

  const rowSpacing = 9;
  const rowCount = 9;
  const corridorLength = (rowCount - 1) * rowSpacing;

  // A low base deck well below the flight path — the camera flies level
  // past the piston bank at its own height rather than through a solid mass.
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(17, 2.4, corridorLength + 10),
    darkMaterial(0x111318)
  );
  base.position.set(0, -5.2, -corridorLength / 2);
  group.add(base);

  const restY = 2.2;
  const cylCount = 4;
  const boreMat = chromeMaterial(0x9aa2ad);
  const rodMat = darkMaterial(0x1a1c20);
  const pistonGeo = new THREE.CylinderGeometry(1.42, 1.42, 1.6, 16);

  // 9 rows x 4 pistons = 36 ignition points — real THREE.PointLights at that
  // count are a severe per-fragment cost (every light is evaluated for every
  // lit pixel). An emissive flash on each piston's own material reads the
  // same as a spark and costs nothing extra to render.
  for (let r = 0; r < rowCount; r++) {
    const z = -r * rowSpacing;
    const rowPhase = r * 0.9; // stagger rows so the bank doesn't pulse in lockstep

    for (let i = 0; i < cylCount; i++) {
      const x = (i / (cylCount - 1) - 0.5) * 13;

      const bore = new THREE.Mesh(
        new THREE.CylinderGeometry(1.55, 1.55, 6, 16, 1, true),
        boreMat
      );
      bore.material.side = THREE.BackSide;
      bore.position.set(x, restY, z);
      group.add(bore);

      const pistonMat = chromeMaterial(0xe7eaef);
      pistonMat.emissive = new THREE.Color(0xff8a3d);
      pistonMat.emissiveIntensity = 0;
      const piston = new THREE.Mesh(pistonGeo, pistonMat);
      piston.position.set(x, restY, z);
      group.add(piston);

      const rod = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4, 0.4), rodMat);
      rod.position.set(x, restY - 2.6, z);
      group.add(rod);

      pistons.push({
        piston,
        rod,
        restY,
        phase: (i / cylCount) * Math.PI * 2 + rowPhase,
      });
    }
  }

  function update(t) {
    for (const { piston, rod, restY: base, phase } of pistons) {
      const cycle = Math.sin(t * 6 + phase);
      piston.position.y = base + cycle * 1.4;
      rod.position.y = piston.position.y - 2.6;
      rod.scale.y = 1 + cycle * 0.12;
      const ignite = Math.max(0, Math.sin(t * 6 + phase + Math.PI));
      piston.material.emissiveIntensity = ignite > 0.85 ? (ignite - 0.85) * 6 : 0;
    }
  }

  return { group, length: corridorLength, update };
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

  const radiatorStartZ = -46;
  const radiatorEndZ = radiatorStartZ - 25 * 1.6; // last of 26 fins, spaced 1.6 apart

  const radiator = buildRadiatorStage();
  radiator.position.z = radiatorStartZ;
  root.add(radiator);

  // The engine corridor picks up exactly where the radiator ends, and the
  // exhaust picks up exactly where the corridor ends — no dead space between
  // any two stages of the flythrough.
  const engine = buildEngineStage();
  engine.group.position.z = radiatorEndZ;
  root.add(engine.group);

  const exhaustStartZ = radiatorEndZ - engine.length;
  const exhaust = buildExhaustStage();
  exhaust.group.position.z = exhaustStartZ;
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
      radiatorStartZ,
      radiatorEndZ,
      engineStartZ: radiatorEndZ,
      engineEndZ: exhaustStartZ,
      exhaustStartZ,
      exhaustEndZ: exhaustStartZ - exhaust.length,
      exhaustFlare: exhaust.flare,
    },
  };
}
