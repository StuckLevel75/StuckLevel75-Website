import {initializeApp,getApps,getApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth,onAuthStateChanged,signInWithEmailAndPassword,signOut} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {firebaseConfig} from '/firebase-config.js';
const $=id=>document.getElementById(id);
const auth=getAuth(getApps().length?getApp():initializeApp(firebaseConfig));
const adminUid='Bm2XwQBXXEePFaaMfLs5K5ck0HB2';
const api='https://digital-den-auth.dburghagen.workers.dev/admin/announcements';
let currentId='',items=[],busy=false;
async function request(method='GET',id='',data){
 const user=auth.currentUser;
 if(!user||user.uid!==adminUid)throw Error('Administrator login required');
 const token=await user.getIdToken();
 const response=await fetch(api+(id?'/'+encodeURIComponent(id):''),{method,headers:{Authorization:'Bearer '+token,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
 const result=await response.json();
 if(!response.ok)throw Error(result.error||'Request failed');
 return result;
}
function preview(){
 $('preview-channel').textContent=$('channel').value==='public'?'# Public Announcements':'# Private Staff Updates';
 $('preview-title').textContent=$('title').value.trim()||'Announcement title';
 $('preview-message').textContent=$('message').value.trim()||'Your message will appear here.';
 $('preview-mention').classList.toggle('hidden',$('mention').value!=='everyone');
 const staff=$('channel').value==='staff';
 $('mention').querySelector('[value="everyone"]').disabled=staff;
 if(staff&&$('mention').value==='everyone')$('mention').value='none';
 $('preview-mention').classList.toggle('hidden',$('mention').value!=='everyone');
}
function reset(){
 currentId='';$('editor').reset();$('editor-title').textContent='Create Announcement';$('editor-status').textContent='';
 $('channel').disabled=false;$('save-draft').disabled=false;preview();
}
function edit(item){
 currentId=item.id;$('title').value=item.title;$('message').value=item.message;
 $('channel').value=item.channel;$('mention').value=item.mention||'none';
 $('channel').disabled=item.status==='published';$('save-draft').disabled=item.status==='published';
 $('editor-title').textContent=item.status==='published'?'Edit Published Announcement':'Edit Draft';
 $('editor-status').textContent=item.status==='published'?'Publishing changes edits the existing Discord message.':'Editing saved draft.';
 preview();window.scrollTo({top:0,behavior:'smooth'});
}
function render(){
 const list=$('items');list.replaceChildren();
 $('list-status').textContent=items.length?items.length+' announcement(s)':'No announcements yet.';
 for(const item of items){
  const box=document.createElement('article');box.className='item';
  const h=document.createElement('h3');h.textContent=item.title;
  const meta=document.createElement('p');meta.className='muted tiny';meta.textContent=(item.channel==='staff'?'Staff':'Public')+' · '+(item.status==='published'?'Published':'Draft')+' · '+(item.updatedAt?new Date(item.updatedAt).toLocaleString():'');
  const body=document.createElement('p');body.textContent=item.message.length>250?item.message.slice(0,250)+'…':item.message;
  const buttons=document.createElement('div');buttons.className='row';
  const change=document.createElement('button');change.className='secondary';change.textContent='Edit';change.onclick=()=>edit(item);
  const remove=document.createElement('button');remove.className='danger';remove.textContent='Delete';remove.onclick=async()=>{
   if(!confirm('Delete this '+(item.status==='published'?'announcement from Discord and history':'draft')+'? This cannot be undone.'))return;
   remove.disabled=true;
   try{await request('DELETE',item.id);if(currentId===item.id)reset();await load()}
   catch(e){$('list-status').textContent='Delete failed: '+e.message;remove.disabled=false}
  };
  buttons.append(change,remove);box.append(h,meta,body,buttons);list.append(box);
 }
}
async function load(){try{const data=await request();items=data.items||[];render()}catch(e){$('list-status').textContent='Could not load announcements: '+e.message}}
async function save(action){
 if(busy||!$('editor').reportValidity())return;
 const title=$('title').value.trim(),message=$('message').value.trim(),channel=$('channel').value,mention=$('mention').value;
 if(!title||!message){$('editor-status').textContent='Enter a title and message.';return}
 if(action==='publish'&&mention==='everyone'&&!confirm('Notify @everyone in the public channel?'))return;
 if(action==='publish'&&!confirm((currentId?'Update':'Publish')+' this announcement in '+(channel==='public'?'Public Announcements':'Private Staff Updates')+'?'))return;
 busy=true;$('publish').disabled=true;$('save-draft').disabled=true;$('editor-status').textContent=action==='publish'?'Sending to Discord…':'Saving draft…';
 try{
  const result=await request(currentId?'PATCH':'POST',currentId,{title,message,channel,mention,action});
  currentId=result.id;
  $('editor-status').textContent=action==='publish'?'Announcement published to Discord.':'Draft saved.';
  await load();reset();$('editor-status').textContent=action==='publish'?'Announcement published to Discord.':'Draft saved.';
 }catch(e){$('editor-status').textContent=e.message}
 finally{busy=false;$('publish').disabled=false;$('save-draft').disabled=!!items.find(x=>x.id===currentId&&x.status==='published')}
}
$('login-form').addEventListener('submit',async e=>{e.preventDefault();$('login-status').textContent='Signing in…';try{await signInWithEmailAndPassword(auth,$('email').value.trim(),$('password').value)}catch{$('login-status').textContent='Sign-in failed. Check your credentials.'}});
$('restock-panel').onclick=async()=>{
 if(!confirm('Post a Request Restock button in Private Staff Updates?'))return;
 const button=$('restock-panel');button.disabled=true;$('restock-status').textContent='Posting…';
 try{
  const user=auth.currentUser;if(!user||user.uid!==adminUid)throw Error('Administrator access required');
  const token=await user.getIdToken();
  const response=await fetch('https://digital-den-auth.dburghagen.workers.dev/admin/restock-panel',{method:'POST',headers:{Authorization:'Bearer '+token}});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Could not post button');
  $('restock-status').textContent='Restock button posted in Staff Updates.';
 }catch(e){$('restock-status').textContent=e.message}finally{button.disabled=false}
};
$('logout').onclick=()=>signOut(auth);
$('editor').addEventListener('submit',e=>{e.preventDefault();save('publish')});
$('save-draft').onclick=()=>save('draft');$('reset').onclick=reset;$('refresh').onclick=load;
for(const id of ['title','message','channel','mention'])$(id).addEventListener(id==='channel'||id==='mention'?'change':'input',preview);
onAuthStateChanged(auth,user=>{const allowed=user?.uid===adminUid;$('login').classList.toggle('hidden',allowed);$('dashboard').classList.toggle('hidden',!allowed);if(!allowed){items=[];$('items').replaceChildren();reset();$('login-status').textContent=user?'This account does not have administrator access.':'';return}$('login-status').textContent='';load()});
preview();
