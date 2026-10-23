// Deep imports keep the bundle small: importing from the "@babylonjs/core" barrel pulls in the whole engine.
// Side-effect imports register features that the deep imports alone do not include.
import "@babylonjs/core/Culling/ray"; // scene.pick
import "@babylonjs/core/Meshes/instancedMesh"; // mesh.createInstance
import "@babylonjs/core/Particles/particleSystemComponent"; // particle rendering
import "@babylonjs/loaders/glTF/2.0"; // .glb weapon models

export { Engine } from "@babylonjs/core/Engines/engine";
export { Scene } from "@babylonjs/core/scene";
export type { Camera } from "@babylonjs/core/Cameras/camera";
export { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
export { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";
export { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
export { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
export { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
export { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
export type { Ray } from "@babylonjs/core/Culling/ray";
export { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
export type { Material } from "@babylonjs/core/Materials/material";
export type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
export { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
export { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
export type { Texture } from "@babylonjs/core/Materials/Textures/texture";
export type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
export { Mesh } from "@babylonjs/core/Meshes/mesh";
export { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
export type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
export { TransformNode } from "@babylonjs/core/Meshes/transformNode";
export { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
