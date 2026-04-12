import { useEffect, useMemo, useRef } from "preact/hooks";

type BeanConfig = {
  left: number;
  top: number;
  scale: number;
  opacity: number;
  driftDuration: number;
  rollDuration: number;
  driftDelay: number;
  rollDelay: number;
  driftX: number;
  driftY: number;
  rotation: number;
};

const BEAN_COUNT = 14;

function normalizedRandom(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function createBean(index: number): BeanConfig {
  const baseSeed = index + 1;
  return {
    left: 4 + normalizedRandom(baseSeed * 1.3) * 92,
    top: 5 + normalizedRandom(baseSeed * 2.1) * 90,
    scale: 0.7 + normalizedRandom(baseSeed * 3.7) * 0.55,
    opacity: 0.06 + normalizedRandom(baseSeed * 4.9) * 0.08,
    driftDuration: 24 + normalizedRandom(baseSeed * 5.1) * 24,
    rollDuration: 18 + normalizedRandom(baseSeed * 6.4) * 28,
    driftDelay: -normalizedRandom(baseSeed * 7.7) * 30,
    rollDelay: -normalizedRandom(baseSeed * 8.5) * 35,
    driftX: -14 + normalizedRandom(baseSeed * 9.2) * 28,
    driftY: -10 + normalizedRandom(baseSeed * 10.8) * 20,
    rotation: normalizedRandom(baseSeed * 11.3) * 360,
  };
}

export function CoffeeBeanBackground() {
  const bgRef = useRef<HTMLDivElement | null>(null);
  const beans = useMemo(() => Array.from({ length: BEAN_COUNT }, (_, i) => createBean(i)), []);

  useEffect(() => {
    const layer = bgRef.current;
    if (!layer) return;

    let rafId = 0;
    const updateParallax = (x: number, y: number) => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        layer.style.setProperty("--bean-parallax-x", `${x.toFixed(2)}px`);
        layer.style.setProperty("--bean-parallax-y", `${y.toFixed(2)}px`);
      });
    };

    const onPointerMove = (event: PointerEvent) => {
      const px = event.clientX / window.innerWidth - 0.5;
      const py = event.clientY / window.innerHeight - 0.5;
      updateParallax(px * 16, py * 10);
    };

    const onPointerLeave = () => updateParallax(0, 0);

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
    };
  }, []);

  return (
    <div ref={bgRef} class="bean-bg" aria-hidden="true">
      {beans.map((bean, index) => (
        <span
          class="bean"
          key={`bean-${index}`}
          style={{
            "--bean-left": `${bean.left}%`,
            "--bean-top": `${bean.top}%`,
            "--bean-scale": `${bean.scale}`,
            "--bean-opacity": `${bean.opacity}`,
            "--bean-drift-duration": `${bean.driftDuration}s`,
            "--bean-roll-duration": `${bean.rollDuration}s`,
            "--bean-drift-delay": `${bean.driftDelay}s`,
            "--bean-roll-delay": `${bean.rollDelay}s`,
            "--bean-drift-x": `${bean.driftX}px`,
            "--bean-drift-y": `${bean.driftY}px`,
            "--bean-rotation": `${bean.rotation}deg`,
          } as Record<string, string>}
        />
      ))}
    </div>
  );
}
