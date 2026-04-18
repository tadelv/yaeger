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
  life: number;
  maxLife: number;
  driftSeed: number;
};

type AvoidRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

const MAX_DPR = 1.5;
const DESKTOP_BEANS = 72;
const MOBILE_BEANS = 40;
const MOBILE_BREAKPOINT = 880;
const OBSTACLE_MARGIN = 26;
const OBSTACLE_INFLUENCE_RADIUS = 110;
const POINTER_RADIUS = 230;
const BEAN_REPULSION_RADIUS = 42;
const BEAN_REPULSION_STRENGTH = 0.0008;
const LAYOUT_REFILL_RATIO = 0.32;
const BOTTOM_SPAWN_BAND = 90;
const OFFSCREEN_PADDING = 54;

function normalizedRandom(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function randomRange(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function mixChannel(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t);
}

function isInsideAvoidRect(x: number, y: number, avoidRects: AvoidRect[]) {
  return avoidRects.some((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
}

function randomOpenPosition(width: number, height: number, avoidRects: AvoidRect[]) {
  for (let i = 0; i < 24; i += 1) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    if (!isInsideAvoidRect(x, y, avoidRects)) return { x, y };
  }
  return { x: Math.random() * width, y: Math.random() * height };
}

function spawnPosition(width: number, height: number, avoidRects: AvoidRect[], fromBottom: boolean) {
  if (!fromBottom) return randomOpenPosition(width, height, avoidRects);

  for (let i = 0; i < 24; i += 1) {
    const x = Math.random() * width;
    const y = height + randomRange(8, BOTTOM_SPAWN_BAND);
    if (!isInsideAvoidRect(x, Math.min(y, height - 1), avoidRects)) return { x, y };
  }

  return { x: Math.random() * width, y: height + randomRange(8, BOTTOM_SPAWN_BAND) };
}

function createBean(width: number, height: number, avoidRects: AvoidRect[], index: number, fromBottom = false): BeanParticle {
  const s = index + 1 + Math.random() * 17;
  const pos = spawnPosition(width, height, avoidRects, fromBottom);
  const size = 8 + normalizedRandom(s * 3.33) * 14;
  const maxLife = 950 + normalizedRandom(s * 9.2) * 1050;

  return {
    x: pos.x,
    y: pos.y,
    vx: randomRange(-0.08, 0.08),
    vy: randomRange(-0.08, -0.025),
    size,
    angle: normalizedRandom(s * 4.4) * Math.PI * 2,
    spin: (normalizedRandom(s * 5.8) - 0.5) * 0.004,
    opacity: 0.08 + normalizedRandom(s * 6.6) * 0.17,
    life: fromBottom ? 0 : randomRange(maxLife * 0.08, maxLife * 0.7),
    maxLife,
    driftSeed: normalizedRandom(s * 10.7) * Math.PI * 2,
  };
}

function createBeans(count: number, width: number, height: number, avoidRects: AvoidRect[]): BeanParticle[] {
  return Array.from({ length: count }, (_, index) => createBean(width, height, avoidRects, index));
}

function refillBeans(beans: BeanParticle[], width: number, height: number, avoidRects: AvoidRect[]) {
  const moved = Math.max(1, Math.floor(beans.length * LAYOUT_REFILL_RATIO));
  for (let i = 0; i < moved; i += 1) {
    const index = (i * 7) % beans.length;
    beans[index] = createBean(width, height, avoidRects, index);
  }
}

function getAvoidRects(): AvoidRect[] {
  const nodes = document.querySelectorAll<HTMLElement>(".tabs-nav, .tab-content");
  return Array.from(nodes)
    .map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left - OBSTACLE_MARGIN,
        right: rect.right + OBSTACLE_MARGIN,
        top: rect.top - OBSTACLE_MARGIN,
        bottom: rect.bottom + OBSTACLE_MARGIN,
      };
    })
    .filter((rect) => rect.right > 0 && rect.left < window.innerWidth && rect.bottom > 0 && rect.top < window.innerHeight);
}

