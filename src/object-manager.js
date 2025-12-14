import * as BABYLON from '@babylonjs/core';
import { UndoRedoManager } from './undo-redo';

const ASSET_FOLDER = './assets/nature/';

export class ObjectManager {
	constructor (scene, shadowGenerator) {
		this.scene = scene;
		this.shadowGenerator = shadowGenerator;
		
		// State
		this.placedObjects = []; // Array of metadata objects
		this.selectedMeshes = []; // Array of currently selected Babylon Meshes
		
		// Settings (Defaults as requested: Grid Snap OFF, Object Snap ON)
		this.snapToGrid = false;
		this.snapToObjects = true;
		this.gridSize = 2.5;
		this.defaultYOffset = 0; // New setting for Y offset
		
		// Initialize Undo/Redo Manager
		this.undoRedo = new UndoRedoManager(this);
		
		// Events
		this.onSelectionChange = null; // Callback for UI
		
		// Drag State
		this.dragStartData = null; // Stores initial state of all selected objects
		this.dragStartOffsets = new Map(); // Stores offset of each mesh relative to the drag anchor
	}
	
	// --- Object Management ---
	
	async addAsset (filename, position) {
		try {
			const id = BABYLON.Tools.RandomId();
			
			// Generate Unique Name: filename_1, filename_2, etc.
			const baseName = filename.replace(/\.glb$/i, '');
			const existing = this.placedObjects.filter(o => o.name && o.name.startsWith(baseName));
			
			let maxIndex = 0;
			existing.forEach(o => {
				const parts = o.name.split('_');
				const suffix = parseInt(parts[parts.length - 1]);
				if (!isNaN(suffix) && suffix > maxIndex) {
					maxIndex = suffix;
				}
			});
			
			const uniqueName = `${baseName}_${maxIndex + 1}`;
			
			const result = await BABYLON.SceneLoader.ImportMeshAsync('', ASSET_FOLDER, filename, this.scene);
			const root = result.meshes[0];
			
			// Normalize position based on bounds
			const bounds = root.getHierarchyBoundingVectors();
			const heightOffset = -bounds.min.y;
			
			root.name = uniqueName;
			// Apply default Y offset from settings here
			root.position = new BABYLON.Vector3(position.x, position.y + heightOffset + this.defaultYOffset, position.z);
			root.metadata = { id: id, isObject: true, file: filename };
			
			result.meshes.forEach(m => {
				this.shadowGenerator.addShadowCaster(m, true);
				m.receiveShadows = true;
				m.isPickable = true;
				if (m !== root) m.parent = root;
			});
			
			const objData = {
				id: id,
				name: uniqueName,
				file: filename,
				type: 'mesh',
				position: root.position.asArray(),
				rotation: root.rotationQuaternion ? root.rotationQuaternion.toEulerAngles().asArray() : root.rotation.asArray(),
				scaling: root.scaling.asArray()
			};
			
			this.placedObjects.push(objData);
			this.selectObject(root, false);
			
			// Add to history via new manager
			this.undoRedo.add({ type: 'ADD', data: [objData] });
			
		} catch (err) {
			console.error('Error adding asset:', err);
		}
	}
	
	addLight (position) {
		const id = BABYLON.Tools.RandomId();
		const existingLights = this.placedObjects.filter(o => o.type === 'light');
		const name = `Light_${existingLights.length + 1}`;
		
		const light = new BABYLON.PointLight(name, new BABYLON.Vector3(position.x, 5 + this.defaultYOffset, position.z), this.scene);
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
		this.selectObject(light, false);
		this.undoRedo.add({ type: 'ADD', data: [objData] });
	}
	
	deleteSelected () {
		if (this.selectedMeshes.length === 0) return;
		
		const deletedData = [];
		const deletedIds = [];
		
		// Create a copy of the array to iterate safely while modifying selection
		const meshesToDelete = [...this.selectedMeshes];
		
		meshesToDelete.forEach(mesh => {
			const id = mesh.metadata.id;
			const objData = this.placedObjects.find(o => o.id === id);
			if (objData) {
				deletedData.push(objData);
				deletedIds.push(id);
				this.removeObjectById(id, false); // Don't clear selection yet
			}
		});
		
		this.selectedMeshes = []; // Clear selection manually
		this.undoRedo.add({ type: 'DELETE', data: deletedData });
		
		if (this.onSelectionChange) this.onSelectionChange(null);
	}
	
