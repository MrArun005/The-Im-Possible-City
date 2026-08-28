/**
 * The film grade (Task 3.6) and the district's colour identity (§3.2 `grade`)
 * are the same pass: filmic tonemap, LUT-style lift/tint, vignette, grain and
 * chromatic aberration at the edges. Everything is uniform-driven so a district
 * swap is a tween, not a rebuild.
 */
export const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uExposure: { value: 1.0 },
    uTint: { value: null },        // Color, multiplied
    uLift: { value: null },        // Color, added into the shadows
    uSaturation: { value: 1.0 },
    uContrast: { value: 1.06 },
    uVignette: { value: 1.0 },
    uGrain: { value: 0.035 },
    uChromatic: { value: 0.0012 },
    uTime: { value: 0 },
    uFade: { value: 0.0 },         // 1 = full black, used for district cuts
    uFadeColor: { value: null },
    uAspect: { value: 1.0 },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    precision highp float;

    uniform sampler2D tDiffuse;
    uniform float uExposure;
    uniform vec3  uTint;
    uniform vec3  uLift;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uChromatic;
    uniform float uTime;
    uniform float uFade;
    uniform vec3  uFadeColor;
    uniform float uAspect;

    varying vec2 vUv;

    // Narkowicz ACES approximation - cheap, and it rolls highlights instead of
    // clipping them, which is what makes gaslight and neon read as "filmed".
    vec3 aces(vec3 x) {
      return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    }

    vec3 linearToSRGB(vec3 c) {
      return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(0.4166667)) - 0.055,
                 step(0.0031308, c));
    }

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec2 uv = vUv;
      vec2 fromCenter = uv - 0.5;
      float r2 = dot(fromCenter, fromCenter);

      // Chromatic aberration: zero in the middle, only bites at the edges.
      vec3 color;
      if (uChromatic > 0.0) {
        vec2 offset = fromCenter * uChromatic * r2 * 40.0;
        color.r = texture2D(tDiffuse, uv + offset).r;
        color.g = texture2D(tDiffuse, uv).g;
        color.b = texture2D(tDiffuse, uv - offset).b;
      } else {
        color = texture2D(tDiffuse, uv).rgb;
      }

      color *= uExposure;
      color = aces(color);

      // Grade: lift the shadows toward the district's colour, then tint.
      color += uLift * (1.0 - smoothstep(0.0, 0.55, dot(color, vec3(0.333))));
      color *= uTint;

      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luma), color, uSaturation);
      color = (color - 0.5) * uContrast + 0.5;

      // Vignette
      float vig = smoothstep(0.95, 0.22, r2 * 1.85);
      color *= mix(1.0, vig, uVignette);

      // Film grain, slightly stronger in the shadows where film actually grains.
      float grain = hash(uv * vec2(1024.0 * uAspect, 1024.0) + fract(uTime) * 91.7) - 0.5;
      color += grain * uGrain * (1.25 - luma);

      color = max(color, vec3(0.0));
      color = mix(color, uFadeColor, uFade);

      gl_FragColor = vec4(linearToSRGB(color), 1.0);
    }
  `,
};
