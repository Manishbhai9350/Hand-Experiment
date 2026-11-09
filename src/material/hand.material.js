import * as THREE from "three";

const vertexShader = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    vUv = uv;

    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <defaultnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    #include <project_vertex>

    vNormal = normalize(transformedNormal);
    vViewDir = normalize(-mvPosition.xyz);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uBaseColor;
  uniform vec3 uFresnelColor;
  uniform vec3 uGradientColor;

  uniform float uFresnelPower;
  uniform float uFresnelIntensity;
  uniform float uFresnelStart;
  uniform float uFresnelEnd;

  uniform float uGradientStart;
  uniform float uGradientEnd;
  uniform float uGradientCurve;
  uniform float uGradientStrength;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(vViewDir);

    // 0 = right side of the hand, 1 = fingertips
    float distanceX = clamp(1.0 - vUv.x, 0.0, 1.0);

    // ---- Fresnel (fades to zero along X) ----
    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), uFresnelPower);
    fresnel = clamp(fresnel * uFresnelIntensity, 0.0, 1.0);
    fresnel *= 1.0 - smoothstep(uFresnelStart, uFresnelEnd, distanceX);

    // ---- Gradient (rises along X) ----
    float gradient = smoothstep(uGradientStart, uGradientEnd, distanceX);
    gradient = pow(gradient, uGradientCurve) * uGradientStrength;

    // ---- Combine: whichever is stronger wins ----
    vec3 fresnelCol = uFresnelColor * fresnel;
    vec3 gradientCol = uGradientColor * gradient;
    vec3 color = uBaseColor + max(fresnelCol, gradientCol);

    gl_FragColor = vec4(color, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createHandMaterial(options = {}, pane = null) {
  const {
    baseColor = "#000000",
    fresnelColor = "#ffffff",
    gradientColor = "#ffffff",
    fresnelPower = 3.87,
    fresnelIntensity = 0.33,
    fresnelStart = 0.57,
    fresnelEnd = 0.98,
    gradientStart = 0.27,
    gradientEnd = 1.0,
    gradientCurve = 10.0,
    gradientStrength = 1.0,
  } = options;

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uBaseColor: { value: new THREE.Color(baseColor) },
      uFresnelColor: { value: new THREE.Color(fresnelColor) },
      uGradientColor: { value: new THREE.Color(gradientColor) },
      uFresnelPower: { value: fresnelPower },
      uFresnelIntensity: { value: fresnelIntensity },
      uFresnelStart: { value: fresnelStart },
      uFresnelEnd: { value: fresnelEnd },
      uGradientStart: { value: gradientStart },
      uGradientEnd: { value: gradientEnd },
      uGradientCurve: { value: gradientCurve },
      uGradientStrength: { value: gradientStrength },
    },
  });

  if (pane) {
    const params = { baseColor, fresnelColor, gradientColor };
    const u = material.uniforms;
    const slider = (folder, uniform, label, min, max, step = 0.01) =>
      folder.addBinding(uniform, "value", { label, min, max, step });

    const folder = pane.addFolder({ title: "Hand Material", expanded:false });

    folder
      .addBinding(params, "baseColor", { label: "Base Color" })
      .on("change", (ev) => u.uBaseColor.value.set(ev.value));

    const fresnel = folder.addFolder({ title: "Fresnel", expanded:false });
    fresnel
      .addBinding(params, "fresnelColor", { label: "Color" })
      .on("change", (ev) => u.uFresnelColor.value.set(ev.value));
    slider(fresnel, u.uFresnelPower, "Power", 0.1, 10);
    slider(fresnel, u.uFresnelIntensity, "Intensity", 0, 5);
    slider(fresnel, u.uFresnelStart, "Fade Start (X)", 0, 1);
    slider(fresnel, u.uFresnelEnd, "Fade End (X)", 0, 1);

    const gradient = folder.addFolder({ title: "Gradient" });
    gradient
      .addBinding(params, "gradientColor", { label: "Color" })
      .on("change", (ev) => u.uGradientColor.value.set(ev.value));
    slider(gradient, u.uGradientStrength, "Strength", 0, 1);
    slider(gradient, u.uGradientStart, "Start (X)", 0, 1);
    slider(gradient, u.uGradientEnd, "End (X)", 0, 1);
    slider(gradient, u.uGradientCurve, "Curve", 0.1, 10);
  }

  return material;
}