	duplicateSelection () {
		if (this.selectedMeshes.length === 0) return;
		
		const newObjectsData = [];
		const newMeshes = [];
		
		// 1. Deselect current (visual only)
		this.selectedMeshes.forEach(m => this.setSelectionHighlight(m, false));
		
		// 2. Clone Loop
		const promises = this.selectedMeshes.map(async (originalMesh) => {
			const originalData = this.placedObjects.find(o => o.id === originalMesh.metadata.id);
			if (!originalData) return;
			
			const newId = BABYLON.Tools.RandomId();
			// Create unique name
			const baseName = originalData.name.split('_')[0];
			const newName = `${baseName}_copy_${Math.floor(Math.random() * 1000)}`;
			
			// Offset position slightly
			const newPos = originalMesh.position.clone().add(new BABYLON.Vector3(2, 0, 2));
			
			let newRoot;
			
			if (originalData.type === 'light') {
				const light = new BABYLON.PointLight(newName, newPos, this.scene);
				light.intensity = 0.5;
				light.metadata = { id: newId, isObject: true, type: 'light' };
				
				const sphere = BABYLON.MeshBuilder.CreateSphere(newName + '_gizmo', { diameter: 0.5 }, this.scene);
				sphere.position = light.position;
				sphere.material = new BABYLON.StandardMaterial('lm', this.scene);
				sphere.material.emissiveColor = new BABYLON.Color3(1, 1, 0);
				sphere.setParent(light);
				sphere.isPickable = true;
				newRoot = light;
			} else {
				// Clone Mesh
				// Using ImportMeshAsync again ensures a clean separate instance
				const result = await BABYLON.SceneLoader.ImportMeshAsync('', ASSET_FOLDER, originalData.file, this.scene);
				newRoot = result.meshes[0];
				newRoot.name = newName;
				newRoot.position = newPos;
				newRoot.rotation = originalMesh.rotation.clone();
				if (originalMesh.rotationQuaternion) newRoot.rotationQuaternion = originalMesh.rotationQuaternion.clone();
				newRoot.scaling = originalMesh.scaling.clone();
				
				newRoot.metadata = { id: newId, isObject: true, file: originalData.file };
				
				result.meshes.forEach(m => {
					this.shadowGenerator.addShadowCaster(m, true);
					m.receiveShadows = true;
					m.isPickable = true;
					if (m !== newRoot) m.parent = newRoot;
				});
			}
			
			const newData = {
				id: newId,
				name: newName,
				type: originalData.type || 'mesh',
				file: originalData.file,
				position: newRoot.position.asArray(),
				rotation: newRoot.rotationQuaternion ? newRoot.rotationQuaternion.toEulerAngles().asArray() : newRoot.rotation.asArray(),
				scaling: newRoot.scaling.asArray()
			};
			
			this.placedObjects.push(newData);
			newObjectsData.push(newData);
			newMeshes.push(newRoot);
		});
		
		Promise.all(promises).then(() => {
			// 3. Select new objects
			this.selectedMeshes = newMeshes;
			this.selectedMeshes.forEach(m => this.setSelectionHighlight(m, true));
			
			// 4. Notify UI
			if (this.onSelectionChange) {
				const selectedData = this.selectedMeshes.map(m => this.placedObjects.find(o => o.id === m.metadata.id));
				this.onSelectionChange(selectedData);
			}
			
			// 5. History
			this.undoRedo.add({ type: 'ADD', data: newObjectsData });
		});
	}
	
