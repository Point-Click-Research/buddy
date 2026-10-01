'use client';

import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, type ReactElement, type RefObject } from 'react';
import { Mesh, type BufferGeometry, type PointLight } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LAND, sceneAt, type StageClock } from './timeline';

const DISCO_REST = 0.22;
const DISCO_FLASH = 4;

/**
 * The buddy dot in 3D: the sphere from buddy_dot.blend on a transparent
 * orthographic canvas where one world unit is one screen pixel, so it can be
 * placed straight from the shot's screen-space math.
 */
export function BuddyDot({
  clock,
  modelUrl,
  onReady,
}: {
  clock: RefObject<StageClock>;
  modelUrl: string;
  onReady: () => void;
}): ReactElement {
  // The canvas fills a fixed host so its size is the viewport and its origin
  // is the viewport's; `place` below relies on both.
  return (
    <div className="pointer-events-none fixed inset-0 z-10" aria-hidden>
      <Canvas
        orthographic
        flat
        camera={{ position: [0, 0, 600], near: 1, far: 1500, zoom: 1 }}
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      >
        <Suspense fallback={null}>
          <Scene clock={clock} modelUrl={modelUrl} onReady={onReady} />
        </Suspense>
      </Canvas>
    </div>
  );
}

function Scene({
  clock,
  modelUrl,
  onReady,
}: {
  clock: RefObject<StageClock>;
  modelUrl: string;
  onReady: () => void;
}): ReactElement {
  const gltf = useLoader(GLTFLoader, modelUrl);
  const geometry = useMemo(() => firstGeometry(gltf.scene, modelUrl), [gltf, modelUrl]);
  const { size } = useThree();
  const sphere = useRef<Mesh>(null);
  const disco = useRef<PointLight>(null);

  useEffect(onReady, [onReady]);

  useFrame(() => {
    const mesh = sphere.current;
    const light = disco.current;
    const frame = sceneAt(clock.current, performance.now());
    if (!frame || !mesh || !light) return;

    // Screen px (origin top-left, +y down) to world (origin centre, +y up).
    mesh.position.set(frame.sphere.x - size.width / 2, size.height / 2 - frame.sphere.y, 0);
    mesh.scale.setScalar(Math.max(0.001, frame.sphereRadius));
    mesh.rotation.y = 0.5 * Math.min(frame.t, LAND);

    // The disco light sits low and to the right, opposite the white key, so
    // the hue washes the side the icon leaves dark.
    const r = clock.current.geo.radius;
    // Dark until the cursor touches it; the touch flashes the sphere with
    // colour, then the light settles to a hint on the shadow side.
    light.color.setHSL(frame.hue / 360, 0.88, 0.56);
    light.intensity = DISCO_REST * frame.power + DISCO_FLASH * frame.flare;
    light.position.set(mesh.position.x + r * 2, mesh.position.y - r * 1.6, r * 2.2);
  });

  // Matte, like the icon: the key is high and only slightly in front, so the
  // highlight sits on the upper face and the bottom half falls to black.
  // No tone mapping (the canvas is `flat`), so these values land as set.
  return (
    <>
      <ambientLight intensity={0.02} />
      <directionalLight position={[-1.9, 2.8, 1]} intensity={2.5} />
      <pointLight ref={disco} intensity={0} decay={0} />
      <mesh ref={sphere} geometry={geometry}>
        <meshStandardMaterial color="#5a5a5a" roughness={0.8} metalness={0.9} />
      </mesh>
    </>
  );
}

function firstGeometry(scene: { traverse: (cb: (o: object) => void) => void }, modelUrl: string): BufferGeometry {
  let found: BufferGeometry | undefined;
  scene.traverse((o) => {
    if (!found && o instanceof Mesh) found = o.geometry;
  });
  if (!found) throw new Error(`${modelUrl} has no mesh`);
  return found;
}
