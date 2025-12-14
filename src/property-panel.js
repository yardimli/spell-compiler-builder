import * as BABYLON from '@babylonjs/core';

export class PropertyPanel {
	constructor (objectManager) {
		this.objectManager = objectManager;
		this.panel = document.getElementById('properties-panel');
		
		// Containers
		this.singleView = document.getElementById('single-obj-props');
		this.multiView = document.getElementById('multi-obj-props');
		this.multiList = document.getElementById('multi-select-container');
		
		// Cache inputs with safety check
		const getEl = (id) => {
			const el = document.getElementById(id);
			if (!el) console.warn(`PropertyPanel: Element #${id} not found.`);
			return el;
		};
		
		this.inputs = {
			name: getEl('propName'),
			lock: getEl('chkLock'), // New Lock Checkbox
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
		
		// Alignment Buttons
		this.alignButtons = {
			x: getEl('btnAlignX'),
			y: getEl('btnAlignY'),
			z: getEl('btnAlignZ')
		};
		
		this.currentObjectId = null;
		this.isUpdatingUI = false;
		
		this.setupListeners();
		
		// Subscribe to object manager events
		if (this.objectManager) {
			this.objectManager.onSelectionChange = (data) => this.updateUI(data);
		}
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
		
		// Position
		['x', 'y', 'z'].forEach(axis => {
			if (this.inputs.pos[axis]) this.inputs.pos[axis].onchange = () => this.emitTransformChange('position');
			if (this.inputs.rot[axis]) this.inputs.rot[axis].onchange = () => this.emitTransformChange('rotation');
			if (this.inputs.scale[axis]) this.inputs.scale[axis].onchange = () => this.emitTransformChange('scaling');
		});
		
		// Alignment
		if (this.alignButtons.x) this.alignButtons.x.onclick = () => this.objectManager.alignSelection('x');
		if (this.alignButtons.y) this.alignButtons.y.onclick = () => this.objectManager.alignSelection('y');
		if (this.alignButtons.z) this.alignButtons.z.onclick = () => this.objectManager.alignSelection('z');
		
		// Delete
		const btnDelete = document.getElementById('btnDeleteObj');
		if (btnDelete) {
			btnDelete.onclick = () => {
				this.objectManager.deleteSelected();
			};
		}
		
		// Duplicate
		const btnDuplicate = document.getElementById('btnDuplicate');
		if (btnDuplicate) {
			btnDuplicate.onclick = () => {
				this.objectManager.duplicateSelection();
			};
		}
	}
	
	emitTransformChange (type) {
		if (this.isUpdatingUI || !this.currentObjectId) return;
		
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
		
		this.objectManager.updateObjectProperty(this.currentObjectId, type, values);
	}
	
	updateUI (dataArray) {
		if (!this.panel) return;
		
		this.isUpdatingUI = true;
		const btnDuplicate = document.getElementById('btnDuplicate');
		
		if (!dataArray || dataArray.length === 0) {
			this.panel.style.display = 'none';
			this.currentObjectId = null;
		} else if (dataArray.length === 1) {
			// SINGLE SELECTION
			this.panel.style.display = 'flex';
			this.singleView.style.display = 'block';
			this.multiView.style.display = 'none';
			
			if (btnDuplicate) btnDuplicate.innerText = "Duplicate Object";
			
			const data = dataArray[0];
			this.currentObjectId = data.id;
			
			if (this.inputs.name) this.inputs.name.value = data.name || '';
			
			// Lock State
			if (this.inputs.lock) {
				this.inputs.lock.checked = !!data.isLocked;
				this.inputs.lock.indeterminate = false;
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
			
			if (btnDuplicate) btnDuplicate.innerText = `Duplicate Selected (${dataArray.length})`;
			
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
