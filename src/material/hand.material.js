import * as THREE from "three";

const vertexShader = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vViewZ;

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
    vViewZ = -mvPosition.z;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uBaseColor;
  uniform vec3 uFresnelColor;
  uniform vec3 uGradientColor;
  uniform vec3 uLightDir;

  uniform float uFresnelPower;
  uniform float uFresnelIntensity;
  uniform float uFresnelStart;
  uniform float uFresnelEnd;
  uniform float uTipRim;

  uniform float uGradientStart;
  uniform float uGradientEnd;
  uniform float uGradientCurve;
  uniform float uGradientStrength;

  uniform float uFormStrength;
  uniform float uDepthStrength;
  uniform float uDepthNear;
  uniform float uDepthFar;
  uniform float uEdgeDarken;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vViewZ;

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(vViewDir);

    // 0 = right side of the hand, 1 = fingertips
    float distanceX = clamp(1.0 - vUv.x, 0.0, 1.0);

    // 0 facing the camera, 1 at the silhouette
    float rim = 1.0 - max(dot(normal, viewDir), 0.0);
    float rimPow = pow(rim, uFresnelPower);

    // ---- Fresnel: body rim fades out along X, tip rim fades in ----
    float fade = 1.0 - smoothstep(uFresnelStart, uFresnelEnd, distanceX);
    float bodyRim = clamp(rimPow * uFresnelIntensity, 0.0, 1.0) * fade;
    float tipRim = clamp(rimPow * uTipRim, 0.0, 1.0) * (1.0 - fade);
    float fresnel = bodyRim + tipRim;

    // ---- Gradient (rises along X) ----
    float gradient = smoothstep(uGradientStart, uGradientEnd, distanceX);
    gradient = pow(gradient, uGradientCurve) * uGradientStrength;

    // Form: half-Lambert key light in world space
    vec3 worldN = normalize(normal * mat3(viewMatrix));
    float ndl = dot(worldN, normalize(uLightDir)) * 0.5 + 0.5;
    float form = mix(1.0, ndl, uFormStrength);

    // Depth: nearer to the camera = brighter
    float depth01 = 1.0 - smoothstep(uDepthNear, uDepthFar, vViewZ);
    float depthShade = mix(1.0, depth01, uDepthStrength);

    // Edge darkening just inside the silhouette
    float edge = 1.0 - uEdgeDarken * smoothstep(0.3, 0.8, rim);

    gradient *= form * depthShade * edge;

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
    baseColor = "#1c1c1c",
    fresnelColor = "#ffffff",
    gradientColor = "#ffffff",
    fresnelPower = 3.87,
    fresnelIntensity = 0.33,
    fresnelStart = 0.57,
    fresnelEnd = 0.98,
    tipRim = 1.2,
    gradientStart = 0.27,
    gradientEnd = 1.0,
    gradientCurve = 10.0,
    gradientStrength = 0.75,
    formStrength = 0.5,
    depthStrength = 0.5,
    depthNear = 3.0,
    depthFar = 5.5,
    edgeDarken = 0.4,
    lightDir = new THREE.Vector3(-0.5, 0.8, 0.6),
  } = options;

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uBaseColor: { value: new THREE.Color(baseColor) },
      uFresnelColor: { value: new THREE.Color(fresnelColor) },
      uGradientColor: { value: new THREE.Color(gradientColor) },
      uLightDir: { value: lightDir },
      uFresnelPower: { value: fresnelPower },
      uFresnelIntensity: { value: fresnelIntensity },
      uFresnelStart: { value: fresnelStart },
      uFresnelEnd: { value: fresnelEnd },
      uTipRim: { value: tipRim },
      uGradientStart: { value: gradientStart },
      uGradientEnd: { value: gradientEnd },
      uGradientCurve: { value: gradientCurve },
      uGradientStrength: { value: gradientStrength },
      uFormStrength: { value: formStrength },
      uDepthStrength: { value: depthStrength },
      uDepthNear: { value: depthNear },
      uDepthFar: { value: depthFar },
      uEdgeDarken: { value: edgeDarken },
    },
  });

  if (pane) {
    const params = { baseColor, fresnelColor, gradientColor };
    const u = material.uniforms;
    const slider = (folder, uniform, label, min, max, step = 0.01) =>
      folder.addBinding(uniform, "value", { label, min, max, step });

    const folder = pane.addFolder({ title: "Hand Material", expanded: false });

    folder
      .addBinding(params, "baseColor", { label: "Base Color" })
      .on("change", (ev) => u.uBaseColor.value.set(ev.value));

    const fresnel = folder.addFolder({ title: "Fresnel", expanded: false });
    fresnel
      .addBinding(params, "fresnelColor", { label: "Color" })
      .on("change", (ev) => u.uFresnelColor.value.set(ev.value));
    slider(fresnel, u.uFresnelPower, "Power", 0.1, 10);
    slider(fresnel, u.uFresnelIntensity, "Intensity", 0, 5);
    slider(fresnel, u.uFresnelStart, "Fade Start (X)", 0, 1);
    slider(fresnel, u.uFresnelEnd, "Fade End (X)", 0, 1);
    slider(fresnel, u.uTipRim, "Tip Rim", 0, 3);

    const gradient = folder.addFolder({ title: "Gradient" });
    gradient
      .addBinding(params, "gradientColor", { label: "Color" })
      .on("change", (ev) => u.uGradientColor.value.set(ev.value));
    slider(gradient, u.uGradientStrength, "Strength", 0, 1);
    slider(gradient, u.uGradientStart, "Start (X)", 0, 1);
    slider(gradient, u.uGradientEnd, "End (X)", 0, 1);
    slider(gradient, u.uGradientCurve, "Curve", 0.1, 10);

    const depth = folder.addFolder({ title: "Depth & Form", expanded: false });
    slider(depth, u.uFormStrength, "Form", 0, 1);
    slider(depth, u.uDepthStrength, "Depth", 0, 1);
    slider(depth, u.uDepthNear, "Depth Near", 0, 10);
    slider(depth, u.uDepthFar, "Depth Far", 0, 10);
    slider(depth, u.uEdgeDarken, "Edge Darken", 0, 1);
    depth.addBinding(u.uLightDir, "value", {
      label: "Light Dir",
      x: { min: -1, max: 1 },
      y: { min: -1, max: 1 },
      z: { min: -1, max: 1 },
    });
  }

  return material;
}
