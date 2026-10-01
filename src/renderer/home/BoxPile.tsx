// Cardboard boxes tumble into the empty chat, one after another, and settle
// in a low pile along the bottom of the pane. The floor sits exactly on the
// pane's bottom edge; it and the walls that keep the pile in frame are invisible.

import { useGLTF } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  BallCollider,
  CuboidCollider,
  Physics,
  RigidBody,
  useAfterPhysicsStep,
  useRapier,
  type RapierRigidBody,
} from '@react-three/rapier';
import { Suspense, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3, type Material, type Mesh } from 'three';
import boxUrl from './assets/cardboard-box.glb?url';

const COUNT = 16;
const SCALE = 1.9;
/** Milliseconds between one box appearing and the next. */
const CADENCE = 220;

// The camera sits at z = CAMERA_Z, pitched CAMERA_PITCH down. Its height is
// solved so the ray through the bottom edge of the frame meets the floor
// (y = 0) at the floor's front edge, which puts the floor on the pane's edge.
const FOV = 28;
const CAMERA_Z = 8.6;
const CAMERA_PITCH = (8 * Math.PI) / 180;
const FLOOR_HALF_DEPTH = 0.75;
const CAMERA_Y = (CAMERA_Z - FLOOR_HALF_DEPTH) * Math.tan(CAMERA_PITCH + (FOV * Math.PI) / 360);
/** Just above the top of the frame at z = 0, so a box enters from off screen. */
const SPAWN_Y = CAMERA_Y + CAMERA_Z * Math.tan((FOV * Math.PI) / 360 - CAMERA_PITCH) + 1.2;

/**
 * Where the pane's side edges meet the floor's front edge, in world x, for a
 * frame of this aspect: the ray through a bottom corner of the frame, followed
 * down to y = 0. Walls here sit exactly on the sidebar and the window edge.
 */
function edgeX(aspect: number): number {
  const t = Math.tan((FOV * Math.PI) / 360);
  const reach = CAMERA_Y / (t * Math.cos(CAMERA_PITCH) + Math.sin(CAMERA_PITCH));
  return aspect * t * reach;
}

useGLTF.preload(boxUrl);

type Vec3 = [number, number, number];
type Drop = { position: Vec3; rotation: Vec3; linearVelocity: Vec3; angularVelocity: Vec3 };

export function BoxPile(): ReactElement {
  const camera = useMemo(() => {
    const cam = new PerspectiveCamera(FOV, 1, 0.1, 50);
    cam.position.set(0, CAMERA_Y, CAMERA_Z);
    cam.lookAt(0, CAMERA_Y - CAMERA_Z * Math.tan(CAMERA_PITCH), 0);
    return cam;
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <Canvas
        camera={camera}
        shadows
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      >
        <hemisphereLight args={['#ffffff', '#d6d6d6', 1.1]} />
        <directionalLight
          position={[3.2, 8, 5]}
          intensity={1.7}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-camera-near={0.5}
          shadow-camera-far={22}
          shadow-camera-left={-6}
          shadow-camera-right={6}
          shadow-camera-top={8}
          shadow-camera-bottom={-3}
          shadow-bias={-0.0006}
          shadow-normalBias={0.02}
        />
        <Suspense fallback={null}>
          <Physics numSolverIterations={8}>
            <Pile />
          </Physics>
        </Suspense>
      </Canvas>
    </div>
  );
}

function Pile(): ReactElement | null {
  const size = useThree((state) => state.size);
  const { nodes } = useGLTF(boxUrl);
  const box = nodes.CardboardBox as Mesh;
  // The walls track the pane's edges through resizes; the drops are dealt
  // once, across the width the pane had when the pile started.
  const halfW = size.width > 1 ? edgeX(size.width / size.height) : 0;
  const drops = useRef<Drop[] | null>(null);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!drops.current && halfW > 0) drops.current = makeDrops(halfW, reduced);
  // Boxes arrive one at a time; with reduced motion the pile is already there.
  const [shown, setShown] = useState(reduced ? COUNT : 0);
  useEffect(() => {
    if (shown >= COUNT) return;
    const timer = setTimeout(() => setShown((n) => n + 1), CADENCE);
    return () => clearTimeout(timer);
  }, [shown]);
  if (!drops.current) return null;

  const wallH = SPAWN_Y;
  return (
    <>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[halfW + 1, 0.5, FLOOR_HALF_DEPTH + 1]} position={[0, -0.5, 0]} friction={0.9} />
        <CuboidCollider args={[0.2, wallH, FLOOR_HALF_DEPTH]} position={[-halfW - 0.2, wallH, 0]} />
        <CuboidCollider args={[0.2, wallH, FLOOR_HALF_DEPTH]} position={[halfW + 0.2, wallH, 0]} />
        <CuboidCollider args={[halfW, wallH, 0.2]} position={[0, wallH, -FLOOR_HALF_DEPTH - 0.2]} />
        <CuboidCollider args={[halfW, wallH, 0.2]} position={[0, wallH, FLOOR_HALF_DEPTH + 0.2]} />
      </RigidBody>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} receiveShadow>
        <planeGeometry args={[(halfW + 1) * 2, (FLOOR_HALF_DEPTH + 1) * 2]} />
        <shadowMaterial transparent opacity={0.22} />
      </mesh>
      <Cursor />
      {drops.current.slice(0, shown).map((drop, index) => (
        <RigidBody
          key={index}
          {...drop}
          // A hull hugs the flaps, so boxes catch on each other the way open
          // boxes do instead of hovering on a bounding box.
          colliders="hull"
          friction={0.6}
          restitution={0.12}
          linearDamping={0.05}
          angularDamping={0.25}
          ccd
        >
          <mesh geometry={box.geometry} material={box.material as Material} scale={SCALE} castShadow />
        </RigidBody>
      ))}
    </>
  );
}

