const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tag='div') { this.tagName=tag; this.children=[]; this.value=''; this.textContent=''; this.events={}; this.disabled=false; this.classList={toggle(){}}; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children=[...children]; }
  setAttribute(name,value) { this[name]=value; }
  addEventListener(name,cb) { this.events[name]=cb; }
  set innerHTML(value) { throw Error('Unsafe HTML insertion'); }
  reportValidity() { return true; }
  reset() { this.resetCount=(this.resetCount||0)+1; }
}
const read = name => fs.readFileSync(path.join(__dirname,'../remingtonsDD/',name),'utf8').replace(/^import .*;\n/gm,'');
const tick = () => new Promise(resolve=>setImmediate(resolve));
const event = {preventDefault(){}};
function base() {
  const elements=new Map();
  const doc={getElementById(id){if(!elements.has(id)) elements.set(id,new Element());return elements.get(id);},createElement:tag=>new Element(tag)};
  const auth={currentUser:{uid:'visitor'},authStateReady:async()=>{}};
  return {elements,auth,context:{document:doc,console,getApps:()=>[],getApp:()=>({}),initializeApp:()=>({}),firebaseConfig:{},getAuth:()=>auth,getFirestore:()=>({}),serverTimestamp:()=> 'SERVER_TIMESTAMP',doc:(db,...p)=>p.join('/')}};
}
async function publicForm() {
  const {elements,auth,context}=base(); let writes=[],fail=false;
  context.signInAnonymously=async()=>({user:{uid:'anonymous-visitor'}});
  context.setDoc=async(p,data)=>{if(fail)throw Object.assign(new Error('Denied'),{code:'permission-denied'});writes.push([p,data]);};
  vm.createContext(context);vm.runInContext(read('partnerships.js'),context);
  const e=id=>context.document.getElementById(id),submit=()=>e('partnership-form').events.submit(event);
  e('business-name').value='  City Supply  ';e('contact-name').value='  Sean  ';e('discord-contact').value='  sean.discord ';e('partnership-message').value='    ';
  await submit();assert.equal(writes.length,0);assert.match(e('contact-status').textContent,/complete each field/);
  e('partnership-message').value='  We would like to discuss a supply partnership.  ';
  e('contact-website').value='bot spam';await submit();assert.equal(writes.length,0);e('contact-website').value='';
  fail=true;await submit();assert.equal(e('send-inquiry').disabled,false);assert.match(e('contact-status').textContent,/follow-up/);
  fail=false;auth.currentUser=null;
  await Promise.all([submit(),submit()]);assert.equal(writes.length,1);
  assert.equal(writes[0][0],'partnershipInquiries/digital-den_anonymous-visitor');
  const data=writes[0][1];assert.equal(data.businessName,'City Supply');assert.equal(data.senderUid,'anonymous-visitor');assert.equal(data.createdAt,'SERVER_TIMESTAMP');assert.equal(data.status,'new');
  assert.deepEqual(Object.keys(data).sort(),['businessId','businessName','contactName','createdAt','discord','message','senderUid','status'].sort());
  assert.equal(e('send-inquiry').disabled,true);await submit();assert.equal(writes.length,1);
}
async function inbox() {
  const {elements,auth,context}=base();let authListener,snapshot,subscriptions=0,stopped=0,updates=[];
  context.onAuthStateChanged=(a,cb)=>{authListener=cb;};context.signInWithEmailAndPassword=async()=>{};context.signOut=async()=>{};
  context.collection=(db,name)=>name;context.query=(...args)=>args;context.where=(...args)=>args;
  context.onSnapshot=(q,cb)=>{subscriptions++;assert.equal(q[0],'partnershipInquiries');snapshot=cb;return ()=>stopped++;};
  context.updateDoc=async(p,data)=>updates.push([p,data]);
  vm.createContext(context);vm.runInContext(read('partnerships-admin.js'),context);
  const e=id=>context.document.getElementById(id);
  authListener({uid:'visitor'});assert.equal(subscriptions,0);
  auth.currentUser={uid:'Bm2XwQBXXEePFaaMfLs5K5ck0HB2'};authListener(auth.currentUser);assert.equal(subscriptions,1);e('filter').value='all';
  snapshot({docs:[{id:'safe-id',data:()=>({id:'spoof',businessName:'<img src=x onerror=alert(1)>',contactName:'Sean',discord:'name',message:'<script>bad()</script>',status:'new',createdAt:{seconds:1}})}]});
  const card=e('inquiry-list').children[0];assert.equal(card.children[0].textContent,'<img src=x onerror=alert(1)>');
  const dl=card.children[2];assert.equal(dl.children[5].textContent,'<script>bad()</script>');
  const [select,save]=card.children[3].children;select.value='contacted';await save.events.click();assert.equal(updates[0][0],'partnershipInquiries/safe-id');assert.equal(updates[0][1].status,'contacted');
  e('filter').value='closed';e('filter').events.change();assert.equal(e('inquiry-list').children.length,0);
  auth.currentUser=null;authListener(null);assert.equal(stopped,1);assert.equal(e('inquiry-list').children.length,0);
  snapshot({docs:[{id:'late',data:()=>({businessName:'Late private data'})}]});assert.equal(e('inquiry-list').children.length,0);
}
(async()=>{await publicForm();await inbox();console.log('PASS: contact validation, authentication, payload, duplicate clicks, retry; admin gate, safe text, status, filter and sign-out.');})().catch(error=>{console.error(error);process.exitCode=1;});
