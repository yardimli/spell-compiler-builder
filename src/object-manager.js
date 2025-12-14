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
		this._snapToGrid = false;
		this._snapToObjects = true;
		this._gridSize = 2.5;
		this.defaultYOffset = 0; // New setting for Y offset
		this.autoSaveEnabled = true;
		
		// Initialize Undo/Redo Manager
		this.undoRedo = new UndoRedoManager(this);
		
		// Events
		this.onSelectionChange = null; // Callback for UI
		
		// Gizmo Manager
		this.gizmoManager = new BABYLON.GizmoManager(this.scene);
		this.setupGizmo();
		
		// Drag State for Gizmo Multi-Select
		this.dragStartData = null;
		this.lastAttachedMeshPosition = null;
	}
	
	// --- Getters/Setters to sync Gizmo settings ---
	get snapToGrid() { return this._snapToGrid; }
	set snapToGrid(val) {
		this._snapToGrid = val;
		this.updateGizmoSettings();
	}
	
	get gridSize() { return this._gridSize; }
	set gridSize(val) {
		this._gridSize = val;
		this.updateGizmoSettings();
	}
	
	// --- Gizmo Setup ---
	setupGizmo() {
		// Enable only Position Gizmo (Arrows)
		this.gizmoManager.positionGizmoEnabled = true;
		this.gizmoManager.rotationGizmoEnabled = false;
		this.gizmoManager.scaleGizmoEnabled = false;
		this.gizmoManager.boundingBoxGizmoEnabled = false;
		
		// Don't attach automatically on pointer events, we control attachment via selection
		this.gizmoManager.usePointerToAttachGizmos = false;
		this.gizmoManager.clearGizmoOnEmptyPointerEvent = true;
		
		// Configure Visuals
		// (Optional: customize colors if needed, defaults are RGB)
		
		// --- Undo/Redo & Multi-Select Logic ---
		const gizmo = this.gizmoManager.gizmos.positionGizmo;
		if (gizmo) {
			// 1. Drag Start: Record state
			gizmo.onDragStartObservable.add(() => {
				if (this.selectedMeshes.length === 0) return;
				
				// Snapshot for Undo
				this.dragStartData = this.selectedMeshes.map(mesh => ({
					id: mesh.metadata.id,
					position: mesh.position.asArray(),
					rotation: mesh.rotation.asArray(),
					scaling: mesh.scaling.asArray()
				}));
				
				// Track position for delta calculation
				if (this.gizmoManager.attachedMesh) {
					this.lastAttachedMeshPosition = this.gizmoManager.attachedMesh.position.clone();
				}
			});
			
			// 2. Dragging: Apply delta to other selected meshes
			gizmo.onDragObservable.add(() => {
				const attached = this.gizmoManager.attachedMesh;
				if (!attached || !this.lastAttachedMeshPosition) return;
				
				// Calculate how much the gizmo moved the attached mesh
				const currentPos = attached.position;
				const delta = currentPos.subtract(this.lastAttachedMeshPosition);
				
				// Apply this delta to all OTHER selected meshes
				this.selectedMeshes.forEach(mesh => {
					if (mesh !== attached) {
						mesh.position.addInPlace(delta);
					}
				});
				
				// Update tracker
				this.lastAttachedMeshPosition = currentPos.clone();
				
				// Live UI Update (Optional, for single selection)
				if (this.selectedMeshes.length === 1 && this.onSelectionChange) {
					const data = this.placedObjects.find(o => o.id === attached.metadata.id);
					if (data) {
						data.position = attached.position.asArray();
						this.onSelectionChange([data]);
					}
				}
			});
			
			// 3. Drag End: Commit to history
			gizmo.onDragEndObservable.add(() => {
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
					if (JSON.stringify(currentData.position) !== JSON.stringify(startData.position)) {
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
						data: changes
					});
				}
				
				this.dragStartData = null;
				this.lastAttachedMeshPosition = null;
			});
		}
		
		this.updateGizmoSettings();
	}
	
	updateGizmoSettings() {
		if (this.gizmoManager.gizmos.positionGizmo) {
			this.gizmoManager.gizmos.positionGizmo.snapDistance = this._snapToGrid ? this._gridSize : 0;
		}
	}
	
	// --- Object Management ---
	
	async addAsset (filename, position) {
		try {
			// STACKING LOGIC: Check if a single object is selected to stack on top
			// Default to cursor position
			let targetX = position.x;
			let targetZ = position.z;
			let baseY = position.y;
			
			if (this.selectedMeshes.length === 1) {
				const baseMesh = this.selectedMeshes[0];
				// Calculate world bounds of the base mesh
				const bounds = baseMesh.getHierarchyBoundingVectors();
				
				// Override X and Z to center of selected object
				targetX = (bounds.min.x + bounds.max.x) / 2;
				targetZ = (bounds.min.z + bounds.max.z) / 2;
				
				// Override Base Y to top of selected object
				baseY = bounds.max.y;
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
			
			root.name = uniqueName;
			
			// Fix for Gap Issue:
			// Ensure the mesh is normalized (scale/rotation) before calculating bounds
			// and ensure we get the precise bottom of the visual geometry.
			root.computeWorldMatrix(true);
			result.meshes.forEach(m => m.computeWorldMatrix(true));
			
			// Calculate bounds of the hierarchy in its default state
			const bounds = root.getHierarchyBoundingVectors();
			const heightOffset = -bounds.min.y;
			
			// Apply position: Target X/Z + Base Y + Pivot Offset + Default Offset
			if (this.selectedMeshes.length === 1) {
				root.position = new BABYLON.Vector3(targetX, baseY, targetZ);
			} else {
				root.position = new BABYLON.Vector3(targetX, baseY + heightOffset + this.defaultYOffset, targetZ);
			}
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
				color: '#ffffff', // Default color
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
					color: '#ffffff',
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
		
		// If anything was deleted, add to history
		if (deletedData.length > 0) {
			this.undoRedo.add({ type: 'DELETE', data: deletedData });
		}
		
		// Update UI
		this.onSelectionChange(null);
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
				
				// Apply color if exists
				if (originalData.color) {
					this.applyColorToMesh(newRoot, originalData.color);
				}
			}
			
			const newData = {
				id: newId,
				name: newName,
				type: originalData.type || 'mesh',
				file: originalData.file,
				isLocked: false, // Copies are unlocked by default
				color: originalData.color || '#ffffff',
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
			// Update Gizmo to new selection
			if (this.selectedMeshes.length > 0) {
				this.gizmoManager.attachToMesh(this.selectedMeshes[this.selectedMeshes.length - 1]);
			}
			
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
					this.gizmoManager.attachToMesh(null);
				} else {
					// Update UI with remaining selection
					const selectedData = this.selectedMeshes.map(m => this.placedObjects.find(o => o.id === m.metadata.id));
					this.onSelectionChange(selectedData);
					// Reattach gizmo to remaining
					this.gizmoManager.attachToMesh(this.selectedMeshes[this.selectedMeshes.length - 1]);
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
				
				if (data.color) {
					this.applyColorToMesh(root, data.color);
				}
				
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
		
		// --- GIZMO ATTACHMENT ---
		if (this.selectedMeshes.length > 0) {
			// Attach gizmo to the last selected mesh (most recent)
			// For multi-select, we track this mesh's movement and apply delta to others
			const primaryMesh = this.selectedMeshes[this.selectedMeshes.length - 1];
			
			// Check if locked
			const objData = this.placedObjects.find(o => o.id === primaryMesh.metadata.id);
			if (objData && objData.isLocked) {
				this.gizmoManager.attachToMesh(null);
			} else {
				this.gizmoManager.attachToMesh(primaryMesh);
			}
		} else {
			this.gizmoManager.attachToMesh(null);
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
	// Previous drag methods (startDrag, handleDrag, endDrag) removed/deprecated
	// as functionality is now handled by the GizmoManager events in constructor.
	
	// Direct update from Property Panel (Single Object only for now)
	updateObjectProperty (id, prop, value) {
		const mesh = this.findMeshById(id);
		if (!mesh) return;
		
		const objData = this.placedObjects.find(o => o.id === id);
		
		// Handle Locking
		if (prop === 'isLocked') {
			objData.isLocked = value;
			// If we just locked the currently selected object (and it's the one with gizmo), detach gizmo
			if (value && this.gizmoManager.attachedMesh === mesh) {
				this.gizmoManager.attachToMesh(null);
			} else if (!value && this.selectedMeshes.includes(mesh) && !this.gizmoManager.attachedMesh) {
				// If unlocked and selected, reattach
				this.gizmoManager.attachToMesh(mesh);
			}
			return;
		}
		
		// Handle Color Tint
		if (prop === 'color') {
			objData.color = value;
			this.applyColorToMesh(mesh, value);
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
			// Update Gizmo visibility based on lock status
			if (value) {
				this.gizmoManager.attachToMesh(null);
			} else if (this.selectedMeshes.length > 0) {
				this.gizmoManager.attachToMesh(this.selectedMeshes[this.selectedMeshes.length - 1]);
			}
		}
	}
	
	// Helper to apply color recursively
	applyColorToMesh (root, hexColor) {
		const color = BABYLON.Color3.FromHexString(hexColor);
		const meshes = root.getChildMeshes(false);
		// Include root if it has material
		if (root.material) meshes.push(root);
		
		meshes.forEach(m => {
			if (m.material) {
				// Clone material to avoid affecting other instances sharing same material
				if (!m.material.name.includes('_tinted')) {
					m.material = m.material.clone(m.material.name + '_tinted');
				}
				
				if (m.material instanceof BABYLON.PBRMaterial) {
					m.material.albedoColor = color;
				} else if (m.material instanceof BABYLON.StandardMaterial) {
					m.material.diffuseColor = color;
				}
			}
		});
	}
	
	// Align Selected Objects
	// Mode: 'min', 'max', 'center'
	alignSelection(axis, mode) {
		if (this.selectedMeshes.length < 2) return;
		
		// 1. Calculate Group Bounds
		let groupMin = Number.MAX_VALUE;
		let groupMax = -Number.MAX_VALUE;
		
		// We need to check the bounds of every selected object to find the extreme edges
		this.selectedMeshes.forEach(m => {
			const bounds = m.getHierarchyBoundingVectors();
			if (axis === 'x') {
				if (bounds.min.x < groupMin) groupMin = bounds.min.x;
				if (bounds.max.x > groupMax) groupMax = bounds.max.x;
			} else if (axis === 'y') {
				if (bounds.min.y < groupMin) groupMin = bounds.min.y;
				if (bounds.max.y > groupMax) groupMax = bounds.max.y;
			} else if (axis === 'z') {
				if (bounds.min.z < groupMin) groupMin = bounds.min.z;
				if (bounds.max.z > groupMax) groupMax = bounds.max.z;
			}
		});
		
		const groupCenter = (groupMin + groupMax) / 2;
		const targetValue = (mode === 'min') ? groupMin : (mode === 'max') ? groupMax : groupCenter;
		
		// 2. Prepare Changes
		const changes = [];
		
		this.selectedMeshes.forEach(mesh => {
			const id = mesh.metadata.id;
			
			// Check if locked
			const objData = this.placedObjects.find(o => o.id === id);
			if (objData && objData.isLocked) return;
			
			// Calculate this object's specific edge/center
			const bounds = mesh.getHierarchyBoundingVectors();
			let objValue;
			
			if (axis === 'x') {
				objValue = (mode === 'min') ? bounds.min.x : (mode === 'max') ? bounds.max.x : (bounds.min.x + bounds.max.x) / 2;
			} else if (axis === 'y') {
				objValue = (mode === 'min') ? bounds.min.y : (mode === 'max') ? bounds.max.y : (bounds.min.y + bounds.max.y) / 2;
			} else if (axis === 'z') {
				objValue = (mode === 'min') ? bounds.min.z : (mode === 'max') ? bounds.max.z : (bounds.min.z + bounds.max.z) / 2;
			}
			
			const delta = targetValue - objValue;
			
			// Skip if already aligned (float tolerance)
			if (Math.abs(delta) < 0.001) return;
			
			const oldData = {
				position: mesh.position.asArray(),
				rotation: mesh.rotation.asArray(),
				scaling: mesh.scaling.asArray()
			};
			
			// Apply to Mesh
			if (axis === 'x') mesh.position.x += delta;
			if (axis === 'y') mesh.position.y += delta;
			if (axis === 'z') mesh.position.z += delta;
			
			const newData = {
				position: mesh.position.asArray(),
				rotation: mesh.rotation.asArray(),
				scaling: mesh.scaling.asArray()
			};
			
			// Update Internal Data
			if (objData) {
				objData.position = newData.position;
			}
			
			changes.push({
				id: id,
				oldData: oldData,
				newData: newData
			});
		});
		
		// 3. History & Notify
		if (changes.length > 0) {
			this.undoRedo.add({
				type: 'TRANSFORM',
				data: changes
			});
			
			// Notify UI (Selection Change)
			if (this.onSelectionChange) {
				const selectedData = this.selectedMeshes.map(m => this.placedObjects.find(o => o.id === m.metadata.id));
				this.onSelectionChange(selectedData);
			}
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
	
	// New: Clear Scene Method
	clearScene () {
		this.loadMapData({ assets: [] });
	}
	
	// Auto-Save Logic
	saveToAutoSave() {
		if (!this.autoSaveEnabled) return false;
		const data = this.getMapData('autosave');
		localStorage.setItem(LS_AUTOSAVE_KEY, JSON.stringify(data));
		return true;
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
