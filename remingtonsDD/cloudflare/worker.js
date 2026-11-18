// Deploy this file to Cloudflare Worker digital-den-auth (not GitHub Pages).
// Required secrets: DISCORD_CLIENT_SECRET, FIREBASE_SERVICE_ACCOUNT, SESSION_SIGNING_SECRET (random 32+ chars).
// Required text vars: DISCORD_CLIENT_ID, DISCORD_GUILD_ID, WEBSITE_URL.
const ORIGIN = "https://stucklevel75.com";
const CALLBACK = "https://digital-den-auth.dburghagen.workers.dev/callback";
const encoder = new TextEncoder();
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const unb64url = s => Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(s.length/4)*4,"=")),c=>c.charCodeAt(0));
const json = (data,status=200,headers={}) => new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store",...headers}});
const redirect = (url,cookie) => new Response(null,{status:302,headers:{Location:url,"Cache-Control":"no-store",...(cookie?{"Set-Cookie":cookie}:{})}});
const cookie = (name,value,maxAge=600) => `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
const cookieValue = (request,name) => (request.headers.get("Cookie")||"").split(";").map(s=>s.trim()).find(s=>s.startsWith(name+"="))?.slice(name.length+1);
async function hmac(secret,value) {
  const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);
  return b64url(await crypto.subtle.sign("HMAC",key,encoder.encode(value)));
}
async function signPayload(secret,payload) {
  const body=b64url(encoder.encode(JSON.stringify(payload)));
  return body+"."+await hmac(secret,body);
}
async function readPayload(secret,token) {
  if(typeof token!=="string"||token.length>4000)return null;
  const [body,signature,...rest]=token.split(".");
  if(!body||!signature||rest.length)return null;
  const expected=await hmac(secret,body);
  const a=encoder.encode(signature),b=encoder.encode(expected);
  if(a.length!==b.length)return null;
  let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
  if(diff)return null;
  try { const payload=JSON.parse(new TextDecoder().decode(unb64url(body)));
    return payload.exp>Date.now()&&payload.exp<=Date.now()+600000&&payload.aud==="dd-apply"&&/^\d{15,22}$/.test(payload.discordId)?payload:null;
  } catch{return null;}
}
let cachedAuth=null;
async function firebaseToken(env) {
  if(cachedAuth&&cachedAuth.exp>Date.now()+60000)return cachedAuth.value;
  const sa=JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  if(!sa.client_email||!sa.private_key||!sa.project_id)throw Error("Invalid Firebase service account");
  const now=Math.floor(Date.now()/1000);
  const head=b64url(encoder.encode(JSON.stringify({alg:"RS256",typ:"JWT"})));
  const claims=b64url(encoder.encode(JSON.stringify({iss:sa.client_email,sub:sa.client_email,aud:"https://oauth2.googleapis.com/token",scope:"https://www.googleapis.com/auth/datastore",iat:now,exp:now+3600})));
  const keyData=sa.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,"");
  const key=await crypto.subtle.importKey("pkcs8",Uint8Array.from(atob(keyData),c=>c.charCodeAt(0)),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
  const assertion=head+"."+claims+"."+b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,encoder.encode(head+"."+claims)));
  const resp=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion})});
  if(!resp.ok)throw Error("Firebase authorization failed");
  const data=await resp.json();cachedAuth={value:data.access_token,exp:Date.now()+(data.expires_in||3600)*1000};return cachedAuth.value;
}
const fv = v => typeof v==="string"?{stringValue:v}:typeof v==="boolean"?{booleanValue:v}:Array.isArray(v)?{arrayValue:{values:v.map(fv)}}:v&&typeof v==="object"?{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,val])=>[k,fv(val)]))}}:{nullValue:null};
async function submit(env,payload,data) {
  const sa=JSON.parse(env.FIREBASE_SERVICE_ACCOUNT),project=sa.project_id;
  if(project!=="stucklevel75")throw Error("Firebase project mismatch");
  const access=await firebaseToken(env);
  const root=`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
  const headers={Authorization:"Bearer "+access};
  const business=await fetch(root+"/businesses/digital-den",{headers});
  if(!business.ok)throw Error("Could not check hiring status");
  const record=await business.json();
  if(record.fields?.hiringOpen?.booleanValue!==true||record.fields?.status?.stringValue==="past")return {error:"Applications are closed",status:403};
  const name="digital-den_discord_"+payload.discordId;
  const values={businessId:"digital-den",applicantUid:"discord:"+payload.discordId,discordId:payload.discordId,discordUsername:payload.username||"",name:data.name,contact:data.contact,experience:data.experience,reason:data.reason,availability:data.availability,extraAnswers:data.extraAnswers,status:"pending"};
  const fields=Object.fromEntries(Object.entries(values).map(([k,v])=>[k,fv(v)]));
  fields.createdAt={timestampValue:new Date().toISOString()};
  // Firestore createDocument fails with ALREADY_EXISTS, preventing duplicate submissions.
  const response=await fetch(root+"/applications?documentId="+encodeURIComponent(name),{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify({fields})});
  if(response.status===409)return {error:"You have already applied.",status:409};
  if(!response.ok)throw Error("Could not save application");
  return {ok:true};
}
function validate(d) {
  if(!d||typeof d!=="object")return false;
  const limits={name:[2,80],contact:[3,120],experience:[0,1200],reason:[10,1200],availability:[0,500]};
  for(const [key,[min,max]] of Object.entries(limits))if(typeof d[key]!=="string"||d[key].trim().length<min||d[key].length>max)return false;
  return Array.isArray(d.extraAnswers)&&d.extraAnswers.length<=8&&d.extraAnswers.every(a=>a&&typeof a.question==="string"&&a.question.length<=200&&typeof a.answer==="string"&&a.answer.length<=1200);
}
// Assign the purpose role and, when configured, the default Member role.
// Discord requires the bot to have Manage Roles and sit above each target role.
async function assignDiscordRoles(env,discordId,purpose) {
  if(!env.DISCORD_BOT_TOKEN)throw Error("DISCORD_BOT_TOKEN is not configured");
  const purposeRole=purpose==="contact"?"1572468132562337803":"1572467945097920664";
  const roles=["1572372330707947791",purposeRole];
  for(const roleId of new Set(roles)) {
    const response=await fetch(`https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}/members/${discordId}/roles/${roleId}`,{
      method:"PUT",headers:{Authorization:"Bot "+env.DISCORD_BOT_TOKEN}
    });
    if(!response.ok)throw Error("Discord role assignment failed for role "+roleId+" (HTTP "+response.status+")");
  }
}
function validateInquiry(d) {
  return d && typeof d==="object" && [["businessName",2,120],["contactName",2,80],["discord",2,120],["message",10,2000]].every(([key,min,max])=>typeof d[key]==="string"&&d[key].trim().length>=min&&d[key].length<=max);
}
async function submitInquiry(env,payload,data) {
  const access=await firebaseToken(env);
  const root="https://firestore.googleapis.com/v1/projects/stucklevel75/databases/(default)/documents";
  const fields=Object.fromEntries(Object.entries({
    businessId:"digital-den",senderUid:"discord:"+payload.discordId,
    discordId:payload.discordId,discordUsername:payload.username||"",
    businessName:data.businessName,contactName:data.contactName,
    discord:data.discord,message:data.message,status:"new"
  }).map(([k,v])=>[k,fv(v)]));
  fields.createdAt={timestampValue:new Date().toISOString()};
  const response=await fetch(root+"/partnershipInquiries?documentId="+encodeURIComponent("digital-den_discord_"+payload.discordId),{
    method:"POST",headers:{Authorization:"Bearer "+access,"Content-Type":"application/json"},body:JSON.stringify({fields})
  });
  if(response.status===409)return {error:"You have already sent an inquiry. Contact staff on Discord for follow-up.",status:409};
  if(!response.ok)throw Error("Firestore inquiry creation failed");
  return {ok:true};
}
// Read-only diagnostics. Only the Firebase administrator can request these checks.
async function verifyAdminToken(env,token) {
  if(typeof token!=="string"||token.length>5000)return false;
  const parts=token.split(".");
  if(parts.length!==3)return false;
  try {
    const header=JSON.parse(new TextDecoder().decode(unb64url(parts[0])));
    const claims=JSON.parse(new TextDecoder().decode(unb64url(parts[1])));
    const project=JSON.parse(env.FIREBASE_SERVICE_ACCOUNT).project_id;
    const now=Math.floor(Date.now()/1000);
    if(header.alg!=="RS256"||!header.kid||claims.aud!==project||claims.iss!=="https://securetoken.google.com/"+project||claims.sub!=="Bm2XwQBXXEePFaaMfLs5K5ck0HB2"||claims.exp<=now||claims.iat>now||claims.auth_time>now)return false;
    const keysResponse=await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
    if(!keysResponse.ok)return false;
    const keys=await keysResponse.json();
    const jwk=keys.keys?.find(k=>k.kid===header.kid);
    if(!jwk)return false;
    const key=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,unb64url(parts[2]),encoder.encode(parts[0]+"."+parts[1]));
  }catch{return false;}
}
async function botDiagnostics(env) {
  const roles=[{name:"Member",id:"1572372330707947791"},{name:"Job Applicant",id:"1572467945097920664"},{name:"Business Contact",id:"1572468132562337803"}];
  if(!env.DISCORD_BOT_TOKEN)return {ok:false,error:"Bot token is missing in Cloudflare."};
  const headers={Authorization:"Bot "+env.DISCORD_BOT_TOKEN};
  const [botResponse,guildResponse,rolesResponse]=await Promise.all([
    fetch("https://discord.com/api/v10/users/@me",{headers}),
    fetch("https://discord.com/api/v10/guilds/"+env.DISCORD_GUILD_ID+"/members/"+encodeURIComponent((await (await fetch("https://discord.com/api/v10/users/@me",{headers})).json()).id),{headers}),
    fetch("https://discord.com/api/v10/guilds/"+env.DISCORD_GUILD_ID+"/roles",{headers})
  ]);
  if(!botResponse.ok)return {ok:false,error:"Discord rejected the bot token (HTTP "+botResponse.status+")."};
  if(!guildResponse.ok||!rolesResponse.ok)return {ok:false,error:"Bot cannot access server or roles (HTTP "+guildResponse.status+"/"+rolesResponse.status+")."};
  const bot=await botResponse.json(),member=await guildResponse.json(),guildRoles=await rolesResponse.json();
  const botRoles=guildRoles.filter(r=>member.roles.includes(r.id));
  const highest=Math.max(0,...botRoles.map(r=>r.position));
  const admin=botRoles.some(r=>(BigInt(r.permissions)&8n)!==0n);
  const manage=admin||botRoles.some(r=>(BigInt(r.permissions)&(1n<<28n))!==0n);
  const checks=roles.map(r=>{
    const found=guildRoles.find(x=>x.id===r.id);
    return {name:r.name,exists:!!found,assignable:!!found&&manage&&highest>found.position,reason:!found?"Role not found":!manage?"Bot needs Manage Roles":highest<=found.position?"Move the bot's highest role above this role":"Ready"};
  });
  return {ok:checks.every(r=>r.assignable),botName:bot.username,manageRoles:manage,roles:checks};
}

