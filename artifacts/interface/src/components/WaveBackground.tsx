import { useEffect, useRef } from "react";

const VERT = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;

uniform vec2  u_res;
uniform float u_time;
uniform vec3  u_color;
uniform float u_dpr;

// Distance to a sine wave y = amp * sin(k*x + phase) + offsetY
float waveLine(vec2 p, float amp, float k, float phase, float offsetY, float thickness) {
  float y     = amp * sin(k * p.x + phase) + offsetY;
  float dy    = abs(p.y - y);
  // Account for slope so thickness reads consistent regardless of steepness.
  float slope = amp * k * cos(k * p.x + phase);
  float d     = dy / sqrt(1.0 + slope * slope);
  return 1.0 - smoothstep(thickness * 0.5, thickness * 0.5 + 1.5, d);
}

void main() {
  vec2 p = gl_FragCoord.xy / u_dpr;
  float t = u_time;

  // Three drifting sine waves at different scales / speeds / vertical bands.
  float h = u_res.y / u_dpr;
  float w1 = waveLine(p, 22.0, 0.0070, t * 0.45,  h * 0.32, 1.6);
  float w2 = waveLine(p, 30.0, 0.0050, t * 0.30 + 1.7, h * 0.52, 1.6);
  float w3 = waveLine(p, 18.0, 0.0090, t * 0.60 + 3.4, h * 0.72, 1.4);

  float w = max(max(w1, w2), w3);

  // Horizontal fade in from left/right edges.
  float xFade = smoothstep(0.0, 0.18, p.x / (u_res.x / u_dpr))
              * smoothstep(0.0, 0.18, 1.0 - p.x / (u_res.x / u_dpr));

  float a = w * 0.22 * xFade;
  gl_FragColor = vec4(u_color, a);
}
`;

export default function WaveBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const gl =
      canvas.getContext("webgl", { premultipliedAlpha: false, antialias: true }) ||
      canvas.getContext("experimental-webgl");
    if (!gl) return;
    const glc = gl as WebGLRenderingContext;

    const compile = (type: number, src: string) => {
      const s = glc.createShader(type)!;
      glc.shaderSource(s, src);
      glc.compileShader(s);
      if (!glc.getShaderParameter(s, glc.COMPILE_STATUS)) {
        console.warn(glc.getShaderInfoLog(s));
      }
      return s;
    };

    const vs = compile(glc.VERTEX_SHADER, VERT);
    const fs = compile(glc.FRAGMENT_SHADER, FRAG);
    const prog = glc.createProgram()!;
    glc.attachShader(prog, vs);
    glc.attachShader(prog, fs);
    glc.linkProgram(prog);
    glc.useProgram(prog);

    const buf = glc.createBuffer();
    glc.bindBuffer(glc.ARRAY_BUFFER, buf);
    glc.bufferData(
      glc.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      glc.STATIC_DRAW,
    );
    const aPos = glc.getAttribLocation(prog, "a_pos");
    glc.enableVertexAttribArray(aPos);
    glc.vertexAttribPointer(aPos, 2, glc.FLOAT, false, 0, 0);

    glc.enable(glc.BLEND);
    glc.blendFunc(glc.SRC_ALPHA, glc.ONE_MINUS_SRC_ALPHA);

    const uRes = glc.getUniformLocation(prog, "u_res");
    const uTime = glc.getUniformLocation(prog, "u_time");
    const uColor = glc.getUniformLocation(prog, "u_color");
    const uDpr = glc.getUniformLocation(prog, "u_dpr");

    glc.uniform3f(uColor, 0.18, 0.45, 1.0);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    glc.uniform1f(uDpr, dpr);

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const W = Math.max(1, Math.floor(w * dpr));
      const H = Math.max(1, Math.floor(h * dpr));
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
        glc.viewport(0, 0, W, H);
        glc.uniform2f(uRes, W, H);
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const start = performance.now();
    let raf = 0;
    let running = true;

    const render = () => {
      if (!running) return;
      const tSec = (performance.now() - start) / 1000;
      glc.uniform1f(uTime, reduceMotion ? 0 : tSec);
      glc.clearColor(0, 0, 0, 0);
      glc.clear(glc.COLOR_BUFFER_BIT);
      glc.drawArrays(glc.TRIANGLES, 0, 3);
      if (!reduceMotion) raf = requestAnimationFrame(render);
    };
    render();

    const onVis = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!reduceMotion) {
        running = true;
        render();
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
