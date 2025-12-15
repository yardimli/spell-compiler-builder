import * as BABYLON from '@babylonjs/core';

export class PropertyPanel {
	constructor (objectManager) {
		this.objectManager = objectManager;
		this.panel = document.getElementById('properties-panel');
		
		// Containers
		this.singleView = document.getElementById('single-obj-props');
		this.multiView = document.getElementById('multi-obj-props');
		this.multiList = document.getElementById('multi-select-container');
		
		// Gizmo Buttons (Now in Top Bar)
		this.gizmoBtns = {
			pos: document.getElementById('btnGizmoPos'),
			rot: document.getElementById('btnGizmoRot'),
			scale: document.getElementById('btnGizmoScale')
		};
		
		// Action Buttons (Now in Top Bar)
		this.btnDuplicate = document.getElementById('btnDuplicate');
		this.btnDelete = document.getElementById('btnDeleteObj');
		
		// Cache inputs with safety check
		const getEl = (id) => {
			const el = document.getElementById(id);
			if (!el) console.warn(`PropertyPanel: Element #${id} not found.`);
			return el;
		};
		
		this.inputs = {
			name: getEl('propName'),
			lock: getEl('chkLock'),
			tint: getEl('propTint'), // New Tint Input
			pos: {
				x: getEl('posX'),
				y: getEl('posY'),
				z: getEl('posZ')
			},
			rot: {
				x: getEl('rotX'),
				y: getEl('rotY'),
				z: getEl('rotZ')
			},
			scale: {
				x: getEl('scaleX'),
				y: getEl('scaleY'),
				z: getEl('scaleZ')
			}
		};
		
		// Alignment Buttons (Expanded)
		this.alignButtons = {
			xMin: getEl('btnAlignXMin'),
			xCenter: getEl('btnAlignXCenter'),
			xMax: getEl('btnAlignXMax'),
			yMin: getEl('btnAlignYMin'),
			yCenter: getEl('btnAlignYCenter'),
			yMax: getEl('btnAlignYMax'),
			zMin: getEl('btnAlignZMin'),
			zCenter: getEl('btnAlignZCenter'),
			zMax: getEl('btnAlignZMax')
		};
		
		// Spacing Buttons (New)
		this.snapButtons = {
			x: getEl('btnSnapX'),
			y: getEl('btnSnapY'),
			z: getEl('btnSnapZ')
		};
		
		// Group Button
		this.btnCreateGroup = getEl('btnCreateGroup');
		
		this.currentObjectId = null;
		this.isUpdatingUI = false;
		
		this.setupListeners();
		this.setupGizmoControls();
		
		// Subscribe to object manager events
		if (this.objectManager) {
			this.objectManager.onSelectionChange = (data) => this.updateUI(data);
		}
	}
	
	setupGizmoControls () {
		const setMode = (mode, btn) => {
			this.objectManager.setGizmoMode(mode);
			// Update UI
			Object.values(this.gizmoBtns).forEach(b => b.classList.remove('active'));
			btn.classList.add('active');
		};
		
		if (this.gizmoBtns.pos) this.gizmoBtns.pos.onclick = () => setMode('position', this.gizmoBtns.pos);
		if (this.gizmoBtns.rot) this.gizmoBtns.rot.onclick = () => setMode('rotation', this.gizmoBtns.rot);
		if (this.gizmoBtns.scale) this.gizmoBtns.scale.onclick = () => setMode('scaling', this.gizmoBtns.scale);
		
		// Keyboard Shortcuts
		window.addEventListener('keydown', (e) => {
			if (e.target.tagName === 'INPUT') return; // Ignore if typing
			
			switch (e.key.toLowerCase()) {
				case 'g': setMode('position', this.gizmoBtns.pos); break;
				case 'r': setMode('rotation', this.gizmoBtns.rot); break;
				case 's': setMode('scaling', this.gizmoBtns.scale); break;
			}
		});
	}
	
