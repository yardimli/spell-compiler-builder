import * as BABYLON from '@babylonjs/core';

export class GroupManager {
	constructor (objectManager) {
		this.om = objectManager;
	}
	
	createGroup (name, objectIds) {
		if (!objectIds || objectIds.length === 0) return;
		
		// 1. Remove these objects from any existing groups (One level only)
		this.om.groups.forEach(g => {
			g.objectIds = g.objectIds.filter(id => !objectIds.includes(id));
		});
		// Clean up empty groups
		this.om.groups = this.om.groups.filter(g => g.objectIds.length > 0);
		
		// 2. Create new group
		const groupId = BABYLON.Tools.RandomId();
		const newGroup = {
			id: groupId,
			name: name || `Group_${this.om.groups.length + 1}`,
			objectIds: [...objectIds]
		};
		
		this.om.groups.push(newGroup);
		
		if (this.om.onListChange) this.om.onListChange();
		
		// Select the new group implicitly by selecting its items
		this.om.selectObjectsByIds(objectIds);
	}
	
	deleteGroup (groupId) {
		// Just removes the group definition, objects remain (ungroup)
		this.om.groups = this.om.groups.filter(g => g.id !== groupId);
		if (this.om.onListChange) this.om.onListChange();
	}
	
	renameGroup (groupId, newName) {
		const group = this.om.groups.find(g => g.id === groupId);
		if (group) {
			group.name = newName;
			if (this.om.onListChange) this.om.onListChange();
		}
	}
	
	getGroupOfObject (objectId) {
		return this.om.groups.find(g => g.objectIds.includes(objectId));
	}
	
	// Called when objects are deleted from the scene to cleanup references
	cleanupDeletedObjects (deletedIds) {
		this.om.groups.forEach(g => {
			g.objectIds = g.objectIds.filter(id => !deletedIds.includes(id));
		});
		// Cleanup empty groups
		this.om.groups = this.om.groups.filter(g => g.objectIds.length > 0);
	}
}
