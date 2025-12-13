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
				this.manager.restoreObject(action.data);
				break;
			case 'DELETE':
				this.manager.removeObjectById(action.id, false);
				break;
			case 'TRANSFORM':
				this.manager.updateObjectTransform(action.id, action.newData);
				break;
		}
	}
	
	revertAction (action) {
		switch (action.type) {
			case 'ADD':
				this.manager.removeObjectById(action.data.id, false);
				break;
			case 'DELETE':
				this.manager.restoreObject(action.data);
				break;
			case 'TRANSFORM':
				this.manager.updateObjectTransform(action.id, action.oldData);
				break;
		}
	}
}
