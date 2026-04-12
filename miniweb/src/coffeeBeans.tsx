import { useEffect, useRef } from "preact/hooks";

type BeanParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  baseSize: number;
  angle: number;
  spin: number;
  opacity: number;
  roastProgress: number;
  roastSpeed: number;
};

type AvoidRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

const MAX_DPR = 1.5;
const DESKTOP_BEANS = 96;
const MOBILE_BEANS = 36;
const MOBILE_BREAKPOINT = 880;
const OBSTACLE_MARGIN = 24;
const OBSTACLE_INFLUENCE_RADIUS = 96;
const BEAN_REPULSION_RADIUS = 52;
const BEAN_REPULSION_STRENGTH = 0.0019;
const LAYOUT_REFILL_RATIO = 0.26;
const CRUMBLE_START = 0.82;

function normalizedRandom(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function createBeans(count: number, width: number, height: number): BeanParticle[] {
  return Array.from({ length: count }, (_, index) => {
    const s = index + 1;
    const speed = 0.03 + normalizedRandom(s * 7.9) * 0.08;
    const direction = normalizedRandom(s * 2.7) * Math.PI * 2;
    const baseSize = 8 + normalizedRandom(s * 3.33) * 14;
    return {
      x: normalizedRandom(s * 1.11) * width,
      y: normalizedRandom(s * 1.77) * height,
      vx: Math.cos(direction) * speed,
      vy: Math.sin(direction) * speed,
      size: baseSize,
      baseSize,
      angle: normalizedRandom(s * 4.4) * Math.PI * 2,
      spin: (normalizedRandom(s * 5.8) - 0.5) * 0.0014,
      opacity: 0.08 + normalizedRandom(s * 6.6) * 0.16,
      roastProgress: normalizedRandom(s * 8.1),
      roastSpeed: 0.0005 + normalizedRandom(s * 9.2) * 0.0011,
    };
  });
}

function isInsideAvoidRect(x: number, y: number, avoidRects: AvoidRect[]) {
  return avoidRects.some((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
}

function randomOpenPosition(width: number, height: number, avoidRects: AvoidRect[]) {
  for (let i = 0; i < 16; i += 1) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    if (!isInsideAvoidRect(x, y, avoidRects)) return { x, y };
  }
  return { x: Math.random() * width, y: Math.random() * height };
}

function refillBeans(beans: BeanParticle[], width: number, height: number, avoidRects: AvoidRect[]) {
  const moved = Math.max(1, Math.floor(beans.length * LAYOUT_REFILL_RATIO));
  for (let i = 0; i < moved; i += 1) {
    const bean = beans[(i * 7) % beans.length];
    const pos = randomOpenPosition(width, height, avoidRects);
    bean.x = pos.x;
    bean.y = pos.y;
    bean.vx *= 0.45;
    bean.vy *= 0.45;
  }
}

function resetBean(bean: BeanParticle, width: number, height: number, avoidRects: AvoidRect[]) {
  const pos = randomOpenPosition(width, height, avoidRects);
  const direction = Math.random() * Math.PI * 2;
  const speed = 0.02 + Math.random() * 0.08;
  bean.x = pos.x;
  bean.y = pos.y;
  bean.vx = Math.cos(direction) * speed;
  bean.vy = Math.sin(direction) * speed;
  bean.size = bean.baseSize;
  bean.roastProgress = 0;
}

function mixChannel(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t);
}

function beanFill(bean: BeanParticle) {
  const t = bean.roastProgress;
  const phase = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
  const from = t < 0.5 ? [84, 178, 74] : [214, 187, 63];
  const to = t < 0.5 ? [214, 187, 63] : [86, 47, 23];
  const crumble = t <= CRUMBLE_START ? 0 : (t - CRUMBLE_START) / (1 - CRUMBLE_START);
  const alpha = bean.opacity * (1 - crumble);
  const r = mixChannel(from[0], to[0], phase);
  const g = mixChannel(from[1], to[1], phase);
  const b = mixChannel(from[2], to[2], phase);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

function beanCrease(bean: BeanParticle) {
  const t = bean.roastProgress;
  const phase = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
  const from = t < 0.5 ? [43, 110, 40] : [123, 93, 30];
  const to = t < 0.5 ? [123, 93, 30] : [38, 19, 9];
  const crumble = t <= CRUMBLE_START ? 0 : (t - CRUMBLE_START) / (1 - CRUMBLE_START);
  const alpha = bean.opacity * 1.2 * (1 - crumble);
  const r = mixChannel(from[0], to[0], phase);
  const g = mixChannel(from[1], to[1], phase);
  const b = mixChannel(from[2], to[2], phase);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
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

function applyObstacleRepulsion(bean: BeanParticle, avoidRects: AvoidRect[]) {
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
      bean.vx += (dx / distance) * strength * 0.014;
      bean.vy += (dy / distance) * strength * 0.014;
      continue;
    }

    const toLeft = Math.abs(bean.x - rect.left);
    const toRight = Math.abs(rect.right - bean.x);
    const toTop = Math.abs(bean.y - rect.top);
    const toBottom = Math.abs(rect.bottom - bean.y);

    const minEdge = Math.min(toLeft, toRight, toTop, toBottom);
    const escapeImpulse = 0.07;

    if (minEdge === toLeft) bean.vx -= escapeImpulse;
    else if (minEdge === toRight) bean.vx += escapeImpulse;
    else if (minEdge === toTop) bean.vy -= escapeImpulse;
    else bean.vy += escapeImpulse;
  }
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

    const frame = () => {
      if (!running) return;

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
            const force = ((BEAN_REPULSION_RADIUS - distance) / BEAN_REPULSION_RADIUS) * BEAN_REPULSION_STRENGTH;
            const ux = dx / distance;
            const uy = dy / distance;
            a.vx += ux * force;
            a.vy += uy * force;
            b.vx -= ux * force;
            b.vy -= uy * force;
          }
        }
      }

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

          applyObstacleRepulsion(bean, avoidRects);

          bean.x += bean.vx;
          bean.y += bean.vy;
          bean.angle += bean.spin;

          bean.vx *= 0.995;
          bean.vy *= 0.995;
          bean.roastProgress += bean.roastSpeed;
          if (bean.roastProgress > CRUMBLE_START) {
            const crumble = (bean.roastProgress - CRUMBLE_START) / (1 - CRUMBLE_START);
            bean.size = bean.baseSize * (1 - Math.min(0.7, crumble * 0.7));
            bean.vx *= 0.985;
            bean.vy += 0.0009 * crumble;
            bean.spin *= 1 + crumble * 0.03;
          } else {
            bean.size = bean.baseSize;
          }

          if (bean.roastProgress >= 1) {
            resetBean(bean, width, height, avoidRects);
          }

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