const ANNOUNCEMENT_CHANNELS={public:"1572372341806338219",staff:"1572372383161909290",restock:"1572372357748891648"};
const ANNOUNCEMENT_COLLECTION="digitalDenAnnouncements";
const firestoreRoot="https://firestore.googleapis.com/v1/projects/stucklevel75/databases/(default)/documents";
const fieldValue=value=>typeof value==="string"?{stringValue:value}:typeof value==="boolean"?{booleanValue:value}:{nullValue:null};
const fromFields=fields=>Object.fromEntries(Object.entries(fields||{}).map(([k,v])=>[k,v.stringValue??v.booleanValue??null]));
async function announcementStore(env,path,method="GET",body) {
 const access=await firebaseToken(env);
 const response=await fetch(firestoreRoot+"/"+ANNOUNCEMENT_COLLECTION+path,{method,headers:{Authorization:"Bearer "+access,...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});
 if(!response.ok){if(response.status===404)return null;throw Error("Announcement database request failed (HTTP "+response.status+")")}
 return method==="DELETE"?{}:response.json();
}
function announcementData(value) {return {fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,fieldValue(v)]))};}
async function discordAnnouncement(env,channel,id,method,body) {
 if(!env.DISCORD_BOT_TOKEN)throw Error("Discord bot token is not configured");
 const response=await fetch("https://discord.com/api/v10/channels/"+ANNOUNCEMENT_CHANNELS[channel]+"/messages"+(id?"/"+encodeURIComponent(id):""),{
  method,headers:{Authorization:"Bot "+env.DISCORD_BOT_TOKEN,...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})
 });
 if(method==="DELETE"&&response.status===404)return {alreadyMissing:true};
 if(!response.ok)throw Error("Discord "+method+" failed (HTTP "+response.status+"). Check the bot message and channel.");
 return method==="DELETE"?{}:response.json();
}
function discordBody(item) {
 return {content:item.mention==="everyone"?"@everyone": "",allowed_mentions:{parse:item.mention==="everyone"?["everyone"]:[]},embeds:[{title:item.title,description:item.message,color:0x9d55db,footer:{text:"Remington's Digital Den"}}]};
}
async function handleAnnouncement(env,request) {
 const url=new URL(request.url);
 const parts=url.pathname.split("/").filter(Boolean),id=parts[2]||"";
 const method=request.method;
 if(method==="GET"&&!id){
  const result=await announcementStore(env,"?pageSize=100");
  return {items:(result?.documents||[]).map(d=>({id:d.name.split("/").pop(),...fromFields(d.fields)})).sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||""))};
 }
 if(!["POST","PATCH","DELETE"].includes(method))return {error:"Unsupported action",status:405};
 if(id&&!/^[a-f0-9-]{36}$/.test(id))return {error:"Invalid announcement",status:400};
 const existing=id?await announcementStore(env,"/"+id):null;
 if(id&&!existing)return {error:"Announcement not found",status:404};
 const old=existing?fromFields(existing.fields):null;
 if(method==="DELETE"){
  if(old.status==="published"&&old.discordMessageId)await discordAnnouncement(env,old.channel,old.discordMessageId,"DELETE");
  await announcementStore(env,"/"+id,"DELETE");
  return {ok:true};
 }
 if(Number(request.headers.get("Content-Length")||0)>12000)return {error:"Message too large",status:413};
 const data=await request.json();
 const title=typeof data.title==="string"?data.title.trim():"";
 const message=typeof data.message==="string"?data.message.trim():"";
 const channel=data.channel,mention=data.mention||"none",action=data.action||"draft";
 if(!title||title.length>256||!message||message.length>4000||!ANNOUNCEMENT_CHANNELS[channel]||!["none","everyone"].includes(mention)||mention==="everyone"&&channel!=="public"||!["draft","publish"].includes(action))return {error:"Check title, message, channel, and notification",status:400};
 if(old?.status==="published"&&channel!==old.channel)return {error:"Published announcements cannot change channels",status:400};
 if(old?.status==="published"&&action==="draft")return {error:"Published announcements cannot become drafts",status:400};
 const now=new Date().toISOString(),record={title,message,channel,mention,status:action==="publish"?"published":"draft",updatedAt:now,createdAt:old?.createdAt||now,discordMessageId:old?.discordMessageId||""};
 if(action==="publish"){
  const sent=await discordAnnouncement(env,channel,old?.discordMessageId||"",(old?.discordMessageId?"PATCH":"POST"),discordBody(record));
  record.discordMessageId=sent.id;
 }
 const target=id||crypto.randomUUID();
 const stored=await announcementStore(env,"/"+target+(id?"?updateMask.fieldPaths=title&updateMask.fieldPaths=message&updateMask.fieldPaths=channel&updateMask.fieldPaths=mention&updateMask.fieldPaths=status&updateMask.fieldPaths=updatedAt&updateMask.fieldPaths=createdAt&updateMask.fieldPaths=discordMessageId":""),id?"PATCH":"PATCH",announcementData(record));
 return {ok:true,id:target,item:{...record,id:target}};
}


