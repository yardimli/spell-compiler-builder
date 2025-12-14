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
		this.selectionProxy = null; // TransformNode for multi-selection group transforms
		
		// Settings
		this._gridSize = 2.5;
		this.defaultYOffset = 0;
		this.autoSaveEnabled = true;
		this.gizmoMode = 'position'; // 'position', 'rotation', 'scaling'
		
		// Initialize Undo/Redo Manager
		this.undoRedo = new UndoRedoManager(this);
		
		// Events
		this.onSelectionChange = null; // Callback for UI
		
		// Gizmo Manager
		this.gizmoManager = new BABYLON.GizmoManager(this.scene);
		this.setupGizmo();
		
		// Drag State
		this.dragStartData = null;
	}
	
	get gridSize () { return this._gridSize; }
	set gridSize (val) {
		this._gridSize = val;
		this.updateGizmoSettings();
	}
	
	// --- Gizmo Setup ---
	setupGizmo () {
		// Initialize all gizmos but control visibility via updateGizmoSettings
		this.gizmoManager.positionGizmoEnabled = true;
		this.gizmoManager.rotationGizmoEnabled = true;
		this.gizmoManager.scaleGizmoEnabled = true;
		this.gizmoManager.boundingBoxGizmoEnabled = false;
		
		// Don't attach automatically on pointer events, we control attachment via selection
		this.gizmoManager.usePointerToAttachGizmos = false;
		this.gizmoManager.clearGizmoOnEmptyPointerEvent = true;
		
		// --- Undo/Redo Logic for All Gizmos ---
		// We hook into the active gizmo's drag events to record state.
		// Since we can switch modes, we need a generic handler or hook all.
		
		const setupDragEvents = (gizmoType) => {
			const gizmo = this.gizmoManager.gizmos[gizmoType];
			if (!gizmo) return;
			
			gizmo.onDragStartObservable.add(() => {
				if (this.selectedMeshes.length === 0) return;
				
				// Snapshot World Transforms for Undo
				this.dragStartData = this.selectedMeshes.map(mesh => ({
					id: mesh.metadata.id,
					position: mesh.absolutePosition.asArray(),
					rotation: mesh.absoluteRotationQuaternion.toEulerAngles().asArray(),
					scaling: mesh.absoluteScaling.asArray()
				}));
			});
			
			gizmo.onDragEndObservable.add(() => {
				if (!this.dragStartData) return;
				
				const changes = [];
				
				// Calculate New World Transforms
				this.selectedMeshes.forEach(mesh => {
					const id = mesh.metadata.id;
					const startData = this.dragStartData.find(d => d.id === id);
					if (!startData) return;
					
					// Get current absolute values
					// Note: If parented to proxy, absolutePosition handles the math
					const currentPos = mesh.absolutePosition;
					const currentRot = mesh.absoluteRotationQuaternion.toEulerAngles();
					const currentScale = mesh.absoluteScaling;
					
					const currentData = {
						position: currentPos.asArray(),
						rotation: currentRot.asArray(),
						scaling: currentScale.asArray()
					};
					
					// Check if changed (simple stringify check)
					if (JSON.stringify(currentData) !== JSON.stringify(startData)) {
						// Update internal data model immediately
						const objIndex = this.placedObjects.findIndex(o => o.id === id);
						if (objIndex !== -1) {
							this.placedObjects[objIndex].position = currentData.position;
							this.placedObjects[objIndex].rotation = currentData.rotation;
							this.placedObjects[objIndex].scaling = currentData.scaling;
						}
						
						changes.push({
							id: id,
							oldData: {
								position: startData.position,
								rotation: startData.rotation,
								scaling: startData.scaling
							},
							newData: currentData
						});
					}
				});
				
				if (changes.length > 0) {
					this.undoRedo.add({
						type: 'TRANSFORM',
						data: changes
					});
					
					// Update UI if single selection
					if (this.selectedMeshes.length === 1 && this.onSelectionChange) {
						const data = this.placedObjects.find(o => o.id === this.selectedMeshes[0].metadata.id);
						this.onSelectionChange([data]);
					}
				}
				
				this.dragStartData = null;
			});
		};
		
		setupDragEvents('positionGizmo');
		setupDragEvents('rotationGizmo');
		setupDragEvents('scaleGizmo');
		
		this.updateGizmoSettings();
	}
	
	setGizmoMode (mode) {
		this.gizmoMode = mode;
		this.updateGizmoSettings();
	}
	
	updateGizmoSettings () {
		// Enable only the active gizmo
		this.gizmoManager.positionGizmoEnabled = (this.gizmoMode === 'position');
		this.gizmoManager.rotationGizmoEnabled = (this.gizmoMode === 'rotation');
		this.gizmoManager.scaleGizmoEnabled = (this.gizmoMode === 'scaling');
	}
	
	// --- Object Management ---
	
	async addAsset (filename, position) {
		try {
			// STACKING LOGIC: Check if a single object is selected to stack on top
			let targetX = position.x;
			let targetZ = position.z;
			let baseY = position.y;
			
			if (this.selectedMeshes.length === 1) {
				const baseMesh = this.selectedMeshes[0];
				const bounds = baseMesh.getHierarchyBoundingVectors();
				targetX = (bounds.min.x + bounds.max.x) / 2;
				targetZ = (bounds.min.z + bounds.max.z) / 2;
				baseY = bounds.max.y;
			}
			
			const id = BABYLON.Tools.RandomId();
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
			
			root.computeWorldMatrix(true);
			result.meshes.forEach(m => m.computeWorldMatrix(true));
			
			const bounds = root.getHierarchyBoundingVectors();
			const heightOffset = -bounds.min.y;
			
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
				color: '#ffffff',
				position: root.position.asArray(),
				rotation: root.rotationQuaternion ? root.rotationQuaternion.toEulerAngles().asArray() : root.rotation.asArray(),
				scaling: root.scaling.asArray()
			};
			
			this.placedObjects.push(objData);
			this.selectObject(root, false);
			
			this.undoRedo.add({ type: 'ADD', data: [objData] });
		} catch (err) {
			console.error('Error adding asset:', err);
		}
	}
	
	async addAssetGrid (filename, position, rows, cols) {
		try {
			const result = await BABYLON.SceneLoader.ImportMeshAsync('', ASSET_FOLDER, filename, this.scene);
			const root = result.meshes[0];
			
			const bounds = root.getHierarchyBoundingVectors();
			const width = bounds.max.x - bounds.min.x;
			const depth = bounds.max.z - bounds.min.z;
			const heightOffset = -bounds.min.y;
			
			const addedObjectsData = [];
			const baseName = filename.replace(/\.glb$/i, '');
			
			const startX = position.x - (width * cols) / 2 + width / 2;
			const startZ = position.z - (depth * rows) / 2 + depth / 2;
			
			const setupMesh = (mesh, r, c) => {
				const id = BABYLON.Tools.RandomId();
				const existingCount = this.placedObjects.filter(o => o.name && o.name.startsWith(baseName)).length + addedObjectsData.length;
				const uniqueName = `${baseName}_${existingCount + 1}`;
				
				mesh.name = uniqueName;
				mesh.position = new BABYLON.Vector3(
					startX + c * width,
					position.y + heightOffset + this.defaultYOffset,
					startZ + r * depth
				);
				
				mesh.metadata = { id: id, isObject: true, file: filename };
				
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
			
			setupMesh(root, 0, 0);
			
			for (let r = 0; r < rows; r++) {
				for (let c = 0; c < cols; c++) {
					if (r === 0 && c === 0) continue;
					const clone = root.clone();
					setupMesh(clone, r, c);
				}
			}
			
			this.selectedMeshes = [];
			addedObjectsData.forEach(d => {
				const m = this.findMeshById(d.id);
				if (m) this.selectObject(m, true);
			});
			
			this.undoRedo.add({ type: 'ADD', data: addedObjectsData });
		} catch (e) {
			console.error('Grid spawn error:', e);
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
		
		const meshesToDelete = [...this.selectedMeshes];
		
		meshesToDelete.forEach(mesh => {
			const id = mesh.metadata.id;
			const objData = this.placedObjects.find(o => o.id === id);
			
			if (objData && !objData.isLocked) {
				deletedData.push(objData);
				deletedIds.push(id);
				this.removeObjectById(id, false);
			}
		});
		
		if (deletedData.length > 0) {
			this.undoRedo.add({ type: 'DELETE', data: deletedData });
		}
		
		this.onSelectionChange(null);
	}
	
	duplicateSelection () {
		if (this.selectedMeshes.length === 0) return;
		
		const newObjectsData = [];
		const newMeshes = [];
		
		this.selectedMeshes.forEach(m => this.setSelectionHighlight(m, false));
		
		this.selectedMeshes.forEach(originalMesh => {
			const originalData = this.placedObjects.find(o => o.id === originalMesh.metadata.id);
			if (!originalData) return;
			
			const newId = BABYLON.Tools.RandomId();
			const baseName = originalData.name.split('_')[0];
			const newName = `${baseName}_copy_${Math.floor(Math.random() * 1000)}`;
			
			const offset = new BABYLON.Vector3(0.5, 0, 0.5);
			// Use absolute position for cloning
			const newPos = originalMesh.absolutePosition.clone().add(offset);
			
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
				newRoot = originalMesh.instantiateHierarchy(null, { doNotInstantiate: true });
				newRoot.name = newName;
				newRoot.position = newPos;
				// Ensure we copy rotation/scale correctly if original was parented
				newRoot.rotationQuaternion = originalMesh.absoluteRotationQuaternion.clone();
				newRoot.scaling = originalMesh.absoluteScaling.clone();
				
				newRoot.metadata = { id: newId, isObject: true, file: originalData.file };
				
				const descendants = newRoot.getChildMeshes(false);
				if (newRoot instanceof BABYLON.Mesh) descendants.push(newRoot);
				
				descendants.forEach(m => {
					this.shadowGenerator.addShadowCaster(m, true);
					m.receiveShadows = true;
					m.isPickable = true;
					
					if (m.material && m.material.name.includes('_tinted')) {
						m.material = m.material.clone(m.material.name + '_' + newId);
					}
				});
			}
			
			const newData = {
				id: newId,
				name: newName,
				type: originalData.type || 'mesh',
				file: originalData.file,
				isLocked: false,
				color: originalData.color || '#ffffff',
				position: newRoot.position.asArray(),
				rotation: newRoot.rotationQuaternion ? newRoot.rotationQuaternion.toEulerAngles().asArray() : newRoot.rotation.asArray(),
				scaling: newRoot.scaling.asArray()
			};
			
			this.placedObjects.push(newData);
			newObjectsData.push(newData);
			newMeshes.push(newRoot);
		});
		
		// Reset selection to new objects
		this.selectObject(null, false); // Clears proxy
		newMeshes.forEach(m => this.selectObject(m, true));
		
		this.undoRedo.add({ type: 'ADD', data: newObjectsData });
	}
	
	removeObjectById (id, clearSelection = true) {
		const mesh = this.findMeshById(id);
		if (mesh) {
			if (clearSelection) {
				this.selectedMeshes = this.selectedMeshes.filter(m => m !== mesh);
				this.updateSelectionProxy();
			}
			mesh.dispose();
		}
		
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
	
	// --- New Helper for Undo/Redo Selection ---
	selectObjectsByIds (ids) {
		// Clear current selection
		this.selectObject(null, false);
		
		// Find and select objects from the ID list
		const meshesToSelect = [];
		ids.forEach(id => {
			const mesh = this.findMeshById(id);
			if (mesh) {
				meshesToSelect.push(mesh);
			}
		});
		
		if (meshesToSelect.length > 0) {
			// Select first one to init, then others as multi-select
			this.selectObject(meshesToSelect[0], false);
			for (let i = 1; i < meshesToSelect.length; i++) {
				this.selectObject(meshesToSelect[i], true);
			}
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
					this.setSelectionHighlight(mesh, false);
					this.selectedMeshes.splice(index, 1);
				} else {
					this.selectedMeshes.push(mesh);
					this.setSelectionHighlight(mesh, true);
				}
			}
		}
		
		this.updateSelectionProxy();
		
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
	
	// Handles creating/destroying the proxy node for multi-selection
	updateSelectionProxy () {
		// 1. Cleanup existing proxy
		if (this.selectionProxy) {
			// Unparent children (restores world transform)
			// Note: We must be careful not to leave them parented to disposed node
			const children = this.selectionProxy.getChildren();
			children.forEach(c => c.setParent(null));
			
			this.gizmoManager.attachToMesh(null);
			this.selectionProxy.dispose();
			this.selectionProxy = null;
		}
		
		// 2. Setup new state
		if (this.selectedMeshes.length === 0) {
			this.gizmoManager.attachToMesh(null);
			return;
		}
		
		// Check if all selected are locked
		const allLocked = this.selectedMeshes.every(m => {
			const data = this.placedObjects.find(o => o.id === m.metadata.id);
			return data && data.isLocked;
		});
		
		if (allLocked) {
			this.gizmoManager.attachToMesh(null);
			return;
		}
		
		if (this.selectedMeshes.length === 1) {
			// Single Object: Attach directly
			this.gizmoManager.attachToMesh(this.selectedMeshes[0]);
		} else {
			// Multi Object: Create Proxy
			this.selectionProxy = new BABYLON.TransformNode('selectionProxy', this.scene);
			
			// Calculate Center
			let min = new BABYLON.Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
			let max = new BABYLON.Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);
			
			this.selectedMeshes.forEach(m => {
				const bounds = m.getHierarchyBoundingVectors();
				min = BABYLON.Vector3.Minimize(min, bounds.min);
				max = BABYLON.Vector3.Maximize(max, bounds.max);
			});
			
			const center = min.add(max).scale(0.5);
			this.selectionProxy.position = center;
			
			// Parent meshes to proxy (maintains world position)
			this.selectedMeshes.forEach(m => m.setParent(this.selectionProxy));
			
			this.gizmoManager.attachToMesh(this.selectionProxy);
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
	
	// --- Transformation  ---
	
	updateObjectProperty (id, prop, value) {
		const mesh = this.findMeshById(id);
		if (!mesh) return;
		
		const objData = this.placedObjects.find(o => o.id === id);
		
		// Handle Locking
		if (prop === 'isLocked') {
			objData.isLocked = value;
			// Refresh gizmo attachment logic
			this.updateSelectionProxy();
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
			position: mesh.absolutePosition.asArray(),
			rotation: mesh.absoluteRotationQuaternion.toEulerAngles().asArray(),
			scaling: mesh.absoluteScaling.asArray()
		};
		
		if (prop === 'name') {
			mesh.name = value;
			objData.name = value;
			return;
		}
		
		// If we are modifying transform properties manually via UI,
		// we should temporarily detach from proxy to set absolute values easily,
		// or calculate local values.
		// Simplest: If mesh has parent (proxy), detach, update, re-attach?
		// Or just use setAbsolutePosition.
		
		if (prop === 'position') {
			mesh.setAbsolutePosition(new BABYLON.Vector3(value.x, value.y, value.z));
			objData.position = [value.x, value.y, value.z];
		} else if (prop === 'rotation') {
			// Convert degrees to radians
			const rads = new BABYLON.Vector3(
				BABYLON.Tools.ToRadians(value.x),
				BABYLON.Tools.ToRadians(value.y),
				BABYLON.Tools.ToRadians(value.z)
			);
			mesh.rotationQuaternion = BABYLON.Quaternion.FromEulerVector(rads);
			objData.rotation = rads.asArray();
		} else if (prop === 'scaling') {
			// Scaling is tricky with parents.
			// For UI input, we usually mean local scaling if single object,
			// or absolute scaling?
			// Let's assume local scaling for single object edit.
			mesh.scaling = new BABYLON.Vector3(value.x, value.y, value.z);
			objData.scaling = [value.x, value.y, value.z];
		}
		
		const newData = {
			position: mesh.absolutePosition.asArray(),
			rotation: mesh.absoluteRotationQuaternion.toEulerAngles().asArray(),
			scaling: mesh.absoluteScaling.asArray()
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
	
	updateMultipleObjectsProperty (prop, value) {
		if (prop === 'isLocked') {
			this.selectedMeshes.forEach(mesh => {
				const objData = this.placedObjects.find(o => o.id === mesh.metadata.id);
				if (objData) objData.isLocked = value;
			});
			this.updateSelectionProxy();
		}
	}
	
	applyColorToMesh (root, hexColor) {
		const color = BABYLON.Color3.FromHexString(hexColor);
		const meshes = root.getChildMeshes(false);
		if (root.material) meshes.push(root);
		
		meshes.forEach(m => {
			if (m.material) {
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
	
	alignSelection (axis, mode) {
		if (this.selectedMeshes.length < 2) return;
		
		// Detach proxy to manipulate individual positions easily
		if (this.selectionProxy) {
			this.selectedMeshes.forEach(m => m.setParent(null));
			this.selectionProxy.dispose();
			this.selectionProxy = null;
			this.gizmoManager.attachToMesh(null);
		}
		
		let groupMin = Number.MAX_VALUE;
		let groupMax = -Number.MAX_VALUE;
		
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
		
		const changes = [];
		
		this.selectedMeshes.forEach(mesh => {
			const id = mesh.metadata.id;
			const objData = this.placedObjects.find(o => o.id === id);
			if (objData && objData.isLocked) return;
			
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
			if (Math.abs(delta) < 0.001) return;
			
			const oldData = {
				position: mesh.absolutePosition.asArray(),
				rotation: mesh.absoluteRotationQuaternion.toEulerAngles().asArray(),
				scaling: mesh.absoluteScaling.asArray()
			};
			
			if (axis === 'x') mesh.position.x += delta;
			if (axis === 'y') mesh.position.y += delta;
			if (axis === 'z') mesh.position.z += delta;
			
			const newData = {
				position: mesh.absolutePosition.asArray(),
				rotation: mesh.absoluteRotationQuaternion.toEulerAngles().asArray(),
				scaling: mesh.absoluteScaling.asArray()
			};
			
			if (objData) {
				objData.position = newData.position;
			}
			
			changes.push({
				id: id,
				oldData: oldData,
				newData: newData
			});
		});
		
		if (changes.length > 0) {
			this.undoRedo.add({
				type: 'TRANSFORM',
				data: changes
			});
			
			if (this.onSelectionChange) {
				const selectedData = this.selectedMeshes.map(m => this.placedObjects.find(o => o.id === m.metadata.id));
				this.onSelectionChange(selectedData);
			}
		}
		
		// Re-establish proxy
		this.updateSelectionProxy();
	}
	
	// --- Updated Method: Snap Selection Side-by-Side (Respects Locked Objects) ---
	snapSelection (axis) {
		if (this.selectedMeshes.length < 2) return;
		
		// 1. Detach Proxy to handle individual transforms
		if (this.selectionProxy) {
			this.selectedMeshes.forEach(m => m.setParent(null));
			this.selectionProxy.dispose();
			this.selectionProxy = null;
			this.gizmoManager.attachToMesh(null);
		}
		
		// 2. Capture State for Undo
		const changes = [];
		this.selectedMeshes.forEach(mesh => {
			changes.push({
				id: mesh.metadata.id,
				oldData: {
					position: mesh.absolutePosition.asArray(),
					rotation: mesh.absoluteRotationQuaternion.toEulerAngles().asArray(),
					scaling: mesh.absoluteScaling.asArray()
				},
				newData: null // Filled later
			});
		});
		
		// 3. Prepare data with bounds and locked status
		const meshesWithBounds = this.selectedMeshes.map(mesh => {
			mesh.computeWorldMatrix(true);
			const objData = this.placedObjects.find(o => o.id === mesh.metadata.id);
			return {
				mesh: mesh,
				data: objData,
				bounds: mesh.getHierarchyBoundingVectors()
			};
		});
		
		// 4. Sort Meshes along axis
		meshesWithBounds.sort((a, b) => {
			return a.bounds.min[axis] - b.bounds.min[axis];
		});
		
		// 5. Apply Spacing Logic
		const lockedIndices = meshesWithBounds.map((m, i) => m.data.isLocked ? i : -1).filter(i => i !== -1);
		
		if (lockedIndices.length === 0) {
			// Standard Behavior: No locked objects, snap everything left-to-right starting from first
			let currentEdge = meshesWithBounds[0].bounds.max[axis];
			
			for (let i = 1; i < meshesWithBounds.length; i++) {
				const item = meshesWithBounds[i];
				const mesh = item.mesh;
				
				const dim = item.bounds.max[axis] - item.bounds.min[axis];
				const currentMin = item.bounds.min[axis];
				const shift = currentEdge - currentMin;
				
				mesh.position[axis] += shift;
				currentEdge += dim;
				mesh.computeWorldMatrix(true);
			}
		} else {
			// Locked Behavior: Use locked objects as anchors
			// We use the first locked object found in the sorted list as the primary pivot.
			// Objects before it snap backwards (right-to-left).
			// Objects after it snap forwards (left-to-right).
			// If subsequent locked objects are encountered, they reset the snapping edge.
			
			const pivotIndex = lockedIndices[0];
			
			// A. Process Backwards (from pivotIndex - 1 down to 0)
			// The edge starts at the min of the pivot
			let backEdge = meshesWithBounds[pivotIndex].bounds.min[axis];
			
			for (let i = pivotIndex - 1; i >= 0; i--) {
				const item = meshesWithBounds[i];
				const mesh = item.mesh;
				
				if (item.data.isLocked) {
					// If we hit another locked object going backwards, it stays put.
					// Reset the edge to this object's min for any further preceding objects.
					backEdge = item.bounds.min[axis];
				} else {
					// Move object so its MAX touches backEdge
					const dim = item.bounds.max[axis] - item.bounds.min[axis];
					const currentMax = item.bounds.max[axis];
					const shift = backEdge - currentMax;
					
					mesh.position[axis] += shift;
					// New backEdge is the min of this moved object
					backEdge -= dim;
					mesh.computeWorldMatrix(true);
				}
			}
			
			// B. Process Forwards (from pivotIndex + 1 to end)
			// The edge starts at the max of the pivot
			let fwdEdge = meshesWithBounds[pivotIndex].bounds.max[axis];
			
			for (let i = pivotIndex + 1; i < meshesWithBounds.length; i++) {
				const item = meshesWithBounds[i];
				const mesh = item.mesh;
				
				if (item.data.isLocked) {
					// If we hit another locked object going forward, it stays put.
					// Reset the edge to this object's max for subsequent objects.
					fwdEdge = item.bounds.max[axis];
				} else {
					// Move object so its MIN touches fwdEdge
					const dim = item.bounds.max[axis] - item.bounds.min[axis];
					const currentMin = item.bounds.min[axis];
					const shift = fwdEdge - currentMin;
					
					mesh.position[axis] += shift;
					fwdEdge += dim;
					mesh.computeWorldMatrix(true);
				}
			}
		}
		
		// 6. Update Undo Data & Internal State
		changes.forEach(change => {
			const mesh = this.findMeshById(change.id);
			const objData = this.placedObjects.find(o => o.id === change.id);
			
			const newData = {
				position: mesh.absolutePosition.asArray(),
				rotation: mesh.absoluteRotationQuaternion.toEulerAngles().asArray(),
				scaling: mesh.absoluteScaling.asArray()
			};
			
			change.newData = newData;
			
			// Update internal model
			if (objData) {
				objData.position = newData.position;
			}
		});
		
		// Filter out no-ops
		const actualChanges = changes.filter(c =>
			JSON.stringify(c.oldData) !== JSON.stringify(c.newData)
		);
		
		if (actualChanges.length > 0) {
			this.undoRedo.add({
				type: 'TRANSFORM',
				data: actualChanges
			});
			
			// Update UI if needed
			if (this.onSelectionChange) {
				const selectedData = this.selectedMeshes.map(m => this.placedObjects.find(o => o.id === m.metadata.id));
				this.onSelectionChange(selectedData);
			}
		}
		
		// 7. Re-attach Proxy
		this.updateSelectionProxy();
	}
	
	updateObjectTransform (id, data) {
		// When undoing, we might need to detach proxy to set absolute values correctly
		if (this.selectionProxy) {
			this.selectObject(null, false); // Clear selection to remove proxy
		}
		
		const mesh = this.findMeshById(id);
		if (!mesh) return;
		
		mesh.position = BABYLON.Vector3.FromArray(data.position);
		mesh.rotationQuaternion = BABYLON.Quaternion.FromEulerVector(BABYLON.Vector3.FromArray(data.rotation));
		mesh.scaling = BABYLON.Vector3.FromArray(data.scaling);
		
		const objData = this.placedObjects.find(o => o.id === id);
		if (objData) {
			objData.position = data.position;
			objData.rotation = data.rotation;
			objData.scaling = data.scaling;
		}
		
		if (this.selectedMeshes.includes(mesh) && this.selectedMeshes.length === 1 && this.onSelectionChange) {
			this.onSelectionChange([objData]);
		}
	}
	
	getMapData (mapName) {
		return {
			name: mapName,
			version: 2,
			assets: this.placedObjects
		};
	}
	
	loadMapData (data) {
		[...this.scene.meshes].forEach(m => {
			if (m.metadata && m.metadata.isObject) m.dispose();
		});
		[...this.scene.lights].forEach(l => {
			if (l.metadata && l.metadata.isObject) l.dispose();
		});
		
		this.placedObjects = [];
		this.selectedMeshes = [];
		this.undoRedo.history = [];
		this.undoRedo.historyIndex = -1;
		if (this.undoRedo.onHistoryChange) this.undoRedo.onHistoryChange();
		
		this.selectObject(null, false);
		
		if (data.assets) {
			data.assets.forEach(item => this.restoreObject(item));
		}
	}
	
	clearScene () {
		this.loadMapData({ assets: [] });
	}
	
	saveToAutoSave () {
		if (!this.autoSaveEnabled) return false;
		const data = this.getMapData('autosave');
		localStorage.setItem(LS_AUTOSAVE_KEY, JSON.stringify(data));
		return true;
	}
	
	loadFromAutoSave () {
		const saved = localStorage.getItem(LS_AUTOSAVE_KEY);
		if (saved) {
			try {
				const data = JSON.parse(saved);
				console.log('Restoring auto-saved map...');
				this.loadMapData(data);
			} catch (e) {
				console.error('Failed to load auto-save', e);
			}
		}
	}
}
