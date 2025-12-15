import * as BABYLON from '@babylonjs/core';

export class OperationManager {
	constructor (objectManager) {
		this.om = objectManager;
	}
	
	deleteSelected () {
		if (this.om.selectedMeshes.length === 0) return;
		
		const deletedData = [];
		const deletedIds = [];
		
		// Create a copy of the array to iterate safely
		const meshesToDelete = [...this.om.selectedMeshes];
		
		meshesToDelete.forEach(mesh => {
			// Safety check for metadata
			if (!mesh.metadata) return;
			
			const id = mesh.metadata.id;
			const objData = this.om.placedObjects.find(o => o.id === id);
			
			if (objData && !objData.isLocked) {
				deletedData.push(objData);
				deletedIds.push(id);
				// We pass false to skip individual selection updates/proxy rebuilds for performance
				this.om.removeObjectById(id, false);
			}
		});
		
		// Delegate group cleanup to GroupManager
		this.om.groupManager.cleanupDeletedObjects(deletedIds);
		
		// CRITICAL FIX: Clean up selectedMeshes to remove disposed objects
		// If we don't do this, selectedMeshes contains disposed meshes which causes crashes in UI
		this.om.selectedMeshes = this.om.selectedMeshes.filter(m =>
			m.metadata && !deletedIds.includes(m.metadata.id)
		);
		this.om.updateSelectionProxy();
		
		if (deletedData.length > 0) {
			this.om.undoRedo.add({ type: 'DELETE', data: deletedData });
		}
		
		// Update UI with remaining selection (if any locked objects remain)
		if (this.om.onSelectionChange) {
			if (this.om.selectedMeshes.length > 0) {
				const selectedData = this.om.selectedMeshes
					.map(m => this.om.placedObjects.find(o => o.id === m.metadata.id))
					.filter(Boolean);
				this.om.onSelectionChange(selectedData);
			} else {
				this.om.onSelectionChange(null);
			}
		}
		
		if (this.om.onListChange) this.om.onListChange();
	}
	
	duplicateSelection () {
		if (this.om.selectedMeshes.length === 0) return;
		
		const newObjectsData = [];
		const newMeshes = [];
		
		this.om.selectedMeshes.forEach(m => this.om.setSelectionHighlight(m, false));
		
		this.om.selectedMeshes.forEach(originalMesh => {
			const originalData = this.om.placedObjects.find(o => o.id === originalMesh.metadata.id);
			if (!originalData) return;
			
			const newId = BABYLON.Tools.RandomId();
			const baseName = originalData.name.split('_')[0];
			const newName = `${baseName}_copy_${Math.floor(Math.random() * 1000)}`;
			
			const offset = new BABYLON.Vector3(0.5, 0, 0.5);
			const newPos = originalMesh.absolutePosition.clone().add(offset);
			
			let newRoot;
			
			if (originalData.type === 'light') {
				const light = new BABYLON.PointLight(newName, newPos, this.om.scene);
				light.intensity = 0.5;
				light.metadata = { id: newId, isObject: true, type: 'light' };
				
				const sphere = BABYLON.MeshBuilder.CreateSphere(newName + '_gizmo', { diameter: 0.5 }, this.om.scene);
				sphere.position = light.position;
				sphere.material = new BABYLON.StandardMaterial('lm', this.om.scene);
				sphere.material.emissiveColor = new BABYLON.Color3(1, 1, 0);
				sphere.setParent(light);
				sphere.isPickable = true;
				newRoot = light;
			} else {
				newRoot = originalMesh.instantiateHierarchy(null, { doNotInstantiate: true });
				newRoot.name = newName;
				newRoot.position = newPos;
				newRoot.rotationQuaternion = originalMesh.absoluteRotationQuaternion.clone();
				newRoot.scaling = originalMesh.absoluteScaling.clone();
				
				newRoot.metadata = { id: newId, isObject: true, file: originalData.file };
				
				const descendants = newRoot.getChildMeshes(false);
				if (newRoot instanceof BABYLON.Mesh) descendants.push(newRoot);
				
				descendants.forEach(m => {
					this.om.shadowGenerator.addShadowCaster(m, true);
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
			
			this.om.placedObjects.push(newData);
			newObjectsData.push(newData);
			newMeshes.push(newRoot);
		});
		
		this.om.selectObject(null, false);
		newMeshes.forEach(m => this.om.selectObject(m, true));
		
		this.om.undoRedo.add({ type: 'ADD', data: newObjectsData });
		if (this.om.onListChange) this.om.onListChange();
	}
}