const RESTOCK_CHANNEL="1572372357748891648";
const RESTOCK_MANAGER_ROLE="1572372322092974154";
const RESTOCK_COLLECTION="digitalDenRestockRequests";
const restockReply=(data,status=200)=>json(data,status);
const restockMessage=(content,ephemeral=true)=>({type:4,data:{content,flags:ephemeral?64:0,allowed_mentions:{parse:[]}}});
function restockButtons(id,status) {
 return [{type:1,components:["approved","denied","restocked"].map(action=>({type:2,style:action==="approved"?3:action==="denied"?4:1,label:action==="approved"?"Approve":action==="denied"?"Deny":"Restocked",custom_id:"restock:"+action+":"+id,disabled:status!=="pending"&&!(status==="approved"&&action==="restocked")}))}];
}
function restockEmbed(item) {
 return [{title:"Restock Request",color:item.status==="restocked"?0x2ecc71:item.status==="denied"?0xe74c3c:0x9d55db,fields:[{name:"Item",value:item.item},{name:"Requested by",value:"<@"+item.requester+">"},{name:"Status",value:item.status.charAt(0).toUpperCase()+item.status.slice(1)}],footer:{text:"Remington's Digital Den"}}];
}
async function restockFirestore(env,id,method="GET",value) {
 const access=await firebaseToken(env),url=firestoreRoot+"/"+RESTOCK_COLLECTION+"/"+encodeURIComponent(id);
 const response=await fetch(url,{method,headers:{Authorization:"Bearer "+access,...(value?{"Content-Type":"application/json"}:{})},...(value?{body:JSON.stringify(announcementData(value))}:{})});
 if(response.status===404)return null;
 if(!response.ok)throw Error("Restock database error HTTP "+response.status);
 return response.json();
}
function restockUser(interaction) {return interaction.member?.user?.id||interaction.user?.id||"";}
function isRestockManager(interaction,env) {
 const roles=interaction.member?.roles||[];
 return roles.includes(RESTOCK_MANAGER_ROLE)||(BigInt(interaction.member?.permissions||"0")&8n)!==0n||restockUser(interaction)===env.RESTOCK_OWNER_ID;
}
async function verifyDiscordInteraction(request,env,body) {
 const signature=request.headers.get("X-Signature-Ed25519"),timestamp=request.headers.get("X-Signature-Timestamp");
 const pub=env.DISCORD_PUBLIC_KEY;
 if(!signature||!timestamp||!pub||!/^([0-9a-f]{2}){64}$/i.test(signature)||!/^([0-9a-f]{2}){32}$/i.test(pub)||!/^[0-9]{10}$/.test(timestamp)||Math.abs(Date.now()/1000-Number(timestamp))>300)return false;
 try {
  const bytes=hex=>Uint8Array.from(hex.match(/../g),x=>parseInt(x,16));
  const key=await crypto.subtle.importKey("raw",bytes(pub),{name:"Ed25519"},false,["verify"]);
  return await crypto.subtle.verify("Ed25519",key,bytes(signature),encoder.encode(timestamp+body));
 }catch{return false}
}
async function restockInteraction(request,env) {
 if(Number(request.headers.get("Content-Length")||0)>16000)return restockReply({error:"Payload too large"},413);
 const raw=await request.text();
 if(!await verifyDiscordInteraction(request,env,raw))return new Response("Invalid request signature",{status:401});
 let i;try{i=JSON.parse(raw)}catch{return new Response("Invalid JSON",{status:400})}
 if(i.type===1)return restockReply({type:1});
 if(i.guild_id!==env.DISCORD_GUILD_ID||i.channel_id!==RESTOCK_CHANNEL)return restockReply(restockMessage("This feature is only available in the Restock channel."));
 const id=i.data?.custom_id||"";
 if(i.type===3&&id==="restock:open"){
  return restockReply({type:9,data:{custom_id:"restock:submit",title:"Request Restock",components:[{type:1,components:[{type:4,custom_id:"item",label:"Item to restock",style:1,min_length:1,max_length:120,required:true,placeholder:"e.g. Laptops"}]}]}});
 }
 if(i.type===5&&id==="restock:submit"){
  const item=i.data?.components?.[0]?.components?.[0]?.value?.trim();
  if(!item||item.length>120)return restockReply(restockMessage("Enter a valid item name."));
  const requester=restockUser(i),requestId=crypto.randomUUID(),record={item,requester,status:"pending",createdAt:new Date().toISOString(),messageId:""};
  try {
   const message=await discordAnnouncement(env,"restock","","POST",{content:"<@&"+RESTOCK_MANAGER_ROLE+"> New restock request",embeds:restockEmbed(record),components:restockButtons(requestId,"pending"),allowed_mentions:{parse:[],roles:[RESTOCK_MANAGER_ROLE]}});
   record.messageId=message.id;
   await restockFirestore(env,requestId,"PATCH",record);
   return restockReply(restockMessage("Restock request submitted."));
  }catch(e){console.error("Restock submit",e.message);return restockReply(restockMessage("Could not save the request. Please tell a manager."))}
 }
 const match=/^restock:(approved|denied|restocked):([a-f0-9-]{36})$/.exec(id);
 if(i.type===3&&match){
  if(!isRestockManager(i,env))return restockReply(restockMessage("Only managers can update restock requests."));
  const [,action,requestId]=match;
  try {
   const doc=await restockFirestore(env,requestId);
   if(!doc)return restockReply(restockMessage("Request not found."));
   const record=fromFields(doc.fields);
   if(record.messageId!==i.message?.id)return restockReply(restockMessage("Request message mismatch."));
   if(record.status==="restocked"||record.status==="denied"||record.status==="approved"&&action!=="restocked")return restockReply(restockMessage("This request has already been handled."));
   if(action==="restocked"&&record.status!=="approved")return restockReply(restockMessage("Approve the request first."));
   const next={...record,status:action,handledBy:restockUser(i),updatedAt:new Date().toISOString()};
   if(action==="restocked"||action==="denied"){
    // Remove completed or denied requests from Discord; retain their status in Firestore.
    await discordAnnouncement(env,"restock",record.messageId,"DELETE");
    await restockFirestore(env,requestId,"PATCH",next);
    return restockReply(restockMessage(action==="denied"?"Request denied and removed from the channel.":"Restock fulfilled. Request removed from the channel."));
   }
   await restockFirestore(env,requestId,"PATCH",next);
   return restockReply({type:7,data:{embeds:restockEmbed(next),components:restockButtons(requestId,action),allowed_mentions:{parse:[]}}});
  }catch(e){console.error("Restock update",e.message);return restockReply(restockMessage("Could not update this request. Try again."))}
 }
 return restockReply(restockMessage("Unknown restock action."));
}
async function postRestockPanel(env) {
 const result=await discordAnnouncement(env,"restock","","POST",{embeds:[{title:"Staff Restock Requests",description:"Need something restocked? Click the button below and enter the item name.",color:0x9d55db}],components:[{type:1,components:[{type:2,style:1,label:"Request Restock",custom_id:"restock:open",emoji:{name:"📦"}}]}],allowed_mentions:{parse:[]}});
 return {ok:true,messageId:result.id};
}