	setupListeners () {
		if (!this.inputs.name) return; // Abort if UI not ready
		
		// Name
		this.inputs.name.onchange = (e) => {
			if (this.currentObjectId) {
				this.objectManager.updateObjectProperty(this.currentObjectId, 'name', e.target.value);
			}
		};
		
		// Lock Toggle
		if (this.inputs.lock) {
			this.inputs.lock.onchange = (e) => {
				const isLocked = e.target.checked;
				if (this.currentObjectId) {
					// Single
					this.objectManager.updateObjectProperty(this.currentObjectId, 'isLocked', isLocked);
				} else {
					// Multi
					this.objectManager.updateMultipleObjectsProperty('isLocked', isLocked);
				}
			};
		}
		
		// Tint Color
		if (this.inputs.tint) {
			this.inputs.tint.onchange = (e) => {
				if (this.currentObjectId) {
					this.objectManager.updateObjectProperty(this.currentObjectId, 'color', e.target.value);
				} else {
					// Multi-object color update
					this.objectManager.updateMultipleObjectsProperty('color', e.target.value);
				}
			};
		}
		
		// Position
		['x', 'y', 'z'].forEach(axis => {
			if (this.inputs.pos[axis]) this.inputs.pos[axis].onchange = () => this.emitTransformChange('position');
			if (this.inputs.rot[axis]) this.inputs.rot[axis].onchange = () => this.emitTransformChange('rotation');
			if (this.inputs.scale[axis]) this.inputs.scale[axis].onchange = () => this.emitTransformChange('scaling');
		});
		
		// Alignment
		if (this.alignButtons.xMin) this.alignButtons.xMin.onclick = () => this.objectManager.alignSelection('x', 'min');
		if (this.alignButtons.xCenter) this.alignButtons.xCenter.onclick = () => this.objectManager.alignSelection('x', 'center');
		if (this.alignButtons.xMax) this.alignButtons.xMax.onclick = () => this.objectManager.alignSelection('x', 'max');
		
		if (this.alignButtons.yMin) this.alignButtons.yMin.onclick = () => this.objectManager.alignSelection('y', 'min');
		if (this.alignButtons.yCenter) this.alignButtons.yCenter.onclick = () => this.objectManager.alignSelection('y', 'center');
		if (this.alignButtons.yMax) this.alignButtons.yMax.onclick = () => this.objectManager.alignSelection('y', 'max');
		
		if (this.alignButtons.zMin) this.alignButtons.zMin.onclick = () => this.objectManager.alignSelection('z', 'min');
		if (this.alignButtons.zCenter) this.alignButtons.zCenter.onclick = () => this.objectManager.alignSelection('z', 'center');
		if (this.alignButtons.zMax) this.alignButtons.zMax.onclick = () => this.objectManager.alignSelection('z', 'max');
		
		// Spacing
		if (this.snapButtons.x) this.snapButtons.x.onclick = () => this.objectManager.snapSelection('x');
		if (this.snapButtons.y) this.snapButtons.y.onclick = () => this.objectManager.snapSelection('y');
		if (this.snapButtons.z) this.snapButtons.z.onclick = () => this.objectManager.snapSelection('z');
		
		// Grouping
		if (this.btnCreateGroup) {
			this.btnCreateGroup.onclick = () => {
				const selectedIds = this.objectManager.selectedMeshes.map(m => m.metadata.id);
				this.objectManager.createGroup(null, selectedIds);
			};
		}
		
		// Delete
		if (this.btnDelete) {
			this.btnDelete.onclick = () => {
				this.objectManager.deleteSelected();
			};
		}
		
		// Duplicate
		if (this.btnDuplicate) {
			this.btnDuplicate.onclick = () => {
				this.objectManager.duplicateSelection();
			};
		}
	}
	
	emitTransformChange (type) {
		if (this.isUpdatingUI) return;
		
		const values = {
			x: parseFloat(this.inputs[type === 'position' ? 'pos' : (type === 'rotation' ? 'rot' : 'scale')].x.value) || 0,
			y: parseFloat(this.inputs[type === 'position' ? 'pos' : (type === 'rotation' ? 'rot' : 'scale')].y.value) || 0,
			z: parseFloat(this.inputs[type === 'position' ? 'pos' : (type === 'rotation' ? 'rot' : 'scale')].z.value) || 0
		};
		
		// For Scale, ensure no zeros
		if (type === 'scaling') {
			if (values.x === 0) values.x = 0.001;
			if (values.y === 0) values.y = 0.001;
			if (values.z === 0) values.z = 0.001;
		}
		
		if (this.currentObjectId) {
			// Single Object
			this.objectManager.updateObjectProperty(this.currentObjectId, type, values);
		} else {
			// Multi Object - Move the group (Proxy)
			this.objectManager.updateGroupTransform(type, values);
		}
	}
	
