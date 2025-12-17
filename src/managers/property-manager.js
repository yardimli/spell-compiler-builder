import * as BABYLON from '@babylonjs/core';

export class PropertyManager {
	constructor (objectManager) {
		this.om = objectManager;
	}
	
	updateObjectProperty (id, prop, value) {
		const mesh = this.om.findMeshById(id);
		if (!mesh) return;
		
		const objData = this.om.placedObjects.find(o => o.id === id);
		
		if (prop === 'isLocked') {
			objData.isLocked = value;
			this.om.updateSelectionProxy();
			if (this.om.onListChange) this.om.onListChange(); // Lock icon update
			return;
		}
		
		if (prop === 'color') {
			objData.color = value;
			this.om.applyColorToMesh(mesh, value);
			return;
		}
		
		const oldData = {
			position: mesh.absolutePosition.asArray(),
			rotation: mesh.absoluteRotationQuaternion.toEulerAngles().asArray(),
			scaling: mesh.absoluteScaling.asArray()
		};
		
		if (prop === 'name') {
			mesh.name = value;
			objData.name = value;
			if (this.om.onListChange) this.om.onListChange();
			return;
		}
		
		if (prop === 'position') {
			mesh.setAbsolutePosition(new BABYLON.Vector3(value.x, value.y, value.z));
			objData.position = [value.x, value.y, value.z];
		} else if (prop === 'rotation') {
			const rads = new BABYLON.Vector3(
				BABYLON.Tools.ToRadians(value.x),
				BABYLON.Tools.ToRadians(value.y),
				BABYLON.Tools.ToRadians(value.z)
			);
			mesh.rotationQuaternion = BABYLON.Quaternion.FromEulerVector(rads);
			objData.rotation = rads.asArray();
		} else if (prop === 'scaling') {
			mesh.scaling = new BABYLON.Vector3(value.x, value.y, value.z);
			objData.scaling = [value.x, value.y, value.z];
		}
		
		const newData = {
			position: mesh.absolutePosition.asArray(),
			rotation: mesh.absoluteRotationQuaternion.toEulerAngles().asArray(),
			scaling: mesh.absoluteScaling.asArray()
		};
		
		this.om.undoRedo.add({
			type: 'TRANSFORM',
			data: [{
				id: id,
				oldData: oldData,
				newData: newData
			}]
		});
	}
	
	updateVisibility (id, isVisible) {
		const mesh = this.om.findMeshById(id);
		const objData = this.om.placedObjects.find(o => o.id === id);
		
		if (objData) {
			const oldValue = objData.isVisible !== undefined ? objData.isVisible : true;
			
			// Apply
			objData.isVisible = isVisible;
			if (mesh) mesh.setEnabled(isVisible);
			
			// Add to Undo
			this.om.undoRedo.add({
				type: 'PROPERTY',
				data: [{
					id: id,
					prop: 'isVisible',
					oldValue: oldValue,
					newValue: isVisible
				}]
			});
			
			if (this.om.onListChange) this.om.onListChange();
		}
	}
	
	updateMultipleObjectsProperty (prop, value) {
		if (prop === 'isLocked') {
			this.om.selectedMeshes.forEach(mesh => {
				const objData = this.om.placedObjects.find(o => o.id === mesh.metadata.id);
				if (objData) objData.isLocked = value;
			});
			this.om.updateSelectionProxy();
			if (this.om.onListChange) this.om.onListChange();
		} else if (prop === 'color') {
			this.om.selectedMeshes.forEach(mesh => {
				const objData = this.om.placedObjects.find(o => o.id === mesh.metadata.id);
				if (objData) {
					objData.color = value;
					this.om.applyColorToMesh(mesh, value);
				}
			});
		}
	}
	
	updateGroupTransform (prop, values) {
		if (!this.om.selectionProxy || this.om.selectedMeshes.length === 0) return;
		
		const changes = [];
		this.om.selectedMeshes.forEach(mesh => {
			changes.push({
				id: mesh.metadata.id,
				oldData: {
					position: mesh.absolutePosition.asArray(),
					rotation: mesh.absoluteRotationQuaternion.toEulerAngles().asArray(),
					scaling: mesh.absoluteScaling.asArray()
				},
				newData: null
			});
		});
		
		if (prop === 'position') {
			this.om.selectionProxy.position = new BABYLON.Vector3(values.x, values.y, values.z);
		} else if (prop === 'rotation') {
			const rads = new BABYLON.Vector3(
				BABYLON.Tools.ToRadians(values.x),
				BABYLON.Tools.ToRadians(values.y),
				BABYLON.Tools.ToRadians(values.z)
			);
			this.om.selectionProxy.rotationQuaternion = BABYLON.Quaternion.FromEulerVector(rads);
		} else if (prop === 'scaling') {
			this.om.selectionProxy.scaling = new BABYLON.Vector3(values.x, values.y, values.z);
		}
		
		this.om.selectionProxy.computeWorldMatrix(true);
		this.om.selectedMeshes.forEach(m => m.computeWorldMatrix(true));
		
		changes.forEach(change => {
			const mesh = this.om.findMeshById(change.id);
			const objData = this.om.placedObjects.find(o => o.id === change.id);
			
			const newData = {
				position: mesh.absolutePosition.asArray(),
				rotation: mesh.absoluteRotationQuaternion.toEulerAngles().asArray(),
				scaling: mesh.absoluteScaling.asArray()
			};
			
			change.newData = newData;
			
			if (objData) {
				objData.position = newData.position;
				objData.rotation = newData.rotation;
				objData.scaling = newData.scaling;
			}
		});
		
		const actualChanges = changes.filter(c =>
			JSON.stringify(c.oldData) !== JSON.stringify(c.newData)
		);
		
		if (actualChanges.length > 0) {
			this.om.undoRedo.add({
				type: 'TRANSFORM',
				data: actualChanges
			});
		}
	}
	
	// Used by Undo/Redo directly
	updateObjectTransform (id, data) {
		if (this.om.selectionProxy) {
			this.om.selectObject(null, false);
		}
		
		const mesh = this.om.findMeshById(id);
		if (!mesh) return;
		
		mesh.position = BABYLON.Vector3.FromArray(data.position);
		mesh.rotationQuaternion = BABYLON.Quaternion.FromEulerVector(BABYLON.Vector3.FromArray(data.rotation));
		mesh.scaling = BABYLON.Vector3.FromArray(data.scaling);
		
		const objData = this.om.placedObjects.find(o => o.id === id);
		if (objData) {
			objData.position = data.position;
			objData.rotation = data.rotation;
			objData.scaling = data.scaling;
		}
		
		if (this.om.selectedMeshes.includes(mesh) && this.om.selectedMeshes.length === 1 && this.om.onSelectionChange) {
			this.om.onSelectionChange([objData]);
		}
	}
}
