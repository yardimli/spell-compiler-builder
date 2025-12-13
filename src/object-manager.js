import * as BABYLON from '@babylonjs/core';

const ASSET_FOLDER = './assets/nature/';

export class ObjectManager {
	constructor (scene, shadowGenerator) {
		this.scene = scene;
		this.shadowGenerator = shadowGenerator;
		
		// State
		this.placedObjects = []; // Array of metadata objects
		this.selectedMesh = null;
		
		// Settings
		this.snapToGrid = true;
		this.snapToObjects = false;
		this.gridSize = 5;
		
		// Undo/Redo
		this.history = [];
		this.historyIndex = -1;
		this.maxHistory = 50;
		
		// Events
		this.onSelectionChange = null; // Callback for UI
		this.onHistoryChange = null;   // Callback for UI
	}
	
	// --- History Management ---
	
	addToHistory (action) {
		// Remove any future history if we are in the middle of the stack
		if (this.historyIndex < this.history.length - 1) {
			this.history = this.history.slice(0, this.historyIndex + 1);
		}
		
		this.history.push(action);
		if (this.history.length > this.maxHistory) {
			this.history.shift();
		} else {
			this.historyIndex++;
		}
		
		if (this.onHistoryChange) this.onHistoryChange();
	}
	
	undo () {
		if (this.historyIndex < 0) return;
		
		const action = this.history[this.historyIndex];
		this.revertAction(action);
		this.historyIndex--;
		
		if (this.onHistoryChange) this.onHistoryChange();
	}
	
	redo () {
		if (this.historyIndex >= this.history.length - 1) return;
		
		this.historyIndex++;
		const action = this.history[this.historyIndex];
		this.applyAction(action);
		
		if (this.onHistoryChange) this.onHistoryChange();
	}
	
	applyAction (action) {
		switch (action.type) {
			case 'ADD':
				this.restoreObject(action.data);
				break;
			case 'DELETE':
				this.removeObjectById(action.id, false);
				break;
			case 'TRANSFORM':
				this.updateObjectTransform(action.id, action.newData, false);
				break;
		}
	}
	
	revertAction (action) {
		switch (action.type) {
			case 'ADD':
				this.removeObjectById(action.data.id, false);
				break;
			case 'DELETE':
				this.restoreObject(action.data);
				break;
			case 'TRANSFORM':
				this.updateObjectTransform(action.id, action.oldData, false);
				break;
		}
	}
	
	// --- Object Management ---
	
	async addAsset (filename, position) {
		try {
			const id = BABYLON.Tools.RandomId();
			const name = `Obj_${id}`;
			
			const result = await BABYLON.SceneLoader.ImportMeshAsync('', ASSET_FOLDER, filename, this.scene);
			const root = result.meshes[0];
			
			// Normalize position based on bounds
			const bounds = root.getHierarchyBoundingVectors();
			const heightOffset = -bounds.min.y;
			
			root.name = name;
			root.position = new BABYLON.Vector3(position.x, position.y + heightOffset, position.z);
			root.metadata = { id: id, isObject: true, file: filename };
			
			result.meshes.forEach(m => {
				this.shadowGenerator.addShadowCaster(m, true);
				m.receiveShadows = true;
				m.isPickable = true;
				// Link back to root for picking
				if (m !== root) m.parent = root;
			});
			
			const objData = {
				id: id,
				name: name,
				file: filename,
				type: 'mesh',
				position: root.position.asArray(),
				rotation: root.rotationQuaternion ? root.rotationQuaternion.toEulerAngles().asArray() : root.rotation.asArray(),
				scaling: root.scaling.asArray()
			};
			
			this.placedObjects.push(objData);
			this.selectObject(root);
			
			this.addToHistory({ type: 'ADD', data: objData });
			
		} catch (err) {
			console.error('Error adding asset:', err);
		}
	}
	
	addLight (position) {
		const id = BABYLON.Tools.RandomId();
		const name = `Light_${id}`;
		
		const light = new BABYLON.PointLight(name, new BABYLON.Vector3(position.x, 5, position.z), this.scene);
		light.intensity = 0.5;
		light.metadata = { id: id, isObject: true, type: 'light' };
		
		const sphere = BABYLON.MeshBuilder.CreateSphere(name + '_gizmo', { diameter: 0.5 }, this.scene);
		sphere.position = light.position;
		sphere.material = new BABYLON.StandardMaterial('lm', this.scene);
		sphere.material.emissiveColor = new BABYLON.Color3(1, 1, 0);
		sphere.setParent(light);
		sphere.isPickable = true;
		
		const objData = {
			id: id,
			name: name,
			type: 'light',
			position: light.position.asArray(),
			rotation: [0, 0, 0],
			scaling: [1, 1, 1]
		};
		
		this.placedObjects.push(objData);
		this.selectObject(light);
		this.addToHistory({ type: 'ADD', data: objData });
	}
	
	deleteSelected () {
		if (!this.selectedMesh) return;
		
		const id = this.selectedMesh.metadata.id;
		const objData = this.placedObjects.find(o => o.id === id);
		
		if (objData) {
			this.addToHistory({ type: 'DELETE', id: id, data: objData });
			this.removeObjectById(id, true);
		}
	}
	
