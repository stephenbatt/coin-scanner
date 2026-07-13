export const CONDITIONS=['Poor','Good','Fine','Very Fine','Extra Fine','About Uncirculated','Uncirculated','Proof'];
export const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:n>=100?0:2}).format(Number(n)||0);
export function loadCoins(){try{return JSON.parse(localStorage.getItem('redeye-coins')||'[]')}catch{return []}}
export function saveCoins(items){localStorage.setItem('redeye-coins',JSON.stringify(items))}
export function fileToDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file)})}