const CURSOR_RADIUS = 0.32;
/** How fast the ball may chase the pointer, in units per second. */
const CURSOR_SPEED = 8;
/** The fastest a box may move or spin, whatever pushed it. */
const MAX_LINEAR = 6;
const MAX_ANGULAR = 12;
const PILE_PLANE = new Plane(new Vector3(0, 0, 1), 0);
const raycaster = new Raycaster();
const ndc = new Vector2();
const hit = new Vector3();
const from = new Vector3();
const PARKED = { x: 0, y: -50, z: 0 };

/**
 * The pointer as an invisible ball the boxes have to make way for. The canvas
 * takes no pointer events (the composer sits over it), so this reads the
 * window's pointer, projects it onto the pile's mid plane, and chases it with
 * a kinematic body. The ball is infinitely heavy, so it may never jump: a
 * teleport into a box would launch it. It moves at most CURSOR_SPEED and, as
 * a backstop, every box is held under a speed limit after each physics step.
 * Off the pane, the ball parks underground.
 */
function Cursor(): ReactElement {
  const { world } = useRapier();
  useAfterPhysicsStep(() => {
    world.bodies.forEach((body) => {
      if (!body.isDynamic()) return;
      clamp(body.linvel(), MAX_LINEAR, (v) => body.setLinvel(v, false));
      clamp(body.angvel(), MAX_ANGULAR, (v) => body.setAngvel(v, false));
    });
  });
  const body = useRef<RapierRigidBody>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const { camera, gl } = useThree();

  useEffect(() => {
    const move = (event: PointerEvent): void => {
      const rect = gl.domElement.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      pointer.current = Math.abs(x) <= 1 && Math.abs(y) <= 1 ? { x, y } : null;
    };
    const leave = (): void => {
      pointer.current = null;
    };
    window.addEventListener('pointermove', move);
    document.documentElement.addEventListener('pointerleave', leave);
    return () => {
      window.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', leave);
    };
  }, [gl]);

  useFrame((_, delta) => {
    const ball = body.current;
    if (!ball) return;
    const at = pointer.current;
    if (!at) {
      ball.setNextKinematicTranslation(PARKED);
      return;
    }
    raycaster.setFromCamera(ndc.set(at.x, at.y), camera);
    if (!raycaster.ray.intersectPlane(PILE_PLANE, hit)) return;
    hit.set(hit.x, Math.max(hit.y, CURSOR_RADIUS), 0);
    // Coming back from the parking spot is the one allowed jump; boxes it
    // lands inside are eased out by the speed limit rather than launched.
    from.copy(ball.translation());
    if (from.y > -1) {
      const step = CURSOR_SPEED * delta;
      if (from.distanceTo(hit) > step) hit.copy(from.add(hit.sub(from).setLength(step)));
    }
    ball.setNextKinematicTranslation(hit);
  });

  return (
    <RigidBody ref={body} type="kinematicPosition" colliders={false} position={[PARKED.x, PARKED.y, PARKED.z]}>
      <BallCollider args={[CURSOR_RADIUS]} friction={0.4} />
    </RigidBody>
  );
}

/** Scale a velocity down to `max` when it is over, and hand it back. */
function clamp(v: { x: number; y: number; z: number }, max: number, set: (v: Vector3) => void): void {
  const speed = Math.hypot(v.x, v.y, v.z);
  if (speed > max) set(new Vector3(v.x, v.y, v.z).multiplyScalar(max / speed));
}

/**
 * Each box starts off screen above the floor, already tumbling. The floor's
 * width is split into one slot per box, dealt in random order and jittered,
 * so the pile always spans the pane instead of bunching where chance put it.
 */
function makeDrops(halfW: number, reduced: boolean): Drop[] {
  const spread = (range: number): number => (Math.random() - 0.5) * 2 * range;
  const span = Math.max(halfW - 0.3, 0.4);
  const slot = (span * 2) / COUNT;
  const slots = Array.from({ length: COUNT }, (_, i) => -span + slot * (i + 0.5)).sort(() => Math.random() - 0.5);
  return slots.map((x, index) => ({
    position: [
      x + spread(slot * 0.4),
      reduced ? 0.5 + (index % 3) * 0.55 : SPAWN_Y + spread(0.4),
      spread(FLOOR_HALF_DEPTH - 0.45),
    ],
    rotation: [spread(reduced ? 0.15 : Math.PI), Math.random() * Math.PI * 2, spread(reduced ? 0.15 : Math.PI)],
    linearVelocity: reduced ? [0, 0, 0] : [spread(1.2), -1.5, spread(0.5)],
    angularVelocity: reduced ? [0, 0, 0] : [spread(4), spread(4), spread(4)],
  }));
}
