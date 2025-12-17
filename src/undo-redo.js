export class UndoRedoManager {
	constructor (objectManager) {
		this.manager = objectManager;
		this.history = [];
		this.historyIndex = -1;
		this.maxHistory = 50;
		this.onHistoryChange = null;
	}
	
	add (action) {
		// Remove any future history if we are in the middle of the stack
		if (this.historyIndex < this.history.length - 1) {
			this.history = this.history.slice(0, this.historyIndex + 1);
		}
		
		this.history.push(action);
		if (this.history.length > this.maxHistory) {
			this.history.shift();
		} else {
			this.historyIndex++;
		}
		
		if (this.onHistoryChange) this.onHistoryChange();
	}
	
	undo () {
		if (this.historyIndex < 0) return;
		
		const action = this.history[this.historyIndex];
		// Get IDs of objects involved in this undo step
		const affectedIds = this.revertAction(action);
		this.historyIndex--;
		
		if (this.onHistoryChange) this.onHistoryChange();
		
		// Reselect the affected objects if they exist
		if (affectedIds && affectedIds.length > 0) {
			this.manager.selectObjectsByIds(affectedIds);
		}
	}
	
	redo () {
		if (this.historyIndex >= this.history.length - 1) return;
		
		this.historyIndex++;
		const action = this.history[this.historyIndex];
		// Get IDs of objects involved in this redo step
		const affectedIds = this.applyAction(action);
		
		if (this.onHistoryChange) this.onHistoryChange();
		
		// Reselect the affected objects if they exist
		if (affectedIds && affectedIds.length > 0) {
			this.manager.selectObjectsByIds(affectedIds);
		}
	}
	
	applyAction (action) {
		const affectedIds = [];
		
		switch (action.type) {
			case 'ADD':
				// action.data is an array of objects
				action.data.forEach(item => {
					this.manager.restoreObject(item);
					affectedIds.push(item.id);
				});
				break;
			case 'DELETE':
				// action.data is an array of objects
				action.data.forEach(item => {
					this.manager.removeObjectById(item.id, false);
					// We don't select deleted objects
				});
				// Clear selection after batch delete
				if (this.manager.onSelectionChange) this.manager.onSelectionChange(null);
				break;
			case 'TRANSFORM':
				// action.data is an array of {id, oldData, newData}
				action.data.forEach(change => {
					this.manager.updateObjectTransform(change.id, change.newData);
					affectedIds.push(change.id);
				});
				break;
			
				// NEW: Property Change (Visibility)
			case 'PROPERTY':
				action.data.forEach(change => {
					if (change.prop === 'isVisible') {
						this.manager.propertyManager.updateVisibility(change.id, change.newValue);
						// Don't select, just update state
					}
				});
				break;
		}
		
		return affectedIds;
	}
	
	revertAction (action) {
		const affectedIds = [];
		
		switch (action.type) {
			case 'ADD':
				action.data.forEach(item => {
					this.manager.removeObjectById(item.id, false);
				});
				if (this.manager.onSelectionChange) this.manager.onSelectionChange(null);
				break;
			case 'DELETE':
				action.data.forEach(item => {
					this.manager.restoreObject(item);
					affectedIds.push(item.id);
				});
				break;
			case 'TRANSFORM':
				action.data.forEach(change => {
					this.manager.updateObjectTransform(change.id, change.oldData);
					affectedIds.push(change.id);
				});
				break;
			
			// NEW: Property Change (Visibility)
			case 'PROPERTY':
				action.data.forEach(change => {
					if (change.prop === 'isVisible') {
						this.manager.propertyManager.updateVisibility(change.id, change.oldValue);
					}
				});
				break;
		}
		
		return affectedIds;
	}
}