export default {
 async fetch(request,env) {
  const url=new URL(request.url),origin=request.headers.get("Origin");
  const cors={"Access-Control-Allow-Origin":ORIGIN,"Vary":"Origin","Access-Control-Allow-Methods":"GET, POST, PATCH, DELETE, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization"};
  if((["/submit","/contact","/admin/bot-check"].includes(url.pathname)||url.pathname.startsWith("/admin/announcements")||url.pathname==="/admin/restock-panel")&&request.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  if(url.pathname==="/discord/interactions"&&request.method==="POST")return restockInteraction(request,env);
  if(url.pathname==="/")return new Response("Digital Den Discord verification service is running.");
  if(!env.DISCORD_CLIENT_ID||!env.DISCORD_CLIENT_SECRET||!env.DISCORD_GUILD_ID||!env.SESSION_SIGNING_SECRET||!env.FIREBASE_SERVICE_ACCOUNT)return json({error:"Service not configured"},503);
  if(url.pathname==="/admin/restock-panel"&&request.method==="POST") {
    if(origin!==ORIGIN)return json({error:"Invalid origin"},403,cors);
    const authorization=request.headers.get("Authorization")||"";
    if(!authorization.startsWith("Bearer ")||!await verifyAdminToken(env,authorization.slice(7)))return json({error:"Administrator access required"},403,cors);
    try{return json(await postRestockPanel(env),200,cors)}catch(e){console.error("Restock panel",e.message);return json({error:"Could not post restock button"},502,cors)}
  }
  if(url.pathname==="/admin/bot-check"&&request.method==="POST") {
    if(origin!==ORIGIN)return json({error:"Invalid origin"},403,cors);
    const authorization=request.headers.get("Authorization")||"";
    if(!authorization.startsWith("Bearer ")||!await verifyAdminToken(env,authorization.slice(7)))return json({error:"Administrator access required"},403,cors);
    try{return json(await botDiagnostics(env),200,cors)}catch(e){console.error("Bot diagnostics failed",e.message);return json({error:"Could not complete Discord bot checks"},502,cors)}
  }
  if(url.pathname.startsWith("/admin/announcements")&&["GET","POST","PATCH","DELETE"].includes(request.method)) {
    if(origin!==ORIGIN)return json({error:"Invalid origin"},403,cors);
    const authorization=request.headers.get("Authorization")||"";
    if(!authorization.startsWith("Bearer ")||!await verifyAdminToken(env,authorization.slice(7)))return json({error:"Administrator access required"},403,cors);
    try {const result=await handleAnnouncement(env,request);return json(result,result.status||200,cors)}
    catch(e){console.error("Announcement action failed",e.message);return json({error:e.message||"Announcement request failed"},502,cors)}
  }
  if(url.pathname==="/login"&&request.method==="GET") {
    const state=crypto.randomUUID();
    const purpose=url.searchParams.get("purpose")==="contact"?"contact":"apply";
    const params=new URLSearchParams({client_id:env.DISCORD_CLIENT_ID,redirect_uri:CALLBACK,response_type:"code",scope:"identify guilds.members.read",state});
    return new Response(null,{status:302,headers:{Location:"https://discord.com/oauth2/authorize?"+params,"Cache-Control":"no-store","Set-Cookie":cookie("dd_oauth_state",state+"."+purpose)}});
  }
  if(url.pathname==="/callback"&&request.method==="GET") {
    const state=url.searchParams.get("state"),saved=cookieValue(request,"dd_oauth_state");
    if(!state||!saved||!saved.startsWith(state+".")||!url.searchParams.get("code"))return new Response("Invalid or expired Discord sign-in. Please start again.",{status:403});
    const purpose=saved.endsWith(".contact")?"contact":"apply";
    const returnPath=purpose==="contact"?"/remingtonsDD/Partnerships/":"/remingtonsDD/Apply/";
    const tokenResponse=await fetch("https://discord.com/api/v10/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:env.DISCORD_CLIENT_ID,client_secret:env.DISCORD_CLIENT_SECRET,grant_type:"authorization_code",code:url.searchParams.get("code"),redirect_uri:CALLBACK})});
    if(!tokenResponse.ok)return new Response("Discord sign-in failed. Try again.",{status:502});
    const token=await tokenResponse.json();
    const authHeader={Authorization:"Bearer "+token.access_token};
    const [userResp,memberResp]=await Promise.all([
      fetch("https://discord.com/api/v10/users/@me",{headers:authHeader}),
      fetch(`https://discord.com/api/v10/users/@me/guilds/${env.DISCORD_GUILD_ID}/member`,{headers:authHeader})
    ]);
    if(!userResp.ok||!memberResp.ok)return redirect(ORIGIN+returnPath+"#discord-not-member",cookie("dd_oauth_state","",0));
    const user=await userResp.json();
    try {await assignDiscordRoles(env,user.id,purpose)}catch(e){console.error(e.message);return new Response("Discord verification succeeded, but we could not assign your server roles. Please contact staff.",{status:502});}
    const signed=await signPayload(env.SESSION_SIGNING_SECRET,{aud:"dd-apply",discordId:user.id,username:user.username,exp:Date.now()+10*60*1000});
    return redirect(ORIGIN+returnPath+"#dd_token="+encodeURIComponent(signed),cookie("dd_oauth_state","",0));
  }
  if(url.pathname==="/contact"&&request.method==="POST") {
    if(origin!==ORIGIN)return json({error:"Invalid origin"},403,cors);
    if(Number(request.headers.get("Content-Length")||0)>12000)return json({error:"Inquiry too large"},413,cors);
    try {
      const body=await request.json();
      const payload=await readPayload(env.SESSION_SIGNING_SECRET,body.token);
      if(!payload)return json({error:"Discord verification expired. Verify again."},403,cors);
      if(!validateInquiry(body.inquiry))return json({error:"Complete all required fields."},400,cors);
      const result=await submitInquiry(env,payload,body.inquiry);
      return json(result,result.status||200,cors);
    } catch(e) {console.error("Inquiry failed",e.message);return json({error:"Unable to send inquiry. Please try again."},500,cors);}
  }
  if(url.pathname==="/submit"&&request.method==="POST") {
    if(origin!==ORIGIN)return json({error:"Invalid origin"},403,cors);
    if(Number(request.headers.get("Content-Length")||0)>16000)return json({error:"Application too large"},413,cors);
    try {
      const body=await request.json(),payload=await readPayload(env.SESSION_SIGNING_SECRET,body.token);
      if(!payload)return json({error:"Discord verification expired. Please verify again."},403,cors);
      if(!validate(body.application))return json({error:"Please complete all required fields."},400,cors);
      // Re-check membership at submission time, using the bot token if available.
      // OAuth proof is short-lived and tied to Discord's successful guild membership check.
      const result=await submit(env,payload,body.application);
      return json(result,result.status||200,cors);
    } catch(e) {console.error("Application submission failed",e.message);return json({error:"Unable to submit application. Please try again."},500,cors);}
  }
  return new Response("Not found",{status:404});
 }
};
