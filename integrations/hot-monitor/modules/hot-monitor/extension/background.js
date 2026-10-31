import {createResultCapture} from './result-capture.mjs';
import {createMediaBridge} from './media-bridge.mjs';
import {createLibraryCollector} from './collector-v2.mjs';
const resultCapture=createResultCapture(chrome);
const mediaBridge=createMediaBridge(chrome),collector=createLibraryCollector(chrome,mediaBridge);
async function stopLegacyAuto(){const scripts=await chrome.scripting.getRegisteredContentScripts({ids:['hot-monitor-auto-v1']});if(scripts.length)await chrome.scripting.unregisterContentScripts({ids:['hot-monitor-auto-v1']});await chrome.storage.session.set({hotMonitorCollectorSession:{enabled:false}});}
void stopLegacyAuto().catch(()=>{});
chrome.action.onClicked.addListener(tab=>void resultCapture.toolbar(tab).then(handled=>handled?undefined:collector.toolbar(tab)).catch(async error=>{await chrome.action.setBadgeText({tabId:tab.id,text:'!'});await chrome.action.setTitle({tabId:tab.id,title:String(error.message).slice(0,160)});}));
chrome.runtime.onMessage.addListener((message,sender,respond)=>{const task=message?.type?.startsWith('HM_CAPTURE_')?resultCapture.handle(message,sender):message?.type?.startsWith('HM_MEDIA_')?mediaBridge.handle(message,sender):collector.handle(message,sender);task.then(respond,error=>respond({ok:false,error:String(error?.message||'操作失败').slice(0,240)}));return true;});