	removeObjectById (id, clearSelection = true) {
		const mesh = this.findMeshById(id);
		if (mesh) {
			if (clearSelection && this.selectedMesh === mesh) {
				this.selectObject(null);
			}
			mesh.dispose();
		}
		
		// Remove from data array
		this.placedObjects = this.placedObjects.filter(o => o.id !== id);
	}
	
	restoreObject (data) {
		if (data.type === 'light') {
			const light = new BABYLON.PointLight(data.name, BABYLON.Vector3.FromArray(data.position), this.scene);
			light.intensity = 0.5;
			light.metadata = { id: data.id, isObject: true, type: 'light' };
			
			const sphere = BABYLON.MeshBuilder.CreateSphere(data.name + '_gizmo', { diameter: 0.5 }, this.scene);
			sphere.position = light.position;
			sphere.material = new BABYLON.StandardMaterial('lm', this.scene);
			sphere.material.emissiveColor = new BABYLON.Color3(1, 1, 0);
			sphere.setParent(light);
			
			this.placedObjects.push(data);
		} else {
			BABYLON.SceneLoader.ImportMeshAsync('', ASSET_FOLDER, data.file, this.scene).then(res => {
				const root = res.meshes[0];
				root.name = data.name;
				root.position = BABYLON.Vector3.FromArray(data.position);
				root.rotation = BABYLON.Vector3.FromArray(data.rotation);
				root.scaling = BABYLON.Vector3.FromArray(data.scaling);
				root.metadata = { id: data.id, isObject: true, file: data.file };
				
				res.meshes.forEach(m => {
					this.shadowGenerator.addShadowCaster(m, true);
					m.receiveShadows = true;
					m.isPickable = true;
					if (m !== root) m.parent = root;
				});
				
				this.placedObjects.push(data);
			});
		}
	}
	
	selectObject (mesh) {
		// Deselect previous
		if (this.selectedMesh) {
			this.setSelectionHighlight(this.selectedMesh, false);
		}
		
		// Handle clicking sub-meshes
		if (mesh && mesh.parent && mesh.parent.metadata && mesh.parent.metadata.isObject) {
			mesh = mesh.parent;
		}
		
		this.selectedMesh = mesh;
		
		if (this.selectedMesh) {
			this.setSelectionHighlight(this.selectedMesh, true);
		}
		
		if (this.onSelectionChange) {
			const data = mesh ? this.placedObjects.find(o => o.id === mesh.metadata.id) : null;
			this.onSelectionChange(data);
		}
	}
	
	setSelectionHighlight (mesh, isSelected) {
		const children = mesh.getChildMeshes(false);
		children.forEach(m => {
			m.showBoundingBox = isSelected;
		});
		mesh.showBoundingBox = isSelected;
	}
	
	findMeshById (id) {
		return this.scene.meshes.find(m => m.metadata && m.metadata.id === id) ||
			this.scene.lights.find(l => l.metadata && l.metadata.id === id);
	}
	
	// --- Transformation & Snapping ---
	
	startDrag (mesh) {
		if (!mesh) return;
		this.dragStartData = {
			position: mesh.position.asArray(),
			rotation: mesh.rotation.asArray(),
			scaling: mesh.scaling.asArray()
		};
		this.selectObject(mesh);
	}
	
	handleDrag (mesh, targetPosition) {
		let finalPos = targetPosition.clone();
		
		// 1. Grid Snapping
		if (this.snapToGrid) {
			finalPos.x = Math.round(finalPos.x / this.gridSize) * this.gridSize;
			finalPos.z = Math.round(finalPos.z / this.gridSize) * this.gridSize;
		}
		
		// 2. Object Snapping (Magnetic)
		if (this.snapToObjects) {
			const snapped = this.calculateObjectSnap(mesh, finalPos);
			if (snapped) {
				finalPos = snapped;
			}
		}
		
		mesh.position.x = finalPos.x;
		mesh.position.z = finalPos.z;
		
		// Update UI live
		if (this.onSelectionChange) {
			const data = this.placedObjects.find(o => o.id === mesh.metadata.id);
			if (data) {
				data.position = mesh.position.asArray();
				this.onSelectionChange(data);
			}
		}
	}
	
	endDrag (mesh) {
		if (!mesh || !this.dragStartData) return;
		
		const id = mesh.metadata.id;
		const currentData = {
			position: mesh.position.asArray(),
			rotation: mesh.rotation.asArray(),
			scaling: mesh.scaling.asArray()
		};
		
		// Only add to history if changed
		if (JSON.stringify(currentData) !== JSON.stringify(this.dragStartData)) {
			// Update internal data model
			const objIndex = this.placedObjects.findIndex(o => o.id === id);
			if (objIndex !== -1) {
				this.placedObjects[objIndex].position = currentData.position;
				this.placedObjects[objIndex].rotation = currentData.rotation;
				this.placedObjects[objIndex].scaling = currentData.scaling;
			}
			
			this.addToHistory({
				type: 'TRANSFORM',
				id: id,
				oldData: this.dragStartData,
				newData: currentData
			});
		}
		
		this.dragStartData = null;
	}
	
