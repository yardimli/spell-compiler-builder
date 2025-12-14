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
		this.revertAction(action);
		this.historyIndex--;
		
		if (this.onHistoryChange) this.onHistoryChange();
	}
	
	redo () {
		if (this.historyIndex >= this.history.length - 1) return;
		
		this.historyIndex++;
		const action = this.history[this.historyIndex];
		this.applyAction(action);
		
		if (this.onHistoryChange) this.onHistoryChange();
	}
	
	applyAction (action) {
		switch (action.type) {
			case 'ADD':
				// action.data is an array of objects
				action.data.forEach(item => this.manager.restoreObject(item));
				break;
			case 'DELETE':
				// action.data is an array of objects
				action.data.forEach(item => this.manager.removeObjectById(item.id, false));
				// Clear selection after batch delete
				if (this.manager.onSelectionChange) this.manager.onSelectionChange(null);
				break;
			case 'TRANSFORM':
				// action.data is an array of {id, oldData, newData}
				action.data.forEach(change => {
					this.manager.updateObjectTransform(change.id, change.newData);
				});
				break;
		}
	}
	
	revertAction (action) {
		switch (action.type) {
			case 'ADD':
				action.data.forEach(item => this.manager.removeObjectById(item.id, false));
				if (this.manager.onSelectionChange) this.manager.onSelectionChange(null);
				break;
			case 'DELETE':
				action.data.forEach(item => this.manager.restoreObject(item));
				break;
			case 'TRANSFORM':
				action.data.forEach(change => {
					this.manager.updateObjectTransform(change.id, change.oldData);
				});
				break;
		}
	}
}
