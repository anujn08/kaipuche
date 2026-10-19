const database=new Promise((resolve,reject)=>{
  const req=indexedDB.open('yatra-phone',1);
  req.onupgradeneeded=()=>req.result.createObjectStore('data');
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
});
export async function get(key){const db=await database;return new Promise((resolve,reject)=>{const request=db.transaction('data').objectStore('data').get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
export async function put(key,value){const db=await database;return new Promise((resolve,reject)=>{const tx=db.transaction('data','readwrite');tx.objectStore('data').put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