function colorBetween(a: [number, number, number], b: [number, number, number], t: number) {
  return [mixChannel(a[0], b[0], t), mixChannel(a[1], b[1], t), mixChannel(a[2], b[2], t)] as const;
}

function roastColor(roastProgress: number) {
  const green: [number, number, number] = [126, 166, 79];
  const yellow: [number, number, number] = [219, 181, 70];
  const brown: [number, number, number] = [78, 39, 18];

  if (roastProgress < 0.38) {
    return colorBetween(green, yellow, roastProgress / 0.38);
  }

  return colorBetween(yellow, brown, (roastProgress - 0.38) / 0.62);
}

function beanOpacity(bean: BeanParticle) {
  const progress = bean.life / bean.maxLife;
  const fadeIn = smoothstep(0, 0.12, progress);
  const fadeOut = 1 - smoothstep(0.72, 1, progress);
  return bean.opacity * fadeIn * fadeOut;
}

function beanFill(bean: BeanParticle) {
  const progress = Math.max(0, Math.min(1, bean.life / bean.maxLife));
  const [r, g, b] = roastColor(progress);
  return `rgba(${r}, ${g}, ${b}, ${beanOpacity(bean).toFixed(3)})`;
}

function beanCrease(bean: BeanParticle) {
  const progress = Math.max(0, Math.min(1, bean.life / bean.maxLife));
  const [r, g, b] = roastColor(progress);
  return `rgba(${Math.round(r * 0.46)}, ${Math.round(g * 0.43)}, ${Math.round(b * 0.46)}, ${(beanOpacity(bean) * 1.35).toFixed(3)})`;
}

function applyObstacleRepulsion(bean: BeanParticle, avoidRects: AvoidRect[], dt: number) {
  for (const rect of avoidRects) {
    const closestX = Math.max(rect.left, Math.min(bean.x, rect.right));
    const closestY = Math.max(rect.top, Math.min(bean.y, rect.bottom));
    const dx = bean.x - closestX;
    const dy = bean.y - closestY;
    const distanceSq = dx * dx + dy * dy;

    if (distanceSq > OBSTACLE_INFLUENCE_RADIUS * OBSTACLE_INFLUENCE_RADIUS) {
      continue;
    }

    if (distanceSq > 1) {
      const distance = Math.sqrt(distanceSq);
      const strength = (OBSTACLE_INFLUENCE_RADIUS - distance) / OBSTACLE_INFLUENCE_RADIUS;
      bean.vx += (dx / distance) * strength * 0.02 * dt;
      bean.vy += (dy / distance) * strength * 0.02 * dt;
      continue;
    }

    const toLeft = Math.abs(bean.x - rect.left);
    const toRight = Math.abs(rect.right - bean.x);
    const toTop = Math.abs(bean.y - rect.top);
    const toBottom = Math.abs(rect.bottom - bean.y);
    const minEdge = Math.min(toLeft, toRight, toTop, toBottom);
    const escapeImpulse = 0.1 * dt;

    if (minEdge === toLeft) bean.vx -= escapeImpulse;
    else if (minEdge === toRight) bean.vx += escapeImpulse;
    else if (minEdge === toTop) bean.vy -= escapeImpulse;
    else bean.vy += escapeImpulse;
  }
}

