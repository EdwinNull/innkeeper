import { useEffect, useRef } from 'react';

/**
 * 隔着压花玻璃看酒馆的酒架。
 * 打烊时只有冷光和瓶身剪影，营业时背后的灯亮起来。
 * 全部在片元着色器里生成，没有图片资源。
 */
const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uUnit;   // 一个场景单位对应的像素
uniform float uFlute;  // 一道棱的像素宽
uniform float uTime;
uniform float uLit;
uniform float uShade;

float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }

vec3 glassColor(float h) {
  if (h < 0.30) return vec3(0.07, 0.19, 0.10);
  if (h < 0.58) return vec3(0.78, 0.36, 0.07);
  if (h < 0.72) return vec3(0.30, 0.045, 0.04);
  if (h < 0.86) return vec3(0.90, 0.62, 0.24);
  return vec3(0.66, 0.62, 0.50);
}

// 一只瓶子：返回遮罩，edge 返回离中线的远近
float bottle(vec2 q, float w, float h, float neck, float shoulder, float soft, out float edge) {
  float t = smoothstep(shoulder * h, shoulder * h + 0.17 * h, q.y);
  float hw = mix(w, neck, t);
  hw += smoothstep(0.945 * h, 0.965 * h, q.y) * neck * 0.3;
  float body = smoothstep(hw + soft, hw - soft, abs(q.x));
  float v = smoothstep(-soft, soft, q.y) * smoothstep(h + soft, h - soft, q.y);
  edge = smoothstep(hw * 0.35, hw, abs(q.x));
  return body * v;
}

const float SHELF = 0.47;
const float FLOOR = 0.045;

vec3 scene(vec2 p, vec2 dim) {
  float flick = 1.0 + 0.014 * sin(uTime * 7.3) + 0.020 * sin(uTime * 2.1 + 1.0);
  vec2 d1 = (p - vec2(dim.x * 0.66, dim.y * 0.56)) * vec2(0.66, 0.94);
  vec2 d2 = (p - vec2(dim.x * 0.26, dim.y * 0.40)) * vec2(0.85, 1.0);
  float glow = (exp(-2.3 * dot(d1, d1)) * 0.96 + exp(-3.4 * dot(d2, d2)) * 0.34) * flick;

  float yy = p.y / dim.y;
  vec3 cold = mix(vec3(0.030, 0.048, 0.046), vec3(0.086, 0.136, 0.136), yy);
  // 打烊后街上偶尔扫过的车灯
  float sweep = fract(uTime * 0.04) * (dim.x + 1.8) - 0.9;
  cold += vec3(0.078, 0.122, 0.132) * exp(-4.0 * (p.x - sweep) * (p.x - sweep)) * (0.35 + 0.65 * yy);
  vec3 warm = mix(vec3(0.055, 0.024, 0.010), vec3(0.94, 0.50, 0.155), glow * glow * 0.90);
  warm += vec3(0.25, 0.115, 0.032) * glow * 0.55;
  vec3 col = mix(cold, warm, uLit);

  // 当前所在的那一层酒架
  float level = floor((p.y - FLOOR) / SHELF);
  float base = FLOOR + level * SHELF;
  float seed = 13.0 + level * 31.0;
  float cw = 0.108 + 0.014 * hash(level + 4.0);
  float id0 = floor(p.x / cw);
  for (int k = -1; k <= 1; k++) {
    float id = id0 + float(k);
    float r = hash(id + seed);
    if (r > 0.90) continue;
    float r2 = hash(id * 1.7 + seed + 3.1);
    float r3 = hash(id * 2.3 + seed + 7.7);
    float cx = (id + 0.5 + (r2 - 0.5) * 0.24) * cw;
    float w = cw * mix(0.28, 0.44, r3);
    float h = mix(0.25, 0.395, r2);
    float neck = w * mix(0.24, 0.40, r);
    float edge;
    float m = bottle(p - vec2(cx, base), w, h, neck, mix(0.50, 0.66, r3), 0.006, edge);
    if (m <= 0.0) continue;
    vec3 tint = glassColor(hash(id * 3.1 + seed + 1.3));
    float lvl = mix(0.30, 0.66, r) * h;
    float liquid = smoothstep(lvl + 0.006, lvl - 0.006, p.y - base);
    vec3 lit = tint * (0.07 + glow * mix(1.45, 1.02, liquid)) + tint * edge * glow * 0.35;
    lit *= 1.0 - 0.55 * smoothstep(0.75, 1.0, edge);
    vec3 off = mix(vec3(0.016, 0.026, 0.025), tint * 0.13, 0.45) + vec3(0.060, 0.098, 0.102) * pow(edge, 3.0) * 0.55;
    vec3 c = mix(off, lit, uLit);
    // 酒标
    float lab = step(abs(p.x - cx), w * 0.74) * step(0.12 * h, p.y - base) * step(p.y - base, 0.34 * h) * step(0.5, r2);
    c = mix(c, mix(vec3(0.085, 0.10, 0.094), vec3(0.72, 0.58, 0.38) * (0.10 + glow * 0.50), uLit), lab * 0.7);
    col = mix(col, c, m);
  }
  // 上一层搁板的底面
  float under = smoothstep(SHELF - 0.022, SHELF - 0.014, p.y - base);
  vec3 wood = mix(vec3(0.014, 0.020, 0.018), vec3(0.150, 0.070, 0.028) * (0.30 + glow * 0.75), uLit);
  col = mix(col, wood, under);

  // 吊灯，挂在最上面
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    vec2 o = vec2(dim.x * (0.12 + 0.19 * fi + 0.04 * hash(fi + 2.0)), dim.y - 0.085 - 0.10 * hash(fi + 5.0));
    o.x += 0.006 * sin(uTime * 0.6 + fi * 1.7);
    float d = length(p - o);
    float rad = 0.020 + 0.010 * hash(fi + 9.0);
    float core = smoothstep(rad, rad * 0.3, d);
    float halo = exp(-d * d * 150.0);
    float pulse = 0.90 + 0.10 * sin(uTime * 1.3 + fi * 2.2);
    col += mix(vec3(0.075, 0.115, 0.115) * core * 0.6, vec3(1.0, 0.76, 0.40) * (core * 1.1 + halo * 0.42) * pulse, uLit);
  }
  return col;
}

