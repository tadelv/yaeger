import { useEffect, useRef } from "preact/hooks";

type BeanParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  angle: number;
  spin: number;
  opacity: number;
};

const MAX_DPR = 1.5;
const DESKTOP_BEANS = 64;
const MOBILE_BEANS = 36;
const MOBILE_BREAKPOINT = 880;

function normalizedRandom(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function createBeans(count: number, width: number, height: number): BeanParticle[] {
  return Array.from({ length: count }, (_, index) => {
    const s = index + 1;
    const speed = 0.03 + normalizedRandom(s * 7.9) * 0.08;
    const direction = normalizedRandom(s * 2.7) * Math.PI * 2;
    return {
      x: normalizedRandom(s * 1.11) * width,
      y: normalizedRandom(s * 1.77) * height,
      vx: Math.cos(direction) * speed,
      vy: Math.sin(direction) * speed,
      size: 8 + normalizedRandom(s * 3.33) * 14,
      angle: normalizedRandom(s * 4.4) * Math.PI * 2,
      spin: (normalizedRandom(s * 5.8) - 0.5) * 0.0014,
      opacity: 0.08 + normalizedRandom(s * 6.6) * 0.16,
    };
  });
}

export function CoffeeBeanBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let rafId = 0;
    let running = true;

    const pointer = { x: 0, y: 0, active: false };
    let beans: BeanParticle[] = [];

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const beanCount = width <= MOBILE_BREAKPOINT ? MOBILE_BEANS : DESKTOP_BEANS;
      beans = createBeans(beanCount, width, height);
    };

    const drawBean = (bean: BeanParticle) => {
      ctx.save();
      ctx.translate(bean.x, bean.y);
      ctx.rotate(bean.angle);

      const w = bean.size;
      const h = bean.size * 1.45;

      ctx.fillStyle = `rgba(71, 38, 18, ${bean.opacity.toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, w * 0.55, h * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(34, 16, 8, ${(bean.opacity * 1.2).toFixed(3)})`;
      ctx.lineWidth = Math.max(1, w * 0.08);
      ctx.beginPath();
      ctx.moveTo(0, -h * 0.34);
      ctx.quadraticCurveTo(-w * 0.2, 0, 0, h * 0.34);
      ctx.stroke();

      ctx.restore();
    };

    const frame = () => {
      if (!running) return;

      ctx.clearRect(0, 0, width, height);

      for (const bean of beans) {
        if (!reducedMotion) {
          if (pointer.active) {
            const dx = bean.x - pointer.x;
            const dy = bean.y - pointer.y;
            const distanceSq = dx * dx + dy * dy;
            if (distanceSq > 1 && distanceSq < 230 * 230) {
              const distance = Math.sqrt(distanceSq);
              const force = (230 - distance) / 230;
              const ux = dx / distance;
              const uy = dy / distance;
              bean.vx += ux * force * 0.0022;
              bean.vy += uy * force * 0.0017;
            }
          }

          bean.x += bean.vx;
          bean.y += bean.vy;
          bean.angle += bean.spin;

          bean.vx *= 0.995;
          bean.vy *= 0.995;

          if (bean.x < -30) bean.x = width + 30;
          else if (bean.x > width + 30) bean.x = -30;
          if (bean.y < -30) bean.y = height + 30;
          else if (bean.y > height + 30) bean.y = -30;
        }

        drawBean(bean);
      }

      if (!reducedMotion) {
        rafId = requestAnimationFrame(frame);
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.active = true;
    };

    const onPointerLeave = () => {
      pointer.active = false;
    };

    const onVisibility = () => {
      running = document.visibilityState === "visible";
      if (running && !reducedMotion && !rafId) {
        rafId = requestAnimationFrame(frame);
      }
      if (!running && rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };

    resize();
    frame();

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div class="bean-bg" aria-hidden="true">
      <canvas ref={canvasRef} class="bean-canvas" />
    </div>
  );
}