	calculateObjectSnap (mesh, proposedPos) {
		// Get World Bounds of dragging mesh at proposed position
		// We need to simulate the mesh being at proposedPos to get accurate bounds
		const originalPos = mesh.position.clone();
		mesh.position = proposedPos;
		mesh.computeWorldMatrix(true);
		const bounds = mesh.getHierarchyBoundingVectors();
		mesh.position = originalPos; // Restore
		
		const min = bounds.min;
		const max = bounds.max;
		
		// Define corners (Bottom plane)
		const corners = [
			new BABYLON.Vector3(min.x, 0, min.z),
			new BABYLON.Vector3(max.x, 0, min.z),
			new BABYLON.Vector3(max.x, 0, max.z),
			new BABYLON.Vector3(min.x, 0, max.z)
		];
		
		let closestDist = Number.MAX_VALUE;
		let snapOffset = null;
		const snapThreshold = 2.0; // Distance to activate snap
		
		// Iterate all other objects
		this.scene.meshes.forEach(other => {
			if (other === mesh || !other.metadata || !other.metadata.isObject || other.parent) return;
			
			const otherBounds = other.getHierarchyBoundingVectors();
			const otherCorners = [
				new BABYLON.Vector3(otherBounds.min.x, 0, otherBounds.min.z),
				new BABYLON.Vector3(otherBounds.max.x, 0, otherBounds.min.z),
				new BABYLON.Vector3(otherBounds.max.x, 0, otherBounds.max.z),
				new BABYLON.Vector3(otherBounds.min.x, 0, otherBounds.max.z)
			];
			
			// Check every corner against every other corner
			for (const c1 of corners) {
				for (const c2 of otherCorners) {
					const dist = BABYLON.Vector3.Distance(c1, c2);
					if (dist < snapThreshold && dist < closestDist) {
						closestDist = dist;
						// Calculate the offset needed to align c1 to c2
						snapOffset = c2.subtract(c1);
					}
				}
			}
		});
		
		if (snapOffset) {
			const snappedPos = proposedPos.add(snapOffset);
			
			// Check for overlap
			// We move mesh to snappedPos, check intersection, then move back
			mesh.position = snappedPos;
			mesh.computeWorldMatrix(true);
			
			let overlaps = false;
			for (const other of this.scene.meshes) {
				if (other === mesh || !other.metadata || !other.metadata.isObject || other.parent) continue;
				if (mesh.intersectsMesh(other, true)) {
					overlaps = true;
					break;
				}
			}
			
			mesh.position = originalPos; // Restore
			
			if (!overlaps) {
				return snappedPos;
			}
		}
		
		return null;
	}
	
	// Direct update from Property Panel
	updateObjectProperty (id, prop, value) {
		const mesh = this.findMeshById(id);
		if (!mesh) return;
		
		// Capture state for undo
		const oldData = {
			position: mesh.position.asArray(),
			rotation: mesh.rotation.asArray(),
			scaling: mesh.scaling.asArray()
		};
		
		const objData = this.placedObjects.find(o => o.id === id);
		
		if (prop === 'name') {
			mesh.name = value;
			objData.name = value;
			// Name change doesn't strictly need undo/redo for geometry, but good to have.
			// Skipping complex undo for name to keep it simple, or add a generic UPDATE action.
			return;
		}
		
		// Value is {x, y, z} or array
		if (prop === 'position') {
			mesh.position = new BABYLON.Vector3(value.x, value.y, value.z);
			objData.position = [value.x, value.y, value.z];
		} else if (prop === 'rotation') {
			// Convert degrees to radians
			mesh.rotation = new BABYLON.Vector3(
				BABYLON.Tools.ToRadians(value.x),
				BABYLON.Tools.ToRadians(value.y),
				BABYLON.Tools.ToRadians(value.z)
			);
			objData.rotation = mesh.rotation.asArray();
		} else if (prop === 'scaling') {
			mesh.scaling = new BABYLON.Vector3(value.x, value.y, value.z);
			objData.scaling = [value.x, value.y, value.z];
		}
		
		const newData = {
			position: mesh.position.asArray(),
			rotation: mesh.rotation.asArray(),
			scaling: mesh.scaling.asArray()
		};
		
		this.addToHistory({
			type: 'TRANSFORM',
			id: id,
			oldData: oldData,
			newData: newData
		});
	}
	
	// Load/Save Helpers
	getMapData (mapName) {
		return {
			name: mapName,
			version: 2,
			assets: this.placedObjects
		};
	}
	
	loadMapData (data) {
		// Clear existing
		[...this.scene.meshes].forEach(m => {
			if (m.metadata && m.metadata.isObject) m.dispose();
		});
		[...this.scene.lights].forEach(l => {
			if (l.metadata && l.metadata.isObject) l.dispose();
		});
		
		this.placedObjects = [];
		this.history = [];
		this.historyIndex = -1;
		this.selectObject(null);
		
		if (data.assets) {
			data.assets.forEach(item => this.restoreObject(item));
		}
	}
}