void main() {
  vec2 px = gl_FragCoord.xy;
  vec2 uv = px / uRes;
  vec2 dim = uRes / uUnit;
  vec2 p = px / uUnit;

  // 竖向压花：每一道棱是一条柱面透镜，把身后的景物横向压缩
  float u = px.x / uFlute;
  float f = fract(u) - 0.5;
  float fw = uFlute / uUnit;
  float cx = (floor(u) + 0.5) * fw;
  float lens = f * (1.0 + 1.3 * f * f);

  vec3 col = vec3(0.0);
  float total = 0.0;
  float jit = hash2(px) - 0.5;
  for (int i = 0; i < 9; i++) {
    float s = (float(i) - 4.0 + jit) / 4.0;
    float weight = 1.0 - 0.55 * abs(s);
    vec2 q = vec2(cx + (lens * 3.1 + s * 0.42) * fw, p.y + s * 0.009);
    col += scene(q, dim) * weight;
    total += weight;
  }
  col /= total;

  // 棱面明暗与高光
  col *= 1.0 - 0.42 * pow(abs(f) * 2.0, 3.0);
  float spec = exp(-pow((f + 0.22) * 9.5, 2.0));
  col += spec * mix(vec3(0.020, 0.032, 0.033), vec3(0.070, 0.042, 0.018), uLit) * (0.4 + uv.y);
  col *= 1.0 - 0.34 * smoothstep(0.46, 0.5, abs(f));

  // 左下压暗，给文字留出安静的底
  float left = smoothstep(1.04, 0.04, uv.x * 0.84 + uv.y * 0.40);
  col *= 1.0 - 0.80 * left * uShade;
  col *= 1.0 - 0.34 * smoothstep(0.5, 1.2, length((uv - vec2(0.60, 0.52)) * vec2(0.95, 1.1)));

  col = col / (1.0 + col * 0.36);
  col = pow(max(col, 0.0), vec3(0.86));
  col += (hash2(px * 0.7) - 0.5) * 0.010;
  gl_FragColor = vec4(col, 1.0);
}
`;

const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

interface Props {
  lit: boolean;
  /** 每道棱的宽度（CSS 像素） */
  flute?: number;
  /** 场景缩放：一个单位高度对应多少 CSS 像素，缺省为画布高度 */
  unit?: number;
  /** 左下压暗强度 */
  shade?: number;
  className?: string;
}

export function ReededGlass({ lit, flute = 25, unit, shade = 1, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const target = useRef(lit ? 1 : 0);
  const kick = useRef<() => void>(() => undefined);

  useEffect(() => {
    target.current = lit ? 1 : 0;
    kick.current();
  }, [lit]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
    if (!gl) return;

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uni = (name: string) => gl.getUniformLocation(program, name);
    const uRes = uni('uRes');
    const uUnit = uni('uUnit');
    const uFlute = uni('uFlute');
    const uTime = uni('uTime');
    const uLit = uni('uLit');
    gl.uniform1f(uni('uShade'), shade);

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let value = target.current;
    let raf = 0;
    let last = 0;
    let alive = true;

    const resize = () => {
      const scale = Math.min(window.devicePixelRatio, 1.5);
      canvas.width = Math.max(2, Math.round(canvas.clientWidth * scale));
      canvas.height = Math.max(2, Math.round(canvas.clientHeight * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1f(uUnit, unit ? unit * scale : canvas.height);
      gl.uniform1f(uFlute, flute * scale);
    };

    const draw = (now: number) => {
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, still ? 12 : now / 1000);
      gl.uniform1f(uLit, value);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const loop = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      // 30 帧足够，省电
      if (now - last < 32) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      value += (target.current - value) * (1 - Math.exp(-dt * 1.7));
      draw(now);
    };

    const start = () => {
      cancelAnimationFrame(raf);
      if (still) {
        value = target.current;
        draw(0);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    kick.current = start;

    const observer = new ResizeObserver(() => {
      resize();
      draw(performance.now());
    });
    observer.observe(canvas);
    const onVisibility = () => (document.hidden ? cancelAnimationFrame(raf) : start());
    document.addEventListener('visibilitychange', onVisibility);
    resize();
    start();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [flute, unit, shade]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
