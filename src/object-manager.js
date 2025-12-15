import * as BABYLON from '@babylonjs/core';
import { UndoRedoManager } from './undo-redo';
import { GizmoController } from './managers/gizmo-controller';
import { GroupManager } from './managers/group-manager';
import { AlignmentManager } from './managers/alignment-manager';
import { PropertyManager } from './managers/property-manager';
import { OperationManager } from './managers/operation-manager';

// Updated root path for assets
const ASSET_ROOT = './assets/objects/';
const LS_AUTOSAVE_KEY = 'builder_autosave_map';
const LS_SELECTION_KEY = 'builder_selection_state';

export class ObjectManager {
	constructor (scene, shadowGenerator) {
		this.scene = scene;
		this.shadowGenerator = shadowGenerator;
		
		// State
		this.placedObjects = []; // Array of metadata objects
		this.groups = []; // Array of { id, name, objectIds: [] }
		this.selectedMeshes = []; // Array of currently selected Babylon Meshes
		this.selectionProxy = null; // TransformNode for multi-selection group transforms
		
		// Settings
		this._gridSize = 2.5;
		this.defaultYOffset = 0;
		this.autoSaveEnabled = true;
		
		// Events
		this.onSelectionChange = null; // Callback for UI
		this.onListChange = null; // Callback for TreeView
		
		// Initialize Undo/Redo Manager
		this.undoRedo = new UndoRedoManager(this);
		
		// Initialize Sub-Managers
		this.gizmoController = new GizmoController(this);
		this.groupManager = new GroupManager(this);
		this.alignmentManager = new AlignmentManager(this);
		this.propertyManager = new PropertyManager(this);
		this.operationManager = new OperationManager(this);
	}
	
	get gridSize () { return this._gridSize; }
	set gridSize (val) {
		this._gridSize = val;
		this.gizmoController.updateGizmoSettings();
	}
	
	// --- Gizmo Delegation ---
	get gizmoManager () { return this.gizmoController.gizmoManager; } // Backwards compatibility for Scene
	setGizmoMode (mode) { this.gizmoController.setMode(mode); }
	updateGizmoSettings () { this.gizmoController.updateGizmoSettings(); }
	
	// --- Group Delegation ---
	createGroup (name, objectIds) { this.groupManager.createGroup(name, objectIds); }
	deleteGroup (groupId) { this.groupManager.deleteGroup(groupId); }
	renameGroup (groupId, newName) { this.groupManager.renameGroup(groupId, newName); }
	getGroupOfObject (objectId) { return this.groupManager.getGroupOfObject(objectId); }
	
	// --- Alignment Delegation ---
	alignSelection (axis, mode) { this.alignmentManager.alignSelection(axis, mode); }
	snapSelection (axis) { this.alignmentManager.snapSelection(axis); }
	
	// --- Property Delegation ---
	updateObjectProperty (id, prop, value) { this.propertyManager.updateObjectProperty(id, prop, value); }
	updateMultipleObjectsProperty (prop, value) { this.propertyManager.updateMultipleObjectsProperty(prop, value); }
	updateGroupTransform (prop, values) { this.propertyManager.updateGroupTransform(prop, values); }
	updateObjectTransform (id, data) { this.propertyManager.updateObjectTransform(id, data); }
	
	// --- Operation Delegation ---
	deleteSelected () { this.operationManager.deleteSelected(); }
	duplicateSelection () { this.operationManager.duplicateSelection(); }
	
	// --- Asset Spawning (Core Responsibility) ---
	
	// filename now includes folder path e.g. "nature/rock.glb"
	async addAsset (filename, position) {
		try {
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
			// Extract base name from full path "nature/rock.glb" -> "rock"
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
			
			// Use ASSET_ROOT + filename (which includes subfolder)
			const result = await BABYLON.SceneLoader.ImportMeshAsync('', ASSET_ROOT, filename, this.scene);
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
				file: filename, // Stores "folder/file.glb"
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
			if (this.onListChange) this.onListChange();
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
		if (this.onListChange) this.onListChange();
	}
	
	// --- Core Lifecycle & Selection ---
	
	removeObjectById (id, clearSelection = true) {
		const mesh = this.findMeshById(id);
		if (mesh) {
			if (clearSelection) {
				this.selectedMeshes = this.selectedMeshes.filter(m => m !== mesh);
				this.updateSelectionProxy();
			}
			mesh.dispose();
		}
		
		// FIXED: Added null check 'o &&' to prevent crashes if placedObjects has holes
		this.placedObjects = this.placedObjects.filter(o => o && o.id !== id);
	}
	
	// Modified to return a Promise so we can await completion during load
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
			if (this.onListChange) this.onListChange();
			return Promise.resolve();
		} else {
			// Return the promise from ImportMeshAsync
			return BABYLON.SceneLoader.ImportMeshAsync('', ASSET_ROOT, data.file, this.scene).then(res => {
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
	
	// --- Persistence ---
	
	getMapData (mapName) {
		return {
			name: mapName,
			version: 2,
			assets: this.placedObjects,
			groups: this.groups
		};
	}
	
	// Modified to be async to support waiting for assets to load before selecting
	async loadMapData (data) {
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
		
		// Initial clear update
		if (this.onListChange) this.onListChange();
		
		if (data.assets) {
			// Wait for all assets to be restored
			const promises = data.assets.map(item => this.restoreObject(item));
			await Promise.all(promises);
		}
	}
	
	clearScene () {
		this.loadMapData({ assets: [], groups: [] });
	}
	
	saveToAutoSave () {
		if (!this.autoSaveEnabled) return false;
		const data = this.getMapData('autosave');
		localStorage.setItem(LS_AUTOSAVE_KEY, JSON.stringify(data));
		
		// Save Selection State
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
				
				// Restore Selection State after map is fully loaded
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
		}
	}
}
