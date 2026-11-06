import type { Lut3D } from '../core/lut';
import { presetAdjust, presetById } from '../core/looks';
import type { Adjust, Look } from '../core/schema';

/**
 * Renk motoru: tek WebGL2 gölgelendiricisi.
 * Sıra: keskinlik → kamera dönüşümü LUT'u → elle ayarlar → hazır görünüm (yoğunlukla) → yaratıcı LUT.
 * Aynı kod tarayıcı önizlemesinde ve Remotion render'ında çalışır.
 */
const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSrc;
uniform sampler3D uCam;
uniform sampler3D uLut;
uniform float uCamOn;
uniform float uCamSize;
uniform float uLutAmt;
uniform float uLutSize;
uniform vec2 uTexel;
uniform float uSharp;
uniform float uA[10];
uniform float uP[10];
uniform float uPAmt;
uniform vec3 uShadowTint;
uniform vec3 uHighTint;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 lut3(sampler3D s, float n, vec3 c) {
  vec3 uvw = clamp(c, 0.0, 1.0) * ((n - 1.0) / n) + 0.5 / n;
  return texture(s, uvw).rgb;
}

// a: exposure, contrast, highlights, shadows, temp, tint, vibrance, saturation, fade, (boş)
vec3 adjust(vec3 c, float a[10]) {
  vec3 l = pow(max(c, 0.0), vec3(2.2));
  l *= exp2(a[0]);
  l *= vec3(1.0 + 0.16 * a[4] + 0.04 * a[5], 1.0 - 0.10 * a[5], 1.0 - 0.18 * a[4] + 0.04 * a[5]);
  c = pow(max(l, 0.0), vec3(1.0 / 2.2));
  float y = luma(c);
  float shM = 1.0 - smoothstep(0.0, 0.5, y);
  float hiM = smoothstep(0.5, 1.0, y);
  c += vec3(a[3] * 0.28 * shM);
  c += vec3(a[2] * 0.28 * hiM);
  c = (c - 0.5) * (1.0 + a[1] * 0.85) + 0.5;
  y = luma(c);
  float s = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
  float satK = 1.0 + a[7] + a[6] * (1.0 - clamp(s * 1.6, 0.0, 1.0));
  c = mix(vec3(y), c, max(satK, 0.0));
  c = c * (1.0 - 0.14 * a[8]) + 0.085 * a[8];
  return c;
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec3 c = texture(uSrc, uv).rgb;
  if (uSharp > 0.001) {
    vec3 n = texture(uSrc, uv + vec2(uTexel.x, 0.0)).rgb + texture(uSrc, uv - vec2(uTexel.x, 0.0)).rgb
           + texture(uSrc, uv + vec2(0.0, uTexel.y)).rgb + texture(uSrc, uv - vec2(0.0, uTexel.y)).rgb;
    c += (c - n * 0.25) * uSharp * 1.8;
  }
  c = clamp(c, 0.0, 1.0);
  if (uCamOn > 0.5) c = lut3(uCam, uCamSize, c);
  c = clamp(adjust(c, uA), 0.0, 1.0);
  if (uPAmt > 0.001) {
    vec3 p = adjust(c, uP);
    float y = clamp(luma(p), 0.0, 1.0);
    p += uShadowTint * (1.0 - y) * (1.0 - y) * 0.16 + uHighTint * y * y * 0.12;
    c = mix(c, clamp(p, 0.0, 1.0), uPAmt);
  }
  if (uLutAmt > 0.001) c = mix(c, lut3(uLut, uLutSize, c), uLutAmt);
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const adjustArray = (a: Adjust) => [
  a.exposure, a.contrast, a.highlights, a.shadows, a.temp, a.tint, a.vibrance, a.saturation, a.fade, 0,
];

export type GradeInput = { look: Look; camLut: Lut3D | null; lut: Lut3D | null };

export class Grader {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private srcTex: WebGLTexture;
  private camTex: WebGLTexture;
  private lutTex: WebGLTexture;
  private camLoaded: Lut3D | null = null;
  private lutLoaded: Lut3D | null = null;
  private loc: Record<string, WebGLUniformLocation | null> = {};

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false });
    if (!gl) throw new Error('WebGL2 kullanılamıyor');
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    this.prog = prog;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['uSrc', 'uCam', 'uLut', 'uCamOn', 'uCamSize', 'uLutAmt', 'uLutSize', 'uTexel', 'uSharp', 'uA', 'uP', 'uPAmt', 'uShadowTint', 'uHighTint'])
      this.loc[n] = gl.getUniformLocation(prog, n);
    this.srcTex = gl.createTexture()!;
    this.camTex = this.make3D();
    this.lutTex = this.make3D();
  }

  private make3D() {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, t);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, 2, 2, 2, 0, gl.RGBA, gl.FLOAT, identity2());
    return t;
  }

  private upload3D(tex: WebGLTexture, lut: Lut3D) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, lut.size, lut.size, lut.size, 0, gl.RGBA, gl.FLOAT, lut.data);
  }

  draw(source: TexImageSource, srcW: number, srcH: number, input: GradeInput) {
    const gl = this.gl;
    const { look } = input;
    if (input.camLut && input.camLut !== this.camLoaded) {
      this.upload3D(this.camTex, input.camLut);
      this.camLoaded = input.camLut;
    }
    if (input.lut && input.lut !== this.lutLoaded) {
      this.upload3D(this.lutTex, input.lut);
      this.lutLoaded = input.lut;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.camTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    const L = this.loc;
    gl.uniform1i(L.uSrc, 0);
    gl.uniform1i(L.uCam, 1);
    gl.uniform1i(L.uLut, 2);
    gl.uniform1f(L.uCamOn, input.camLut ? 1 : 0);
    gl.uniform1f(L.uCamSize, input.camLut?.size ?? 2);
    gl.uniform1f(L.uLutAmt, input.lut ? look.lutIntensity : 0);
    gl.uniform1f(L.uLutSize, input.lut?.size ?? 2);
    // Keskinlik çıktıdaki piksel ölçeğinde: kaynak/çizim oranına göre komşu mesafesi
    gl.uniform2f(L.uTexel, Math.max(1, srcW / this.canvas.width) / srcW, Math.max(1, srcH / this.canvas.height) / srcH);
    gl.uniform1f(L.uSharp, look.adjust.sharpen);
    gl.uniform1fv(L.uA, adjustArray(look.adjust));
    const preset = presetById(look.preset);
    gl.uniform1fv(L.uP, adjustArray(presetAdjust(look.preset)));
    gl.uniform1f(L.uPAmt, preset.id === 'dogal' ? 0 : look.intensity);
    gl.uniform3fv(L.uShadowTint, preset.shadowTint ?? [0, 0, 0]);
    gl.uniform3fv(L.uHighTint, preset.highlightTint ?? [0, 0, 0]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

const identity2 = () => {
  const d = new Float32Array(2 * 2 * 2 * 4);
  let j = 0;
  for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) {
    d[j++] = r;
    d[j++] = g;
    d[j++] = b;
    d[j++] = 1;
  }
  return d;
};
