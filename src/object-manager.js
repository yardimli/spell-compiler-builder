import * as BABYLON from '@babylonjs/core';
import { UndoRedoManager } from './undo-redo';
import { GizmoController } from './managers/gizmo-controller';
import { GroupManager } from './managers/group-manager';
import { AlignmentManager } from './managers/alignment-manager';
import { PropertyManager } from './managers/property-manager';
import { OperationManager } from './managers/operation-manager';
import { SnapManager } from './managers/snap-manager';
import { LightManager } from './managers/light-manager';

// Updated root path for assets
const ASSET_ROOT = './assets/objects/';
const LS_AUTOSAVE_KEY = 'builder_autosave_map';
const LS_SELECTION_KEY = 'builder_selection_state';

export class ObjectManager {
	constructor (builderScene) {
		// Accept builderScene to access scene and shadowGenerator dynamically
		this.builderScene = builderScene;
		this.scene = builderScene.scene;
		
		// State
		this.placedObjects = []; // Array of metadata objects
		this.groups = []; // Array of { id, name, objectIds: [] }
		this.selectedMeshes = []; // Array of currently selected Babylon Meshes
		this.selectionProxy = null; // TransformNode for multi-selection group transforms
		
		this.activeAssetFile = null;
		
		// Ghost State
		this.ghostMesh = null;
		this.ghostPosition = BABYLON.Vector3.Zero();
		this.isGhostLoading = false;
		this.ghostOffset = 0; // Cached offset to align bottom to pivot
		this.ghostBoundsLocal = null; // Cached local bounds for snapping
		
		// Settings
		this._gridSize = 2.5;
		this.defaultYOffset = 0;
		this.autoSaveEnabled = true;
		this.cursorIncrement = 0.05; // Default increment for arrow key movement
		
		// Precision Step Settings
		this.posStep = 0.1;
		this.rotStep = 15;
		this.scaleStep = 0.1;
		
		// Events
		this.onSelectionChange = null; // Callback for UI
		this.onListChange = null; // Callback for TreeView
		this.onAssetSelectionChange = null;
		
		// Initialize Undo/Redo Manager
		this.undoRedo = new UndoRedoManager(this);
		
		// Initialize Sub-Managers
		this.gizmoController = new GizmoController(this);
		this.groupManager = new GroupManager(this);
		this.alignmentManager = new AlignmentManager(this);
		this.propertyManager = new PropertyManager(this);
		this.operationManager = new OperationManager(this);
		this.snapManager = new SnapManager(this);
		this.lightManager = new LightManager(this);
	}
	
	get gridSize () { return this._gridSize; }
	set gridSize (val) {
		this._gridSize = val;
		this.gizmoController.updateGizmoSettings();
	}
	
	// --- Gizmo Delegation ---
	get gizmoManager () { return this.gizmoController.gizmoManager; }
	setGizmoMode (mode) { this.gizmoController.setMode(mode); }
	updateGizmoSettings () { this.gizmoController.updateGizmoSettings(); }
	
	// --- Group Delegation ---
	createGroup (name, objectIds) { this.groupManager.createGroup(name, objectIds); }
	deleteGroup (groupId) { this.groupManager.deleteGroup(groupId); }
	renameGroup (groupId, newName) { this.groupManager.renameGroup(groupId, newName); }
	getGroupOfObject (objectId) { return this.groupManager.getGroupOfObject(objectId); }
	
	// --- Alignment Delegation ---
	alignSelection (axis, mode) { this.alignmentManager.alignSelection(axis, mode); }
	snapSelection (axis, margin) { this.alignmentManager.snapSelection(axis, margin); }
	
	// --- Property Delegation ---
	updateObjectProperty (id, prop, value) { this.propertyManager.updateObjectProperty(id, prop, value); }
	updateMultipleObjectsProperty (prop, value) { this.propertyManager.updateMultipleObjectsProperty(prop, value); }
	updateGroupTransform (prop, values) { this.propertyManager.updateGroupTransform(prop, values); }
	updateObjectTransform (id, data) { this.propertyManager.updateObjectTransform(id, data); }
	
