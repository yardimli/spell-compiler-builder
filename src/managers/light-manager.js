import * as BABYLON from '@babylonjs/core';

export class LightManager {
	constructor (objectManager) {
		this.om = objectManager;
		this.scene = objectManager.scene;
	}
	
	/**
	 * Creates a light and its visual representation
	 * @param {string} kind - 'point', 'directional', 'hemispheric'
	 * @param {BABYLON.Vector3} position - World position
	 * @param {string} name - Name of the light
	 * @returns {object} { mesh, light }
	 */
	createLight (kind, position, name) {
		let light;
		let mesh;
		const mat = new BABYLON.StandardMaterial(name + '_mat', this.scene);
		mat.emissiveColor = new BABYLON.Color3(1, 1, 0); // Default yellow emission
		mat.disableLighting = true;
		
		// 1. Create the Babylon Light
		if (kind === 'point') {
			light = new BABYLON.PointLight(name, BABYLON.Vector3.Zero(), this.scene);
			light.diffuse = new BABYLON.Color3(1, 1, 1);
			light.specular = new BABYLON.Color3(1, 1, 1);
			
			// Visual: Sphere
			mesh = BABYLON.MeshBuilder.CreateSphere(name + '_gizmo', { diameter: 0.5 }, this.scene);
		} else if (kind === 'directional') {
			// Direction defaults to down-forward
			const dir = new BABYLON.Vector3(0, -1, 1);
			light = new BABYLON.DirectionalLight(name, dir, this.scene);
			light.diffuse = new BABYLON.Color3(1, 1, 1);
			light.specular = new BABYLON.Color3(1, 1, 1);
			
			// Visual: Compound mesh to show direction (Sphere + Cone)
			mesh = new BABYLON.Mesh(name + '_gizmo', this.scene);
			const sphere = BABYLON.MeshBuilder.CreateSphere('bulb', { diameter: 0.4 }, this.scene);
			const cone = BABYLON.MeshBuilder.CreateCylinder('dir', { diameterTop: 0, diameterBottom: 0.3, height: 0.5 }, this.scene);
			
			// Align cone to point along Z (forward)
			cone.rotation.x = Math.PI / 2;
			cone.position.z = 0.4;
			
			sphere.parent = mesh;
			cone.parent = mesh;
			sphere.material = mat;
			cone.material = mat;
			
			// Set initial rotation based on light direction
			// DirectionalLight direction is a Vector3. Mesh rotation is Euler/Quaternion.
			// We align the mesh's Z axis to the light direction.
			mesh.lookAt(mesh.position.add(dir));
		} else if (kind === 'hemispheric') {
			// Up direction
			const dir = new BABYLON.Vector3(0, 1, 0);
			light = new BABYLON.HemisphericLight(name, dir, this.scene);
			light.diffuse = new BABYLON.Color3(1, 1, 1);
			light.specular = new BABYLON.Color3(0, 0, 0); // Low specular for ambient
			light.groundColor = new BABYLON.Color3(0.2, 0.2, 0.2);
			
			// Visual: Hemisphere (Cut sphere)
			mesh = BABYLON.MeshBuilder.CreateSphere(name + '_gizmo', { diameter: 0.6, slice: 0.5 }, this.scene);
			// Visual needs to indicate "Up" - Hemisphere slice 0.5 creates a top dome
			mat.emissiveColor = new BABYLON.Color3(0.5, 0.5, 1); // Light Blue
		}
		
		// 2. Common Setup
		mesh.position = position.clone();
		mesh.material = mat;
		mesh.isPickable = true;
		
		// Parent light to mesh so moving mesh moves light position
		light.parent = mesh;
		
		// For Directional/Hemispheric, rotation of mesh determines direction
		if (kind !== 'point') {
			// We need to update light direction when mesh rotates
			mesh.onAfterWorldMatrixUpdateObservable.add(() => {
				if (kind === 'directional') {
					// Mesh forward (Z) is light direction
					light.direction = mesh.forward;
				} else if (kind === 'hemispheric') {
					// Mesh up (Y) is light direction usually
					// For Hemisphere visual (slice 0.5), the dome is up Y.
					light.direction = mesh.up;
				}
			});
		}
		
		return { mesh, light };
	}
	
	/**
	 * Updates properties of an existing light based on metadata/data object
	 */
	updateLightProperties (mesh, data) {
		const light = mesh.getChildren().find(c => c instanceof BABYLON.Light);
		if (!light) return;
		
		if (data.intensity !== undefined) light.intensity = data.intensity;
		
		// Colors
		if (data.color) light.diffuse = BABYLON.Color3.FromHexString(data.color);
		if (data.specularColor) light.specular = BABYLON.Color3.FromHexString(data.specularColor);
		if (data.groundColor && light instanceof BABYLON.HemisphericLight) {
			light.groundColor = BABYLON.Color3.FromHexString(data.groundColor);
		}
		
		// Direction (Sync Mesh Rotation)
		if (data.direction && (data.kind === 'directional' || data.kind === 'hemispheric')) {
			const dir = new BABYLON.Vector3(data.direction[0], data.direction[1], data.direction[2]);
			if (data.kind === 'directional') {
				mesh.lookAt(mesh.position.add(dir));
			} else {
				// Align Y to dir for hemispheric
				const axis = BABYLON.Vector3.Cross(BABYLON.Vector3.Up(), dir);
				const angle = Math.acos(BABYLON.Vector3.Dot(BABYLON.Vector3.Up(), dir));
				if (axis.lengthSquared() > 0.001) {
					mesh.rotationQuaternion = BABYLON.Quaternion.RotationAxis(axis, angle);
				}
			}
		}
	}
}
