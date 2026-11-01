const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('pulso', {
  getState: () => invoke('state:get'),
  reload: () => invoke('data:reload'),
  addTask: (task) => invoke('task:add', task),
  toggleTask: (id) => invoke('task:toggle', id),
  deleteTask: (id) => invoke('task:delete', id),
  clearDone: () => invoke('task:clearDone'),
  setSettings: (patch) => invoke('settings:set', patch),
  showWidget: () => invoke('widget:show'),
  hideWidget: () => invoke('widget:hide'),
  widgetVisibility: () => invoke('widget:visibility'),
  showMain: () => invoke('main:show'),
  launchAgent: (projectId, agentId) => invoke('agent:launch', { projectId, agentId }),
  pickProjectFolder: () => invoke('project:pickFolder'),
  addProject: (payload) => invoke('project:add', payload),
  aiProjectPreview: (folder) => invoke('ai:project:preview', folder),
  getAiConfig: () => invoke('ai:config:get'),
  setAiConfig: (patch) => invoke('ai:config:set', patch),
  testAi: () => invoke('ai:test'),
  aiRemap: (projectId) => invoke('ai:remap', projectId),
  aiApply: (payload) => invoke('ai:apply', payload),
  aiDocsPreview: (payload) => invoke('ai:docs:preview', payload),
  aiDocsWrite: (payload) => invoke('ai:docs:write', payload),
  openAiKeyPage: (providerId) => invoke('ai:openKeyPage', providerId),
  openProjectFolder: (projectId) => invoke('project:openFolder', projectId),
  openDoc: (projectId, relative) => invoke('project:openDoc', { projectId, relative }),
  openRoot: () => invoke('app:openRoot'),
  openStateFolder: () => invoke('app:openStateFolder'),
  quit: () => invoke('app:quit'),
  onStateChanged: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('state:changed', handler);
    return () => ipcRenderer.removeListener('state:changed', handler);
  },
  onWidgetVisibility: (callback) => {
    const handler = (_event, visible) => callback(visible);
    ipcRenderer.on('widget:visibility', handler);
    return () => ipcRenderer.removeListener('widget:visibility', handler);
  }
});