	// Visibility Delegation
	toggleObjectVisibility (id) {
		const obj = this.placedObjects.find(o => o.id === id);
		if (obj) {
			const newState = obj.isVisible === undefined ? false : !obj.isVisible;
			this.propertyManager.updateVisibility(id, newState);
		}
	}
	
	toggleGroupVisibility (groupId) {
		const group = this.groups.find(g => g.id === groupId);
		if (group) {
			// Check if any in group are visible
			const anyVisible = group.objectIds.some(id => {
				const obj = this.placedObjects.find(o => o.id === id);
				return obj && (obj.isVisible !== false);
			});
			
			// If any are visible, hide all. If all hidden, show all.
			const targetState = !anyVisible;
			
			// Use batch update to create single undo entry
			this.propertyManager.updateVisibilityBatch(group.objectIds, targetState);
		}
	}
	
	// --- Operation Delegation ---
	deleteSelected () { this.operationManager.deleteSelected(); }
	duplicateSelection () { this.operationManager.duplicateSelection(); }
	
	// --- Snap Delegation ---
	setAnchor (mesh) { this.snapManager.setAnchor(mesh); }
	releaseAnchor () { this.snapManager.clearAnchor(); }
	
	// --- Asset Selection Logic ---
	setActiveAsset (file) {
		if (this.activeAssetFile === file || file === null) {
			this.activeAssetFile = null;
			this.clearGhost();
		} else {
			this.activeAssetFile = file;
			this.loadGhostAsset(file);
		}
		
		if (this.onAssetSelectionChange) {
			this.onAssetSelectionChange(this.activeAssetFile);
		}
	}
	
	// --- Ghost Logic ---
	async loadGhostAsset (file) {
		this.clearGhost();
		this.isGhostLoading = true;
		
		try {
			const result = await BABYLON.SceneLoader.ImportMeshAsync('', ASSET_ROOT, file, this.scene);
			if (this.activeAssetFile !== file) {
				result.meshes.forEach(m => m.dispose());
				return;
			}
			
			this.ghostMesh = result.meshes[0];
			this.ghostMesh.name = "ghost_asset";
			
			this.ghostMesh.computeWorldMatrix(true);
			result.meshes.forEach(m => {
				m.isPickable = false;
				m.checkCollisions = false;
				m.visibility = 0.5;
				// Remove from any shadow generators if automatically added (unlikely but safe)
				this.builderScene.unregisterShadowCaster(m);
				m.receiveShadows = false;
				if (!m.metadata) m.metadata = {};
				m.metadata.isGhost = true;
			});
			
			const bounds = this.ghostMesh.getHierarchyBoundingVectors();
			this.ghostOffset = -bounds.min.y;
			
			this.ghostBoundsLocal = {
				min: bounds.min.clone(),
				max: bounds.max.clone()
			};
			
			this.ghostMesh.position = new BABYLON.Vector3(0, -1000, 0);
			this.isGhostLoading = false;
			
			this.updateGhostTransformFromSelection();
			
		} catch (e) {
			console.error("Failed to load ghost asset", e);
			this.isGhostLoading = false;
		}
	}
	
	clearGhost () {
		if (this.ghostMesh) {
			this.ghostMesh.dispose(false, true);
			this.ghostMesh = null;
		}
	}
	
	updateGhostTransformFromSelection () {
		if (!this.ghostMesh || !this.activeAssetFile) return;
		
		let shouldCopy = false;
		let sourceMesh = null;
		
		if (this.selectedMeshes.length === 1) {
			const mesh = this.selectedMeshes[0];
			if (mesh.metadata && mesh.metadata.isObject && mesh.metadata.file === this.activeAssetFile) {
				shouldCopy = true;
				sourceMesh = mesh;
			}
		}
		
		if (shouldCopy && sourceMesh) {
			if (!this.ghostMesh.rotationQuaternion) {
				this.ghostMesh.rotationQuaternion = new BABYLON.Quaternion();
			}
			if (sourceMesh.rotationQuaternion) {
				this.ghostMesh.rotationQuaternion.copyFrom(sourceMesh.rotationQuaternion);
			} else {
				BABYLON.Quaternion.FromEulerVectorToRef(sourceMesh.rotation, this.ghostMesh.rotationQuaternion);
			}
			this.ghostMesh.scaling.copyFrom(sourceMesh.scaling);
		} else {
			if (this.ghostMesh.rotationQuaternion) {
				this.ghostMesh.rotationQuaternion.copyFromFloats(0, 0, 0, 1);
			} else {
				this.ghostMesh.rotation.set(0, 0, 0);
			}
			this.ghostMesh.scaling.set(1, 1, 1);
		}
	}
	
