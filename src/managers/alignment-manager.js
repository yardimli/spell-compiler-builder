import * as BABYLON from '@babylonjs/core';

export class AlignmentManager {
	constructor (objectManager) {
		this.om = objectManager;
	}
	
	alignSelection (axis, mode) {
		if (this.om.selectedMeshes.length < 2) return;
		
		// Detach gizmos temporarily
		if (this.om.selectionProxy) {
			this.om.selectedMeshes.forEach(m => m.setParent(null));
			this.om.selectionProxy.dispose();
			this.om.selectionProxy = null;
			this.om.gizmoController.attachToMesh(null);
		}
		
		let groupMin = Number.MAX_VALUE;
		let groupMax = -Number.MAX_VALUE;
		
		this.om.selectedMeshes.forEach(m => {
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
		
		this.om.selectedMeshes.forEach(mesh => {
			const id = mesh.metadata.id;
			const objData = this.om.placedObjects.find(o => o.id === id);
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
			this.om.undoRedo.add({
				type: 'TRANSFORM',
				data: changes
			});
			
			if (this.om.onSelectionChange) {
				const selectedData = this.om.selectedMeshes.map(m => this.om.placedObjects.find(o => o.id === m.metadata.id));
				this.om.onSelectionChange(selectedData);
			}
		}
		
		this.om.updateSelectionProxy();
	}
	
	snapSelection (axis) {
		if (this.om.selectedMeshes.length < 2) return;
		
		if (this.om.selectionProxy) {
			this.om.selectedMeshes.forEach(m => m.setParent(null));
			this.om.selectionProxy.dispose();
			this.om.selectionProxy = null;
			this.om.gizmoController.attachToMesh(null);
		}
		
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
		
		const meshesWithBounds = this.om.selectedMeshes.map(mesh => {
			mesh.computeWorldMatrix(true);
			const objData = this.om.placedObjects.find(o => o.id === mesh.metadata.id);
			return {
				mesh: mesh,
				data: objData,
				bounds: mesh.getHierarchyBoundingVectors()
			};
		});
		
		meshesWithBounds.sort((a, b) => {
			return a.bounds.min[axis] - b.bounds.min[axis];
		});
		
		const lockedIndices = meshesWithBounds.map((m, i) => m.data.isLocked ? i : -1).filter(i => i !== -1);
		
		if (lockedIndices.length === 0) {
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
			const pivotIndex = lockedIndices[0];
			
			let backEdge = meshesWithBounds[pivotIndex].bounds.min[axis];
			
			for (let i = pivotIndex - 1; i >= 0; i--) {
				const item = meshesWithBounds[i];
				const mesh = item.mesh;
				
				if (item.data.isLocked) {
					backEdge = item.bounds.min[axis];
				} else {
					const dim = item.bounds.max[axis] - item.bounds.min[axis];
					const currentMax = item.bounds.max[axis];
					const shift = backEdge - currentMax;
					
					mesh.position[axis] += shift;
					backEdge -= dim;
					mesh.computeWorldMatrix(true);
				}
			}
			
			let fwdEdge = meshesWithBounds[pivotIndex].bounds.max[axis];
			
			for (let i = pivotIndex + 1; i < meshesWithBounds.length; i++) {
				const item = meshesWithBounds[i];
				const mesh = item.mesh;
				
				if (item.data.isLocked) {
					fwdEdge = item.bounds.max[axis];
				} else {
					const dim = item.bounds.max[axis] - item.bounds.min[axis];
					const currentMin = item.bounds.min[axis];
					const shift = fwdEdge - currentMin;
					
					mesh.position[axis] += shift;
					fwdEdge += dim;
					mesh.computeWorldMatrix(true);
				}
			}
		}
		
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
			
			if (this.om.onSelectionChange) {
				const selectedData = this.om.selectedMeshes.map(m => this.om.placedObjects.find(o => o.id === m.metadata.id));
				this.om.onSelectionChange(selectedData);
			}
		}
		
		this.om.updateSelectionProxy();
	}
}