	updateUI (dataArray) {
		if (!this.panel) return;
		
		this.isUpdatingUI = true;
		
		const hasSelection = dataArray && dataArray.length > 0;
		
		// Update Top Bar Action Buttons
		if (this.btnDuplicate) this.btnDuplicate.disabled = !hasSelection;
		if (this.btnDelete) this.btnDelete.disabled = !hasSelection;
		
		// Update Gizmo Buttons (Optional: Disable if no selection, or keep active to indicate mode)
		// Usually gizmo buttons stay enabled to switch modes, but the gizmo itself hides.
		// We'll keep them enabled to allow mode switching even without selection.
		
		if (!hasSelection) {
			this.panel.style.display = 'none';
			this.currentObjectId = null;
		} else if (dataArray.length === 1) {
			// SINGLE SELECTION
			this.panel.style.display = 'flex';
			this.singleView.style.display = 'block';
			this.multiView.style.display = 'none';
			
			const data = dataArray[0];
			this.currentObjectId = data.id;
			
			if (this.inputs.name) this.inputs.name.value = data.name || '';
			
			// Lock State
			if (this.inputs.lock) {
				this.inputs.lock.checked = !!data.isLocked;
				this.inputs.lock.indeterminate = false;
			}
			
			// Tint Color
			if (this.inputs.tint) {
				this.inputs.tint.value = data.color || '#ffffff';
			}
			
			// Position
			if (this.inputs.pos.x) this.inputs.pos.x.value = parseFloat(data.position[0]).toFixed(2);
			if (this.inputs.pos.y) this.inputs.pos.y.value = parseFloat(data.position[1]).toFixed(2);
			if (this.inputs.pos.z) this.inputs.pos.z.value = parseFloat(data.position[2]).toFixed(2);
			
			// Rotation (Radians to Degrees)
			if (this.inputs.rot.x) this.inputs.rot.x.value = BABYLON.Tools.ToDegrees(data.rotation[0]).toFixed(1);
			if (this.inputs.rot.y) this.inputs.rot.y.value = BABYLON.Tools.ToDegrees(data.rotation[1]).toFixed(1);
			if (this.inputs.rot.z) this.inputs.rot.z.value = BABYLON.Tools.ToDegrees(data.rotation[2]).toFixed(1);
			
			// Scale
			if (this.inputs.scale.x) this.inputs.scale.x.value = parseFloat(data.scaling[0]).toFixed(2);
			if (this.inputs.scale.y) this.inputs.scale.y.value = parseFloat(data.scaling[1]).toFixed(2);
			if (this.inputs.scale.z) this.inputs.scale.z.value = parseFloat(data.scaling[2]).toFixed(2);
		} else {
			// MULTI SELECTION
			this.panel.style.display = 'flex';
			this.singleView.style.display = 'none';
			this.multiView.style.display = 'block';
			
			this.currentObjectId = null;
			
			// Determine Lock State (Mixed?)
			if (this.inputs.lock) {
				const allLocked = dataArray.every(d => d.isLocked);
				const allUnlocked = dataArray.every(d => !d.isLocked);
				
				if (allLocked) {
					this.inputs.lock.checked = true;
					this.inputs.lock.indeterminate = false;
				} else if (allUnlocked) {
					this.inputs.lock.checked = false;
					this.inputs.lock.indeterminate = false;
				} else {
					this.inputs.lock.indeterminate = true;
				}
			}
			
			// Determine Color (Use first, or white if mixed? Just use first for now)
			if (this.inputs.tint) {
				this.inputs.tint.value = dataArray[0].color || '#ffffff';
			}
			
			// Determine Transforms (Use Proxy Transform)
			if (this.objectManager.selectionProxy) {
				const proxy = this.objectManager.selectionProxy;
				
				// Position
				if (this.inputs.pos.x) this.inputs.pos.x.value = proxy.position.x.toFixed(2);
				if (this.inputs.pos.y) this.inputs.pos.y.value = proxy.position.y.toFixed(2);
				if (this.inputs.pos.z) this.inputs.pos.z.value = proxy.position.z.toFixed(2);
				
				// Rotation (Proxy uses Quaternion, convert to Euler)
				const euler = proxy.rotationQuaternion ? proxy.rotationQuaternion.toEulerAngles() : proxy.rotation;
				if (this.inputs.rot.x) this.inputs.rot.x.value = BABYLON.Tools.ToDegrees(euler.x).toFixed(1);
				if (this.inputs.rot.y) this.inputs.rot.y.value = BABYLON.Tools.ToDegrees(euler.y).toFixed(1);
				if (this.inputs.rot.z) this.inputs.rot.z.value = BABYLON.Tools.ToDegrees(euler.z).toFixed(1);
				
				// Scale
				if (this.inputs.scale.x) this.inputs.scale.x.value = proxy.scaling.x.toFixed(2);
				if (this.inputs.scale.y) this.inputs.scale.y.value = proxy.scaling.y.toFixed(2);
				if (this.inputs.scale.z) this.inputs.scale.z.value = proxy.scaling.z.toFixed(2);
			}
			
			// Populate List
			this.multiList.innerHTML = '';
			dataArray.forEach(obj => {
				const div = document.createElement('div');
				div.className = 'multi-select-item';
				div.innerText = obj.name + (obj.isLocked ? ' (Locked)' : '');
				this.multiList.appendChild(div);
			});
		}
		
		this.isUpdatingUI = false;
	}
}