	// Uses SnapManager
	updateGhostPosition (pickInfo) {
		if (!this.ghostMesh || this.isGhostLoading || !pickInfo.hit) return;
		
		let targetPos = pickInfo.pickedPoint.clone();
		let isStacked = false;
		
		// 1. Stacking Logic
		if (pickInfo.pickedMesh && pickInfo.pickedMesh.name !== 'ground') {
			let mesh = pickInfo.pickedMesh;
			while (mesh && (!mesh.metadata || !mesh.metadata.isObject) && mesh.parent) {
				mesh = mesh.parent;
			}
			
			if (mesh) {
				mesh.computeWorldMatrix(true);
				const bounds = mesh.getHierarchyBoundingVectors();
				targetPos.y = bounds.max.y;
				isStacked = true;
			}
		}
		
		targetPos.y += this.ghostOffset;
		if (!isStacked) {
			targetPos.y += this.defaultYOffset;
		}
		
		// 2. Snapping Logic (Delegated to SnapManager)
		// Determine targets: Anchor takes priority, otherwise selected meshes
		let snapTargets = [];
		if (this.snapManager.anchorMesh) {
			snapTargets = [this.snapManager.anchorMesh];
		} else if (this.selectedMeshes.length > 0) {
			snapTargets = this.selectedMeshes;
		}
		
		if (snapTargets.length > 0 && this.ghostBoundsLocal) {
			const snapOffset = this.snapManager.calculateSnapOffset(
				targetPos,
				this.ghostBoundsLocal,
				this.ghostMesh.rotationQuaternion || BABYLON.Quaternion.FromEulerVector(this.ghostMesh.rotation),
				this.ghostMesh.scaling,
				snapTargets
			);
			
			if (snapOffset) {
				targetPos.x += snapOffset.x;
				targetPos.y += snapOffset.y;
				targetPos.z += snapOffset.z;
			}
		}
		
		this.ghostMesh.position = targetPos;
		this.ghostPosition = targetPos;
	}
	
