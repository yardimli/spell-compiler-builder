import * as BABYLON from '@babylonjs/core';

export class PropertyPanel {
	constructor (objectManager) {
		this.objectManager = objectManager;
		this.panel = document.getElementById('properties-panel');
		this.inputs = {
			name: document.getElementById('propName'),
			pos: {
				x: document.getElementById('posX'),
				y: document.getElementById('posY'),
				z: document.getElementById('posZ')
			},
			rot: {
				x: document.getElementById('rotX'),
				y: document.getElementById('rotY'),
				z: document.getElementById('rotZ')
			},
			scale: {
				x: document.getElementById('scaleX'),
				y: document.getElementById('scaleY'),
				z: document.getElementById('scaleZ')
			}
		};
		
		this.currentObjectId = null;
		this.isUpdatingUI = false;
		
		this.setupListeners();
		
		// Subscribe to object manager events
		this.objectManager.onSelectionChange = (data) => this.updateUI(data);
	}
	
	setupListeners () {
		// Name
		this.inputs.name.onchange = (e) => {
			if (this.currentObjectId) {
				this.objectManager.updateObjectProperty(this.currentObjectId, 'name', e.target.value);
			}
		};
		
		// Position
		['x', 'y', 'z'].forEach(axis => {
			this.inputs.pos[axis].onchange = () => this.emitTransformChange('position');
			this.inputs.rot[axis].onchange = () => this.emitTransformChange('rotation');
			this.inputs.scale[axis].onchange = () => this.emitTransformChange('scaling');
		});
		
		// Delete
		document.getElementById('btnDeleteObj').onclick = () => {
			this.objectManager.deleteSelected();
		};
	}
	
	emitTransformChange (type) {
		if (this.isUpdatingUI || !this.currentObjectId) return;
		
		const values = {
			x: parseFloat(this.inputs[type === 'position' ? 'pos' : (type === 'rotation' ? 'rot' : 'scale')].x.value) || 0,
			y: parseFloat(this.inputs[type === 'position' ? 'pos' : (type === 'rotation' ? 'rot' : 'scale')].y.value) || 0,
			z: parseFloat(this.inputs[type === 'position' ? 'pos' : (type === 'rotation' ? 'rot' : 'scale')].z.value) || 0
		};
		
		// For Scale, ensure no zeros if desired, but 0 is valid in 3D (invisible)
		if (type === 'scaling') {
			if (values.x === 0) values.x = 0.001;
			if (values.y === 0) values.y = 0.001;
			if (values.z === 0) values.z = 0.001;
		}
		
		this.objectManager.updateObjectProperty(this.currentObjectId, type, values);
	}
	
	updateUI (data) {
		this.isUpdatingUI = true;
		
		if (!data) {
			this.panel.style.display = 'none';
			this.currentObjectId = null;
		} else {
			this.panel.style.display = 'flex';
			this.currentObjectId = data.id;
			
			this.inputs.name.value = data.name;
			
			// Position
			this.inputs.pos.x.value = parseFloat(data.position[0]).toFixed(2);
			this.inputs.pos.y.value = parseFloat(data.position[1]).toFixed(2);
			this.inputs.pos.z.value = parseFloat(data.position[2]).toFixed(2);
			
			// Rotation (Radians to Degrees)
			this.inputs.rot.x.value = BABYLON.Tools.ToDegrees(data.rotation[0]).toFixed(1);
			this.inputs.rot.y.value = BABYLON.Tools.ToDegrees(data.rotation[1]).toFixed(1);
			this.inputs.rot.z.value = BABYLON.Tools.ToDegrees(data.rotation[2]).toFixed(1);
			
			// Scale
			this.inputs.scale.x.value = parseFloat(data.scaling[0]).toFixed(2);
			this.inputs.scale.y.value = parseFloat(data.scaling[1]).toFixed(2);
			this.inputs.scale.z.value = parseFloat(data.scaling[2]).toFixed(2);
		}
		
		this.isUpdatingUI = false;
	}
}
