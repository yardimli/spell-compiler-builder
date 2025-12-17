import * as BABYLON from '@babylonjs/core';

export class PropertyPanel {
	constructor (objectManager) {
		this.objectManager = objectManager;
		this.panel = document.getElementById('properties-panel');
		
		// Containers
		this.singleView = document.getElementById('single-obj-props');
		this.multiView = document.getElementById('multi-obj-props');
		this.multiList = document.getElementById('multi-select-container');
		
		// Light Containers
		this.lightProps = document.getElementById('light-props');
		this.lightDirProps = document.getElementById('light-direction-props');
		this.rowGroundColor = document.getElementById('rowGroundColor');
		
		// Gizmo Buttons
		this.gizmoBtns = {
			pos: document.getElementById('btnGizmoPos'),
			rot: document.getElementById('btnGizmoRot'),
			scale: document.getElementById('btnGizmoScale')
		};
		
		// Action Buttons
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
			tint: getEl('propTint'), // Single Tint
			tintMulti: getEl('propTintMulti'), // Multi Tint
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
			},
			// Light Inputs
			intensity: getEl('propIntensity'),
			castShadows: getEl('propCastShadows'),
			lightDiffuse: getEl('propLightDiffuse'),
			lightSpecular: getEl('propLightSpecular'),
			lightGround: getEl('propLightGround'),
			direction: {
				x: getEl('lightDirX'),
				y: getEl('lightDirY'),
				z: getEl('lightDirZ')
			}
		};
		
		// Snap Margin Input
		this.inputSnapMargin = getEl('inputSnapMargin');
		
		// Reset Tint Buttons
		this.btnResetTint = getEl('btnResetTint');
		this.btnResetTintMulti = getEl('btnResetTintMulti');
		
		// Alignment Buttons
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
		
		// Spacing Buttons
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
	
	updateInputSteps () {
		if (!this.objectManager) return;
		
		['x', 'y', 'z'].forEach(axis => {
			if (this.inputs.pos[axis]) this.inputs.pos[axis].step = this.objectManager.posStep;
			if (this.inputs.rot[axis]) this.inputs.rot[axis].step = this.objectManager.rotStep;
			if (this.inputs.scale[axis]) this.inputs.scale[axis].step = this.objectManager.scaleStep;
		});
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
				case 'g':
					setMode('position', this.gizmoBtns.pos);
					break;
				case 'r':
					setMode('rotation', this.gizmoBtns.rot);
					break;
				case 's':
					setMode('scaling', this.gizmoBtns.scale);
					break;
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
		
		// Tint Color (Single)
		if (this.inputs.tint) {
			this.inputs.tint.onchange = (e) => {
				if (this.currentObjectId) {
					this.objectManager.updateObjectProperty(this.currentObjectId, 'color', e.target.value);
				}
			};
		}
		
		// Tint Color (Multi)
		if (this.inputs.tintMulti) {
			this.inputs.tintMulti.onchange = (e) => {
				this.objectManager.updateMultipleObjectsProperty('color', e.target.value);
			};
		}
		
		// Reset Tint (Single)
		if (this.btnResetTint) {
			this.btnResetTint.onclick = () => {
				if (this.currentObjectId) {
					this.objectManager.updateObjectProperty(this.currentObjectId, 'color', null);
					if (this.inputs.tint) this.inputs.tint.value = '#ffffff';
				}
			};
		}
		
		// Reset Tint (Multi)
		if (this.btnResetTintMulti) {
			this.btnResetTintMulti.onclick = () => {
				this.objectManager.updateMultipleObjectsProperty('color', null);
				if (this.inputs.tintMulti) this.inputs.tintMulti.value = '#ffffff';
			};
		}
		
		// Position
		['x', 'y', 'z'].forEach(axis => {
			if (this.inputs.pos[axis]) this.inputs.pos[axis].onchange = () => this.emitTransformChange('position');
			if (this.inputs.rot[axis]) this.inputs.rot[axis].onchange = () => this.emitTransformChange('rotation');
			if (this.inputs.scale[axis]) this.inputs.scale[axis].onchange = () => this.emitTransformChange('scaling');
		});
		
		// Light Properties
		if (this.inputs.intensity) {
			this.inputs.intensity.onchange = (e) => {
				if (this.currentObjectId) {
					this.objectManager.updateObjectProperty(this.currentObjectId, 'intensity', parseFloat(e.target.value));
				}
			};
		}
		
		if (this.inputs.castShadows) {
			this.inputs.castShadows.onchange = (e) => {
				if (this.currentObjectId) {
					this.objectManager.updateObjectProperty(this.currentObjectId, 'castShadows', e.target.checked);
				}
			};
		}
		
		// Light Colors
		if (this.inputs.lightDiffuse) {
			this.inputs.lightDiffuse.onchange = (e) => {
				if (this.currentObjectId) this.objectManager.updateObjectProperty(this.currentObjectId, 'color', e.target.value);
			};
		}
		if (this.inputs.lightSpecular) {
			this.inputs.lightSpecular.onchange = (e) => {
				if (this.currentObjectId) this.objectManager.updateObjectProperty(this.currentObjectId, 'specularColor', e.target.value);
			};
		}
		if (this.inputs.lightGround) {
			this.inputs.lightGround.onchange = (e) => {
				if (this.currentObjectId) this.objectManager.updateObjectProperty(this.currentObjectId, 'groundColor', e.target.value);
			};
		}
		
		['x', 'y', 'z'].forEach(axis => {
			if (this.inputs.direction[axis]) {
				this.inputs.direction[axis].onchange = () => {
					if (this.currentObjectId) {
						const val = {
							x: parseFloat(this.inputs.direction.x.value) || 0,
							y: parseFloat(this.inputs.direction.y.value) || 0,
							z: parseFloat(this.inputs.direction.z.value) || 0
						};
						this.objectManager.updateObjectProperty(this.currentObjectId, 'direction', val);
					}
				};
			}
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
		
		// Spacing, Pass margin value
		if (this.snapButtons.x) this.snapButtons.x.onclick = () => this.objectManager.snapSelection('x', parseFloat(this.inputSnapMargin.value) || 0);
		if (this.snapButtons.y) this.snapButtons.y.onclick = () => this.objectManager.snapSelection('y', parseFloat(this.inputSnapMargin.value) || 0);
		if (this.snapButtons.z) this.snapButtons.z.onclick = () => this.objectManager.snapSelection('z', parseFloat(this.inputSnapMargin.value) || 0);
		
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
		
		if (!hasSelection) {
			this.panel.style.visibility = 'hidden';
			this.currentObjectId = null;
		} else if (dataArray.length === 1) {
			// SINGLE SELECTION
			this.panel.style.visibility = 'visible';
			this.panel.style.display = 'flex'; // Ensure flex layout is active
			
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
			
			// Tint Color (Single)
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
			
			// Light Properties
			if (data.type === 'light') {
				this.lightProps.style.display = 'block';
				if (this.inputs.intensity) this.inputs.intensity.value = data.intensity !== undefined ? data.intensity : 1.0;
				
				// Update Cast Shadows Visibility
				if (this.inputs.castShadows) {
					this.inputs.castShadows.checked = !!data.castShadows;
					
					// Hide shadow option for Hemispheric lights
					const shadowGroup = this.inputs.castShadows.closest('.prop-group');
					if (shadowGroup) {
						shadowGroup.style.display = (data.kind === 'hemispheric') ? 'none' : 'block';
					}
				}
				
				// Update Color Inputs
				if (this.inputs.lightDiffuse) this.inputs.lightDiffuse.value = data.color || '#ffffff';
				if (this.inputs.lightSpecular) this.inputs.lightSpecular.value = data.specularColor || '#000000';
				
				if (data.kind === 'directional' || data.kind === 'hemispheric') {
					this.lightDirProps.style.display = 'block';
					if (data.direction) {
						if (this.inputs.direction.x) this.inputs.direction.x.value = parseFloat(data.direction[0]).toFixed(2);
						if (this.inputs.direction.y) this.inputs.direction.y.value = parseFloat(data.direction[1]).toFixed(2);
						if (this.inputs.direction.z) this.inputs.direction.z.value = parseFloat(data.direction[2]).toFixed(2);
					}
				} else {
					this.lightDirProps.style.display = 'none';
				}
				
				// Ground Color (Hemispheric Only)
				if (data.kind === 'hemispheric') {
					this.rowGroundColor.style.display = 'flex';
					if (this.inputs.lightGround) this.inputs.lightGround.value = data.groundColor || '#000000';
				} else {
					this.rowGroundColor.style.display = 'none';
				}
				
			} else {
				this.lightProps.style.display = 'none';
			}
			
		} else {
			// MULTI SELECTION
			this.panel.style.visibility = 'visible';
			this.panel.style.display = 'flex';
			
			this.singleView.style.display = 'none';
			this.multiView.style.display = 'block';
			this.lightProps.style.display = 'none'; // Hide light props in multi-select
			
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
			
			// Determine Color (Use first, or white if mixed)
			if (this.inputs.tintMulti) {
				this.inputs.tintMulti.value = dataArray[0].color || '#ffffff';
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