	nudgeSelection (x, y, z) {
		if (this.selectedMeshes.length === 0) return;
		
		const changes = [];
		const offset = new BABYLON.Vector3(x, y, z);
		
		this.selectedMeshes.forEach(mesh => {
			const id = mesh.metadata.id;
			const objData = this.placedObjects.find(o => o.id === id);
			if (objData && objData.isLocked) return;
			
			const oldData = {
				position: mesh.absolutePosition.asArray(),
				rotation: mesh.absoluteRotationQuaternion.toEulerAngles().asArray(),
				scaling: mesh.absoluteScaling.asArray()
			};
			
			mesh.position.addInPlace(offset);
			mesh.computeWorldMatrix(true);
			
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
			
			this.updateSelectionProxy();
			
			if (this.onSelectionChange) {
				const selectedData = this.selectedMeshes.map(m => this.placedObjects.find(o => o.id === m.metadata.id));
				this.onSelectionChange(selectedData);
			}
		}
	}
	
	async addAsset (filename, explicitPosition = null) {
		try {
			let targetX = 0;
			let targetZ = 0;
			let baseY = 0;
			let useExplicit = false;
			
			if (explicitPosition) {
				targetX = explicitPosition.x;
				baseY = explicitPosition.y;
				targetZ = explicitPosition.z;
				useExplicit = true;
			} else {
				if (this.selectedMeshes.length === 1) {
					const baseMesh = this.selectedMeshes[0];
					const bounds = baseMesh.getHierarchyBoundingVectors();
					targetX = (bounds.min.x + bounds.max.x) / 2;
					targetZ = (bounds.min.z + bounds.max.z) / 2;
					baseY = bounds.max.y;
				}
			}
			
			const id = BABYLON.Tools.RandomId();
			const baseName = filename.split('/').pop().replace(/\.glb$/i, '');
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
			
			const result = await BABYLON.SceneLoader.ImportMeshAsync('', ASSET_ROOT, filename, this.scene);
			const root = result.meshes[0];
			
			root.name = uniqueName;
			
			root.computeWorldMatrix(true);
			
			if (this.ghostMesh && this.activeAssetFile === filename) {
				this.updateGhostTransformFromSelection();
				
				if (!root.rotationQuaternion) root.rotationQuaternion = new BABYLON.Quaternion();
				
				if (this.ghostMesh.rotationQuaternion) {
					root.rotationQuaternion.copyFrom(this.ghostMesh.rotationQuaternion);
				} else {
					BABYLON.Quaternion.FromEulerVectorToRef(this.ghostMesh.rotation, root.rotationQuaternion);
				}
				
				root.scaling.copyFrom(this.ghostMesh.scaling);
				root.computeWorldMatrix(true);
			}
			
			result.meshes.forEach(m => m.computeWorldMatrix(true));
			
			if (useExplicit) {
				root.position = new BABYLON.Vector3(targetX, baseY, targetZ);
			} else {
				const bounds = root.getHierarchyBoundingVectors();
				const heightOffset = -bounds.min.y;
				root.position = new BABYLON.Vector3(targetX, baseY + heightOffset + this.defaultYOffset, targetZ);
			}
			
			root.metadata = { id: id, isObject: true, file: filename };
			
			result.meshes.forEach(m => {
				// Register with all active shadow generators
				this.builderScene.registerShadowCaster(m);
				
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
				color: null,
				position: root.position.asArray(),
				rotation: root.rotationQuaternion ? root.rotationQuaternion.toEulerAngles().asArray() : root.rotation.asArray(),
				scaling: root.scaling.asArray()
			};
			
			this.placedObjects.push(objData);
			
			this.selectObject(root, false);
			
			// If an anchor was active, move it to the newly created object
			if (this.snapManager.anchorMesh) {
				this.snapManager.setAnchor(root);
			}
			
			this.undoRedo.add({ type: 'ADD', data: [objData] });
			if (this.onListChange) this.onListChange();
		} catch (err) {
			console.error('Error adding asset:', err);
		}
	}
	
	async addAssetGrid (filename, position, rows, cols) {
		try {
			const result = await BABYLON.SceneLoader.ImportMeshAsync('', ASSET_ROOT, filename, this.scene);
			const root = result.meshes[0];
			
			const bounds = root.getHierarchyBoundingVectors();
			const width = bounds.max.x - bounds.min.x;
			const depth = bounds.max.z - bounds.min.z;
			const heightOffset = -bounds.min.y;
			
			const addedObjectsData = [];
			const baseName = filename.split('/').pop().replace(/\.glb$/i, '');
			
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
					// Register with all active shadow generators
					this.builderScene.registerShadowCaster(m);
					
					m.receiveShadows = true;
					m.isPickable = true;
				});
				
				const objData = {
					id: id,
					name: uniqueName,
					file: filename,
					type: 'mesh',
					isLocked: false,
					isVisible: true, // NEW
					color: null,
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
			if (this.onListChange) this.onListChange();
		} catch (e) {
			console.error('Grid spawn error:', e);
		}
	}
	
	// Modified to accept type
	addLight (type = 'point', position = null) {
		const pos = position || this.builderScene.selectedCellPosition || new BABYLON.Vector3(0, 5, 0);
		const id = BABYLON.Tools.RandomId();
		const existingLights = this.placedObjects.filter(o => o.type === 'light');
		const name = `Light_${type}_${existingLights.length + 1}`;
		
		// Delegate to LightManager
		const { mesh, light } = this.lightManager.createLight(type, new BABYLON.Vector3(pos.x, pos.y + 5, pos.z), name);
		
		// Add Metadata
		mesh.metadata = { id: id, isObject: true, type: 'light', kind: type };
		
		const objData = {
			id: id,
			name: name,
			type: 'light',
			kind: type,
			isLocked: false,
			isVisible: true,
			color: light.diffuse.toHexString(), // Diffuse
			specularColor: light.specular.toHexString(), // Specular
			groundColor: (type === 'hemispheric') ? light.groundColor.toHexString() : null,
			position: mesh.position.asArray(),
			rotation: mesh.rotationQuaternion ? mesh.rotationQuaternion.toEulerAngles().asArray() : mesh.rotation.asArray(),
			scaling: [1, 1, 1],
			intensity: light.intensity,
			castShadows: false,
			direction: (type !== 'point') ? [light.direction.x, light.direction.y, light.direction.z] : null
		};
		
		this.placedObjects.push(objData);
		this.selectObject(mesh, false);
		this.undoRedo.add({ type: 'ADD', data: [objData] });
		if (this.onListChange) this.onListChange();
	}
	
	removeObjectById (id, clearSelection = true) {
		// If deleting the anchor, clear it first
		const mesh = this.findMeshById(id);
		if (mesh && this.snapManager.anchorMesh === mesh) {
			this.snapManager.clearAnchor();
		}
		
		if (mesh) {
			// If it was a shadow caster, remove it from all generators
			if (mesh.metadata && mesh.metadata.type !== 'light') {
				const descendants = mesh.getChildMeshes(false);
				descendants.push(mesh);
				descendants.forEach(m => this.builderScene.unregisterShadowCaster(m));
			}
			
			// If it was a light casting shadows, disable shadows
			if (mesh.metadata && mesh.metadata.type === 'light') {
				this.builderScene.disableShadows(id);
			}
			
			if (clearSelection) {
				this.selectedMeshes = this.selectedMeshes.filter(m => m !== mesh);
				this.updateSelectionProxy();
			}
			mesh.dispose();
		}
		
		this.placedObjects = this.placedObjects.filter(o => o && o.id !== id);
	}
	
	// Helper to create default Directional Light data
	createDefaultMainLightData () {
		return {
			id: 'main_sun',
			name: 'Sun',
			type: 'light',
			kind: 'directional',
			isLocked: false,
			isVisible: true,
			color: '#ffffff',
			specularColor: '#ffffff',
			position: [20, 40, 20],
			direction: [-1, -2, -1],
			rotation: [0, 0, 0], // Will be calculated from direction
			scaling: [1, 1, 1],
			intensity: 1.0,
			castShadows: true // Default sun casts shadows
		};
	}
	
	createDefaultAmbientLightData () {
		return {
			id: 'ambient_sky',
			name: 'Ambient Sky',
			type: 'light',
			kind: 'hemispheric',
			isLocked: false,
			isVisible: true,
			color: '#ffffff',
			specularColor: '#000000',
			groundColor: '#333333',
			position: [0, 10, 0],
			direction: [0, 1, 0],
			rotation: [0, 0, 0],
			scaling: [1, 1, 1],
			intensity: 0.7,
			castShadows: false
		};
	}
	
	restoreObject (data) {
		if (data.type === 'light') {
			// Delegate to LightManager
			const { mesh, light } = this.lightManager.createLight(data.kind, BABYLON.Vector3.FromArray(data.position), data.name);
			mesh.metadata = { id: data.id, isObject: true, type: 'light', kind: data.kind };
			
			// Apply Properties
			this.lightManager.updateLightProperties(mesh, data);
			
			// Restore Shadow State
			if (data.castShadows) {
				this.builderScene.enableShadows(mesh);
			}
			
			// Visibility
			if (data.isVisible === false) {
				mesh.setEnabled(false);
			}
			
			this.placedObjects.push(data);
			if (this.onListChange) this.onListChange();
			return Promise.resolve();
			
		} else {
			return BABYLON.SceneLoader.ImportMeshAsync('', ASSET_ROOT, data.file, this.scene).then(res => {
				const root = res.meshes[0];
				root.name = data.name;
				root.position = BABYLON.Vector3.FromArray(data.position);
				root.rotation = BABYLON.Vector3.FromArray(data.rotation);
				root.scaling = BABYLON.Vector3.FromArray(data.scaling);
				root.metadata = { id: data.id, isObject: true, file: data.file };
				
				if (data.isVisible === false) root.setEnabled(false);
				
				res.meshes.forEach(m => {
					// Register with all active shadow generators
					this.builderScene.registerShadowCaster(m);
					
					m.receiveShadows = true;
					m.isPickable = true;
					if (m !== root) m.parent = root;
				});
				
				if (data.color) {
					this.applyColorToMesh(root, data.color);
				}
				
				this.placedObjects.push(data);
				if (this.onListChange) this.onListChange();
			}).catch(e => {
				console.error("Failed to restore object:", data.name, e);
			});
		}
	}
	
	selectObjectsByIds (ids) {
		this.selectObject(null, false);
		const meshesToSelect = [];
		ids.forEach(id => {
			const mesh = this.findMeshById(id);
			if (mesh) {
				meshesToSelect.push(mesh);
			}
		});
		
		if (meshesToSelect.length > 0) {
			this.selectObject(meshesToSelect[0], false);
			for (let i = 1; i < meshesToSelect.length; i++) {
				this.selectObject(meshesToSelect[i], true);
			}
		}
	}
	
	selectObject (mesh, isMultiSelect) {
		if (mesh && mesh.parent && mesh.parent.metadata && mesh.parent.metadata.isObject) {
			mesh = mesh.parent;
		}
		
		if (!isMultiSelect) {
			this.selectedMeshes.forEach(m => this.setSelectionHighlight(m, false));
			this.selectedMeshes = [];
			
			if (mesh) {
				this.selectedMeshes.push(mesh);
				this.setSelectionHighlight(mesh, true);
			}
		} else {
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
		this.updateGhostTransformFromSelection();
		
		if (this.onSelectionChange) {
			if (this.selectedMeshes.length > 0) {
				const selectedData = this.selectedMeshes.map(m => this.placedObjects.find(o => o.id === m.metadata.id));
				this.onSelectionChange(selectedData);
			} else {
				this.onSelectionChange(null);
			}
		}
	}
	
	updateSelectionProxy () {
		if (this.selectionProxy) {
			const children = this.selectionProxy.getChildren();
			children.forEach(c => c.setParent(null));
			
			this.gizmoController.attachToMesh(null);
			this.selectionProxy.dispose();
			this.selectionProxy = null;
		}
		
		if (this.selectedMeshes.length === 0) {
			this.gizmoController.attachToMesh(null);
			return;
		}
		
		const allLocked = this.selectedMeshes.every(m => {
			const data = this.placedObjects.find(o => o.id === m.metadata.id);
			return data && data.isLocked;
		});
		
		if (allLocked) {
			this.gizmoController.attachToMesh(null);
			return;
		}
		
		if (this.selectedMeshes.length === 1) {
			this.gizmoController.attachToMesh(this.selectedMeshes[0]);
		} else {
			this.selectionProxy = new BABYLON.TransformNode('selectionProxy', this.scene);
			
			let min = new BABYLON.Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
			let max = new BABYLON.Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);
			
			this.selectedMeshes.forEach(m => {
				const bounds = m.getHierarchyBoundingVectors();
				min = BABYLON.Vector3.Minimize(min, bounds.min);
				max = BABYLON.Vector3.Maximize(max, bounds.max);
			});
			
			const center = min.add(max).scale(0.5);
			this.selectionProxy.position = center;
			
			this.selectedMeshes.forEach(m => m.setParent(this.selectionProxy));
			this.gizmoController.attachToMesh(this.selectionProxy);
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
	
	applyColorToMesh (root, hexColor) {
		const meshes = root.getChildMeshes(false);
		if (root.material) meshes.push(root);
		
		meshes.forEach(m => {
			if (!m.material) return;
			
			if (!m.reservedOriginalMaterial) {
				m.reservedOriginalMaterial = m.material;
			}
			
			if (hexColor === null) {
				if (m.material !== m.reservedOriginalMaterial) {
					const tintedMaterial = m.material;
					m.material = m.reservedOriginalMaterial;
					tintedMaterial.dispose();
				}
			} else {
				const color = BABYLON.Color3.FromHexString(hexColor);
				
				if (m.material === m.reservedOriginalMaterial) {
					const cloneName = m.material.name + '_tinted_' + root.metadata.id;
					const newMat = m.material.clone(cloneName);
					m.material = newMat;
				}
				
				if (m.material instanceof BABYLON.PBRMaterial) {
					m.material.albedoColor = color;
				} else if (m.material instanceof BABYLON.StandardMaterial) {
					m.material.diffuseColor = color;
				}
			}
		});
		
		// Update child light color if present
		const childLight = root.getChildren().find(n => n instanceof BABYLON.Light);
		if (childLight) {
			if (hexColor) {
				childLight.diffuse = BABYLON.Color3.FromHexString(hexColor);
			} else {
				childLight.diffuse = new BABYLON.Color3(1, 1, 1);
			}
		}
	}
	
	getMapData (mapName) {
		return {
			name: mapName,
			version: 2,
			assets: this.placedObjects,
			groups: this.groups
		};
	}
	
	async loadMapData (data) {
		// Clear Anchor when loading new map
		this.snapManager.clearAnchor();
		
		[...this.scene.meshes].forEach(m => {
			if (m.metadata && m.metadata.isObject) m.dispose();
		});
		[...this.scene.lights].forEach(l => {
			if (l.metadata && l.metadata.isObject) l.dispose();
		});
		
		this.placedObjects = [];
		this.groups = data.groups || [];
		this.selectedMeshes = [];
		this.undoRedo.history = [];
		this.undoRedo.historyIndex = -1;
		if (this.undoRedo.onHistoryChange) this.undoRedo.onHistoryChange();
		
		this.selectObject(null, false);
		
		if (this.onListChange) this.onListChange();
		
		if (data.assets && data.assets.length > 0) {
			// Restore Objects
			const promises = data.assets.map(item => this.restoreObject(item));
			await Promise.all(promises);
		} else {
			// No assets (e.g. clearScene), add default lights
			const defaultSun = this.createDefaultMainLightData();
			const defaultAmbient = this.createDefaultAmbientLightData();
			await this.restoreObject(defaultSun);
			await this.restoreObject(defaultAmbient);
		}
	}
	
	clearScene () {
		this.loadMapData({ assets: [], groups: [] });
	}
	
	saveToAutoSave () {
		if (!this.autoSaveEnabled) return false;
		const data = this.getMapData('autosave');
		localStorage.setItem(LS_AUTOSAVE_KEY, JSON.stringify(data));
		
		const selectedIds = this.selectedMeshes.map(m => m.metadata.id);
		localStorage.setItem(LS_SELECTION_KEY, JSON.stringify(selectedIds));
		
		return true;
	}
	
	async loadFromAutoSave () {
		const saved = localStorage.getItem(LS_AUTOSAVE_KEY);
		if (saved) {
			try {
				const data = JSON.parse(saved);
				console.log('Restoring auto-saved map...');
				await this.loadMapData(data);
				
				const savedSelection = localStorage.getItem(LS_SELECTION_KEY);
				if (savedSelection) {
					try {
						const ids = JSON.parse(savedSelection);
						if (Array.isArray(ids) && ids.length > 0) {
							this.selectObjectsByIds(ids);
						}
					} catch (e) {
						console.error('Failed to load selection state', e);
					}
				}
				
			} catch (e) {
				console.error('Failed to load auto-save', e);
			}
		} else {
			// If no auto-save, load default empty map (which adds default light)
			this.loadMapData({ assets: [], groups: [] });
		}
	}
}
