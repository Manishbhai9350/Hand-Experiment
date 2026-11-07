import * as THREE from "three";

const vertexShader = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>

  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vWorldY;

  void main() {
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <defaultnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    #include <project_vertex>

    vNormal = normalize(transformedNormal);
    vViewDir = normalize(-mvPosition.xyz);
    vWorldY = (modelMatrix * vec4(transformed, 1.0)).y;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uBaseColor;
  uniform vec3 uGradientColor;

  uniform float uGradientMin;      // world Y of hand bottom
  uniform float uGradientMax;      // world Y of hand top

  uniform float uGradientStart;    // normalized height where gradient begins
  uniform float uGradientEnd;      // normalized height where gradient is full
  uniform float uGradientCurve;    // >1 = slow start, <1 = fast start
  uniform float uGradientStrength;

  uniform float uTakeoverThreshold; // normalized height where gradient takes over
  uniform float uTakeoverSoftness;  // width of the handoff
  uniform float uTakeoverCurve;     // shape of the handoff

  uniform float uFresnelPower;
  uniform float uFresnelIntensity;

  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vWorldY;

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(vViewDir);

    // Normalized height: 0 = bottom, 1 = top
    float t = clamp((vWorldY - uGradientMin) / max(uGradientMax - uGradientMin, 0.0001), 0.0, 1.0);

    // Height gradient with controllable smoothstep range + curve
    float g = smoothstep(uGradientStart, uGradientEnd, t);
    g = pow(g, uGradientCurve) * uGradientStrength;

    // Fresnel: bright at the edges, dark facing the camera
    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), uFresnelPower);
    fresnel = clamp(fresnel * uFresnelIntensity, 0.0, 1.0);

    // Takeover: 0 below the threshold (gradient * fresnel), 1 above (gradient only)
    float halfSoft = uTakeoverSoftness * 0.5;
    float takeover = smoothstep(uTakeoverThreshold - halfSoft, uTakeoverThreshold + halfSoft, t);
    takeover = pow(takeover, uTakeoverCurve);

    float factor = mix(g * fresnel, g, takeover);

    vec3 color = mix(uBaseColor, uGradientColor, factor);

    gl_FragColor = vec4(color, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createHandMaterial(options = {}, pane = null) {
  const {
    baseColor = "#000000",
    gradientColor = "#ffffff",
    gradientMin = -1,
    gradientMax = 1,
    gradientStart = 0.0,
    gradientEnd = 1.0,
    gradientCurve = 1.0,
    gradientStrength = 1.0,
    takeoverThreshold = 0.5,
    takeoverSoftness = 0.3,
    takeoverCurve = 1.0,
    fresnelPower = 2.0,
    fresnelIntensity = 1.0,
  } = options;

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uBaseColor: { value: new THREE.Color(baseColor) },
      uGradientColor: { value: new THREE.Color(gradientColor) },
      uGradientMin: { value: gradientMin },
      uGradientMax: { value: gradientMax },
      uGradientStart: { value: gradientStart },
      uGradientEnd: { value: gradientEnd },
      uGradientCurve: { value: gradientCurve },
      uGradientStrength: { value: gradientStrength },
      uTakeoverThreshold: { value: takeoverThreshold },
      uTakeoverSoftness: { value: takeoverSoftness },
      uTakeoverCurve: { value: takeoverCurve },
      uFresnelPower: { value: fresnelPower },
      uFresnelIntensity: { value: fresnelIntensity },
    },
  });

  if (pane) {
    const params = { baseColor, gradientColor };
    const u = material.uniforms;
    const slider = (folder, uniform, label, min, max, step = 0.01) =>
      folder.addBinding(uniform, "value", { label, min, max, step });

    const folder = pane.addFolder({ title: "Hand Material" });

    folder
      .addBinding(params, "baseColor", { label: "Base Color" })
      .on("change", (ev) => u.uBaseColor.value.set(ev.value));

    const gradient = folder.addFolder({ title: "Height Gradient" });
    gradient
      .addBinding(params, "gradientColor", { label: "Color" })
      .on("change", (ev) => u.uGradientColor.value.set(ev.value));
    slider(gradient, u.uGradientStrength, "Strength", 0, 1);
    slider(gradient, u.uGradientStart, "Start", 0, 1);
    slider(gradient, u.uGradientEnd, "End", 0, 1);
    slider(gradient, u.uGradientCurve, "Curve", 0.1, 5);
    slider(gradient, u.uGradientMin, "Bottom Y", -5, 5);
    slider(gradient, u.uGradientMax, "Top Y", -5, 5);

    const takeover = folder.addFolder({ title: "Gradient Takeover" });
    slider(takeover, u.uTakeoverThreshold, "Threshold", 0, 1);
    slider(takeover, u.uTakeoverSoftness, "Softness", 0.001, 1);
    slider(takeover, u.uTakeoverCurve, "Curve", 0.1, 5);

    const fresnel = folder.addFolder({ title: "Fresnel" });
    slider(fresnel, u.uFresnelPower, "Power", 0.1, 10);
    slider(fresnel, u.uFresnelIntensity, "Intensity", 0, 5);
  }

  return material;
}