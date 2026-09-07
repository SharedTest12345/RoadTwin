import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls } from "@react-three/drei";
import * as THREE from "three";

const MOVE_SPEED = 60; // m/s — real road lengths run to 2000m, a slow walk-speed default would take forever to cross one
const BOOST_MULT = 2.8; // Shift held
const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "Space", "ControlLeft", "ShiftLeft", "ShiftRight"]);

/** Free-fly WASD + click-to-look camera — an alternative to OrbitControls'
 * orbit-around-a-fixed-target model, for exploring the scene under the user's
 * own control instead of watching a framed preset shot.
 *
 * Look is drei's PointerLockControls (the browser's native Pointer Lock API,
 * same mechanism any FPS-style web game uses): click once anywhere to engage,
 * then just move the mouse — no held-down drag needed, Esc releases it. This
 * replaced a hand-rolled mousedown/mousemove drag-tracker specifically because
 * it's a well-tested standard mechanism rather than one more custom listener
 * that could have its own subtle bug, after WASD alone wasn't registering.
 *
 * Movement is still custom: WASD relative to the camera's current facing,
 * flattened to the horizontal plane (yaw only) so looking up/down doesn't fly
 * you into the ground or the sky. It reads the camera's live orientation each
 * frame via getWorldDirection, so it automatically follows whatever
 * PointerLockControls just rotated the camera to — the two never fight over
 * who owns rotation vs position. */
export function FreeFlyControls() {
  const { camera, gl } = useThree();
  const keys = useRef<Record<string, boolean>>({});

  useEffect(() => {
    const el = gl.domElement;
    if (el.tabIndex < 0) el.tabIndex = 0;
    el.style.outline = "none";
    el.focus();

    // Space in particular scrolls the page by default when focus isn't on a
    // text input — preventDefault on the whole movement set defensively.
    const onKeyDown = (e: KeyboardEvent) => {
      keys.current[e.code] = true;
      if (MOVE_KEYS.has(e.code)) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => { keys.current[e.code] = false; };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [gl]);

  useFrame((_, delta) => {
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() > 1e-8) forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();

    const boosted = keys.current["ShiftLeft"] || keys.current["ShiftRight"];
    const speed = MOVE_SPEED * (boosted ? BOOST_MULT : 1) * delta;
    const move = new THREE.Vector3();
    if (keys.current["KeyW"]) move.add(forward);
    if (keys.current["KeyS"]) move.sub(forward);
    if (keys.current["KeyD"]) move.add(right);
    if (keys.current["KeyA"]) move.sub(right);
    if (keys.current["Space"]) move.y += 1;
    if (keys.current["KeyQ"] || keys.current["ControlLeft"]) move.y -= 1;
    if (move.lengthSq() > 0) camera.position.addScaledVector(move.normalize(), speed);
  });

  return <PointerLockControls />;
}