function limitSpeed(bean: BeanParticle) {
  const maxSpeed = 1.2;
  const speed = Math.hypot(bean.vx, bean.vy);
  if (speed <= maxSpeed) return;
  bean.vx = (bean.vx / speed) * maxSpeed;
  bean.vy = (bean.vy / speed) * maxSpeed;
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
    let layoutSignature = "";
    let lastFrameAt = performance.now();
    let frameCount = 0;

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

      const avoidRects = getAvoidRects();
      const beanCount = width <= MOBILE_BREAKPOINT ? MOBILE_BEANS : DESKTOP_BEANS;
      beans = createBeans(beanCount, width, height, avoidRects);
      layoutSignature = "";
    };

    const drawBean = (bean: BeanParticle) => {
      const opacity = beanOpacity(bean);
      if (opacity <= 0.001) return;

      ctx.save();
      ctx.translate(bean.x, bean.y);
      ctx.rotate(bean.angle);

      const w = bean.size;
      const h = bean.size * 1.45;

      ctx.fillStyle = beanFill(bean);
      ctx.beginPath();
      ctx.ellipse(0, 0, w * 0.55, h * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = beanCrease(bean);
      ctx.lineWidth = Math.max(1, w * 0.08);
      ctx.beginPath();
      ctx.moveTo(0, -h * 0.34);
      ctx.quadraticCurveTo(-w * 0.2, 0, 0, h * 0.34);
      ctx.stroke();

      ctx.restore();
    };

    const frame = (now = performance.now()) => {
      if (!running) return;

      const dt = Math.min(2.5, Math.max(0.35, (now - lastFrameAt) / 16.67));
      lastFrameAt = now;
      frameCount += 1;

      ctx.clearRect(0, 0, width, height);
      const avoidRects = getAvoidRects();
      const nextSignature = avoidRects
        .map((rect) => `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.right)}:${Math.round(rect.bottom)}`)
        .join("|");
      if (nextSignature !== layoutSignature) {
        layoutSignature = nextSignature;
        refillBeans(beans, width, height, avoidRects);
      }

      if (!reducedMotion) {
        for (let i = 0; i < beans.length; i += 1) {
          for (let j = i + 1; j < beans.length; j += 1) {
            const a = beans[i];
            const b = beans[j];
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const distanceSq = dx * dx + dy * dy;
            if (distanceSq < 1 || distanceSq > BEAN_REPULSION_RADIUS * BEAN_REPULSION_RADIUS) continue;
            const distance = Math.sqrt(distanceSq);
            const force = ((BEAN_REPULSION_RADIUS - distance) / BEAN_REPULSION_RADIUS) * BEAN_REPULSION_STRENGTH * dt;
            const ux = dx / distance;
            const uy = dy / distance;
            a.vx += ux * force;
            a.vy += uy * force;
            b.vx -= ux * force;
            b.vy -= uy * force;
          }
        }
      }

      for (let i = 0; i < beans.length; i += 1) {
        const bean = beans[i];

        if (!reducedMotion) {
          if (pointer.active) {
            const dx = bean.x - pointer.x;
            const dy = bean.y - pointer.y;
            const distanceSq = dx * dx + dy * dy;
            if (distanceSq > 1 && distanceSq < POINTER_RADIUS * POINTER_RADIUS) {
              const distance = Math.sqrt(distanceSq);
              const force = (POINTER_RADIUS - distance) / POINTER_RADIUS;
              const ux = dx / distance;
              const uy = dy / distance;
              bean.vx += ux * force * 0.018 * dt;
              bean.vy += uy * force * 0.014 * dt;
            }
          }

          applyObstacleRepulsion(bean, avoidRects, dt);

          const progress = Math.max(0, Math.min(1, bean.life / bean.maxLife));
          const updraft = 0.0045 + (1 - progress) * 0.0016;
          const sidewaysDraft = Math.sin(frameCount * 0.012 + bean.driftSeed) * 0.0024;
          bean.vx += sidewaysDraft * dt;
          bean.vy -= updraft * dt;

          bean.x += bean.vx * dt;
          bean.y += bean.vy * dt;
          bean.angle += bean.spin * dt;
          bean.life += dt;

          bean.vx *= Math.pow(0.988, dt);
          bean.vy *= Math.pow(0.988, dt);
          limitSpeed(bean);

          if (bean.x < -OFFSCREEN_PADDING) bean.x = width + OFFSCREEN_PADDING;
          else if (bean.x > width + OFFSCREEN_PADDING) bean.x = -OFFSCREEN_PADDING;
          if (bean.y < -OFFSCREEN_PADDING || bean.life >= bean.maxLife) {
            beans[i] = createBean(width, height, avoidRects, i, true);
            continue;
          }
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
        lastFrameAt = performance.now();
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
