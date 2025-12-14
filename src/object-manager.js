import * as BABYLON from '@babylonjs/core';
import { UndoRedoManager } from './undo-redo';

const ASSET_FOLDER = './assets/nature/';
const LS_AUTOSAVE_KEY = 'builder_autosave_map';

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
		this.autoSaveEnabled = true;
		
		// Initialize Undo/Redo Manager
		this.undoRedo = new UndoRedoManager(this);
		
		// Hook into history change for auto-save
		const originalOnHistoryChange = this.undoRedo.onHistoryChange;
		this.undoRedo.onHistoryChange = () => {
			if (originalOnHistoryChange) originalOnHistoryChange();
			this.saveToAutoSave();
		};
		
		// Events
		this.onSelectionChange = null; // Callback for UI
		
		// Drag State
		this.dragStartData = null; // Stores initial state of all selected objects
		this.dragStartOffsets = new Map(); // Stores offset of each mesh relative to the drag anchor
	}
	
	// --- Object Management ---
	
	async addAsset (filename, position) {
		try {
			// STACKING LOGIC: Check if a single object is selected to stack on top
			let stackHeight = 0;
			if (this.selectedMeshes.length === 1) {
				const baseMesh = this.selectedMeshes[0];
				// Calculate world max Y of the base mesh
				const bounds = baseMesh.getHierarchyBoundingVectors();
				stackHeight = bounds.max.y;
			}
			
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
			
			// Normalize position based on bounds (pivot adjustment)
			const bounds = root.getHierarchyBoundingVectors();
			const heightOffset = -bounds.min.y;
			
			root.name = uniqueName;
			
			// Apply position: Cursor/Grid pos + Pivot Offset + Default Offset + Stacking Height
			// If stacking, we use the stackHeight as base Y. If not, we use position.y (usually 0)
			const baseY = (this.selectedMeshes.length === 1) ? stackHeight : position.y;
			
			root.position = new BABYLON.Vector3(position.x, baseY + heightOffset + this.defaultYOffset, position.z);
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
				isLocked: false,
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
	
	async addAssetGrid (filename, position, rows, cols) {
		try {
			// 1. Load the first one to measure it
			const result = await BABYLON.SceneLoader.ImportMeshAsync('', ASSET_FOLDER, filename, this.scene);
			const root = result.meshes[0];
			
			// Calculate bounds for tight packing
			const bounds = root.getHierarchyBoundingVectors();
			const width = bounds.max.x - bounds.min.x;
			const depth = bounds.max.z - bounds.min.z;
			const heightOffset = -bounds.min.y;
			
			// We will instantiate/clone this for the grid
			// But first, let's set up the first one properly or just use it as a template and dispose it?
			// Let's use it as the first item (0,0)
			
			const addedObjectsData = [];
			const baseName = filename.replace(/\.glb$/i, '');
			
			// Start position (Top-Left of the grid centered at cursor)
			const startX = position.x - (width * cols) / 2 + width / 2;
			const startZ = position.z - (depth * rows) / 2 + depth / 2;
			
			// Helper to setup mesh
			const setupMesh = (mesh, r, c) => {
				const id = BABYLON.Tools.RandomId();
				// Unique name
				const existingCount = this.placedObjects.filter(o => o.name && o.name.startsWith(baseName)).length + addedObjectsData.length;
				const uniqueName = `${baseName}_${existingCount + 1}`;
				
				mesh.name = uniqueName;
				mesh.position = new BABYLON.Vector3(
					startX + c * width,
					position.y + heightOffset + this.defaultYOffset,
					startZ + r * depth
				);
				
				mesh.metadata = { id: id, isObject: true, file: filename };
				
				// Ensure shadows/pickable
				mesh.getChildMeshes(false).forEach(m => {
					this.shadowGenerator.addShadowCaster(m, true);
					m.receiveShadows = true;
					m.isPickable = true;
				});
				
				const objData = {
					id: id,
					name: uniqueName,
					file: filename,
					type: 'mesh',
					isLocked: false,
					position: mesh.position.asArray(),
					rotation: mesh.rotationQuaternion ? mesh.rotationQuaternion.toEulerAngles().asArray() : mesh.rotation.asArray(),
					scaling: mesh.scaling.asArray()
				};
				
				this.placedObjects.push(objData);
				addedObjectsData.push(objData);
				return mesh;
			};
			
			// Setup (0,0) - The one we loaded
			setupMesh(root, 0, 0);
			
			// Loop for the rest
			for (let r = 0; r < rows; r++) {
				for (let c = 0; c < cols; c++) {
					if (r === 0 && c === 0) continue; // Skip the first one
					
					// Instantiate (lighter weight) or Clone
					// InstantiateHierarchy is good for GLTF
					const newRoot = root.instantiateHierarchy();
					// Note: instantiateHierarchy creates a new root but shares geometry.
					// We need to ensure metadata is set on the new root.
					
					// However, instantiateHierarchy returns a TransformNode usually, or the root mesh.
					// Let's use simple cloning for safety with the existing logic
					// const newRoot = root.clone(`${baseName}_r${r}_c${c}`);
					// Cloning GLTF roots can be tricky in Babylon sometimes if not handled right,
					// but ImportMeshAsync result usually works.
					
					// Let's use InstantiateHierarchy for performance if possible, but fallback to clone
					// Actually, let's just use ImportMeshAsync in a loop? No, too slow.
					// Clone is best.
					const clone = root.clone();
					setupMesh(clone, r, c);
				}
			}
			
			// Select all new objects
			this.selectedMeshes = [];
			addedObjectsData.forEach(d => {
				const m = this.findMeshById(d.id);
				if (m) this.selectObject(m, true);
			});
			
			this.undoRedo.add({ type: 'ADD', data: addedObjectsData });
			
		} catch (e) {
			console.error("Grid spawn error:", e);
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
			isLocked: false,
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
			
			// CHECK LOCKED STATUS
			if (objData && !objData.isLocked) {
				deletedData.push(objData);
				deletedIds.push(id);
				this.removeObjectById(id, false); // Don't clear selection yet
			}
		});
		
		// Update selection array to remove deleted ones
		this.selectedMeshes = this.selectedMeshes.filter(m => !deletedIds.includes(m.metadata.id));
		
		// If anything was deleted, add to history
		if (deletedData.length > 0) {
			this.undoRedo.add({ type: 'DELETE', data: deletedData });
		}
		
		// Update UI
		if (this.onSelectionChange) {
			if (this.selectedMeshes.length > 0) {
				const selectedData = this.selectedMeshes.map(m => this.placedObjects.find(o => o.id === m.metadata.id));
				this.onSelectionChange(selectedData);
			} else {
				this.onSelectionChange(null);
			}
		}
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
				isLocked: false, // Copies are unlocked by default
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
		
		const objData = this.placedObjects.find(o => o.id === id);
		
		// Handle Locking
		if (prop === 'isLocked') {
			objData.isLocked = value;
			// No history for locking? Or should we? Let's skip history for lock state for now as it's a meta-property
			// But we should trigger auto-save
			this.saveToAutoSave();
			return;
		}
		
		// Capture state for undo
		const oldData = {
			position: mesh.position.asArray(),
			rotation: mesh.rotation.asArray(),
			scaling: mesh.scaling.asArray()
		};
		
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
	
	// Update property for multiple objects (specifically for locking)
	updateMultipleObjectsProperty(prop, value) {
		if (prop === 'isLocked') {
			this.selectedMeshes.forEach(mesh => {
				const objData = this.placedObjects.find(o => o.id === mesh.metadata.id);
				if (objData) objData.isLocked = value;
			});
			this.saveToAutoSave();
		}
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
	
	// Auto-Save Logic
	saveToAutoSave() {
		if (!this.autoSaveEnabled) return;
		const data = this.getMapData('autosave');
		localStorage.setItem(LS_AUTOSAVE_KEY, JSON.stringify(data));
	}
	
	loadFromAutoSave() {
		const saved = localStorage.getItem(LS_AUTOSAVE_KEY);
		if (saved) {
			try {
				const data = JSON.parse(saved);
				console.log("Restoring auto-saved map...");
				this.loadMapData(data);
			} catch (e) {
				console.error("Failed to load auto-save", e);
			}
		}
	}
}