	removeObjectById (id, clearSelection = true) {
		const mesh = this.findMeshById(id);
		if (mesh) {
			if (clearSelection) {
				// If we are removing a specific object, remove it from selection array
				this.selectedMeshes = this.selectedMeshes.filter(m => m !== mesh);
				if (this.selectedMeshes.length === 0) {
					this.onSelectionChange(null);
				} else {
					// Update UI with remaining selection
					const selectedData = this.selectedMeshes.map(m => this.placedObjects.find(o => o.id === m.metadata.id));
					this.onSelectionChange(selectedData);
				}
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
	
	selectObject (mesh, isMultiSelect) {
		// Handle clicking sub-meshes
		if (mesh && mesh.parent && mesh.parent.metadata && mesh.parent.metadata.isObject) {
			mesh = mesh.parent;
		}
		
		if (!isMultiSelect) {
			// Single Select Mode: Clear previous
			this.selectedMeshes.forEach(m => this.setSelectionHighlight(m, false));
			this.selectedMeshes = [];
			
			if (mesh) {
				this.selectedMeshes.push(mesh);
				this.setSelectionHighlight(mesh, true);
			}
		} else {
			// Multi Select Mode
			if (mesh) {
				const index = this.selectedMeshes.indexOf(mesh);
				if (index !== -1) {
					// Deselect if already selected
					this.setSelectionHighlight(mesh, false);
					this.selectedMeshes.splice(index, 1);
				} else {
					// Add to selection
					this.selectedMeshes.push(mesh);
					this.setSelectionHighlight(mesh, true);
				}
			}
		}
		
		// Update UI
		if (this.onSelectionChange) {
			if (this.selectedMeshes.length > 0) {
				// Map meshes to their data objects
				const selectedData = this.selectedMeshes.map(m => this.placedObjects.find(o => o.id === m.metadata.id));
				this.onSelectionChange(selectedData);
			} else {
				this.onSelectionChange(null);
			}
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
	
	startDrag (clickedMesh, groundPoint) {
		if (!clickedMesh || this.selectedMeshes.length === 0) return;
		
		this.dragStartData = [];
		this.dragStartOffsets.clear();
		
		// Store initial state for all selected objects
		this.selectedMeshes.forEach(mesh => {
			this.dragStartData.push({
				id: mesh.metadata.id,
				position: mesh.position.asArray(),
				rotation: mesh.rotation.asArray(),
				scaling: mesh.scaling.asArray()
			});
			
			// Calculate offset from the ground click point to the mesh position
			// This allows moving the group relative to the cursor
			const offset = mesh.position.subtract(groundPoint);
			// Keep Y relative to mesh, but X/Z relative to ground point
			offset.y = mesh.position.y;
			this.dragStartOffsets.set(mesh.metadata.id, offset);
		});
	}
	
	handleDrag (clickedMesh, groundPoint) {
		// Calculate the "target" position for the clicked mesh based on the cursor
		// But we apply logic to all meshes
		
		// We need to determine the translation delta or absolute position for the group.
		// Strategy: Calculate where the *clicked* mesh should be (snapped),
		// then apply the difference to all others?
		// Or calculate individual positions based on the cursor + offset?
		
		// Let's use individual positions based on cursor + offset.
		// However, snapping needs to happen. Usually, we snap the "primary" object (clickedMesh)
		// and move others relative to it to maintain formation.
		
		const primaryOffset = this.dragStartOffsets.get(clickedMesh.metadata.id);
		if (!primaryOffset) return;
		
		// 1. Calculate Proposed Position for Primary Mesh
		let proposedPrimaryPos = groundPoint.add(new BABYLON.Vector3(primaryOffset.x, 0, primaryOffset.z));
		proposedPrimaryPos.y = primaryOffset.y; // Keep original Y
		
		// 2. Apply Grid Snapping to Primary
		if (this.snapToGrid) {
			proposedPrimaryPos.x = Math.round(proposedPrimaryPos.x / this.gridSize) * this.gridSize;
			proposedPrimaryPos.z = Math.round(proposedPrimaryPos.z / this.gridSize) * this.gridSize;
		}
		
		// 3. Apply Object Snapping to Primary
		if (this.snapToObjects) {
			const snapped = this.calculateObjectSnap(clickedMesh, proposedPrimaryPos);
			if (snapped) {
				proposedPrimaryPos = snapped;
			}
		}
		
		// 4. Calculate Delta (Movement vector)
		const currentPrimaryPos = clickedMesh.position;
		const delta = proposedPrimaryPos.subtract(currentPrimaryPos);
		
		// 5. Apply Delta to ALL selected meshes
		this.selectedMeshes.forEach(mesh => {
			mesh.position.addInPlace(delta);
		});
		
		// Update UI live (only if single selected, or maybe show primary coords)
		if (this.onSelectionChange && this.selectedMeshes.length === 1) {
			const data = this.placedObjects.find(o => o.id === clickedMesh.metadata.id);
			if (data) {
				data.position = clickedMesh.position.asArray();
				this.onSelectionChange([data]);
			}
		}
	}
	
	endDrag (clickedMesh) {
		if (!this.dragStartData) return;
		
		const changes = [];
		
		this.selectedMeshes.forEach(mesh => {
			const id = mesh.metadata.id;
			const startData = this.dragStartData.find(d => d.id === id);
			
			if (!startData) return;
			
			const currentData = {
				position: mesh.position.asArray(),
				rotation: mesh.rotation.asArray(),
				scaling: mesh.scaling.asArray()
			};
			
			// Check if changed
			if (JSON.stringify(currentData.position) !== JSON.stringify(startData.position)) { // Only pos changes in drag
				// Update internal data model
				const objIndex = this.placedObjects.findIndex(o => o.id === id);
				if (objIndex !== -1) {
					this.placedObjects[objIndex].position = currentData.position;
				}
				
				changes.push({
					id: id,
					oldData: startData,
					newData: currentData
				});
			}
		});
		
		if (changes.length > 0) {
			this.undoRedo.add({
				type: 'TRANSFORM',
				data: changes // Array of changes
			});
		}
		
		this.dragStartData = null;
		this.dragStartOffsets.clear();
	}
	
	calculateObjectSnap (mesh, proposedPos) {
		// Get World Bounds of dragging mesh at proposed position
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
		
		// Iterate all other objects (excluding ALL selected objects)
		this.scene.meshes.forEach(other => {
			if (other === mesh || !other.metadata || !other.metadata.isObject || other.parent) return;
			// Skip if other is also selected
			if (this.selectedMeshes.includes(other)) return;
			
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
			mesh.position = snappedPos;
			mesh.computeWorldMatrix(true);
			
			let overlaps = false;
			for (const other of this.scene.meshes) {
				if (other === mesh || !other.metadata || !other.metadata.isObject || other.parent) continue;
				if (this.selectedMeshes.includes(other)) continue; // Ignore self-intersection within selection group
				
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
	
	// Direct update from Property Panel (Single Object only for now)
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
		
		this.undoRedo.add({
			type: 'TRANSFORM',
			data: [{
				id: id,
				oldData: oldData,
				newData: newData
			}]
		});
	}
	
	// --- NEW: Method required by UndoRedoManager ---
	updateObjectTransform (id, data) {
		const mesh = this.findMeshById(id);
		if (!mesh) return;
		
		// Update Mesh
		mesh.position = BABYLON.Vector3.FromArray(data.position);
		mesh.rotation = BABYLON.Vector3.FromArray(data.rotation);
		mesh.scaling = BABYLON.Vector3.FromArray(data.scaling);
		
		// Update Internal Data
		const objData = this.placedObjects.find(o => o.id === id);
		if (objData) {
			objData.position = data.position;
			objData.rotation = data.rotation;
			objData.scaling = data.scaling;
		}
		
		// Refresh UI if this object is selected
		if (this.selectedMeshes.includes(mesh) && this.selectedMeshes.length === 1 && this.onSelectionChange) {
			this.onSelectionChange([objData]);
		}
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
		this.selectedMeshes = [];
		// Reset history via manager
		this.undoRedo.history = [];
		this.undoRedo.historyIndex = -1;
		if (this.undoRedo.onHistoryChange) this.undoRedo.onHistoryChange();
		
		this.selectObject(null, false);
		
		if (data.assets) {
			data.assets.forEach(item => this.restoreObject(item));
		}
	}
}
