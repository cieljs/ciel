import { ipcRenderer } from 'electron';

window.addEventListener('message', event => {
  if (event.source !== window || event.data !== 'blive-agent:connect' || event.ports.length !== 1) {
    return;
  }

  const sameOrigin =
    event.origin === window.location.origin ||
    (window.location.protocol === 'file:' && event.origin === 'null');

  if (!sameOrigin) {
    return;
  }

  ipcRenderer.postMessage('blive-agent:rpc', null, [event.ports[0]!]);
});
