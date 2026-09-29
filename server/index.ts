import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { assignClues, generatePuzzle, publicPuzzlePayload, type Clue, type Puzzle } from './engine.ts';

interface Player { id:string; sessionToken:string; nickname:string; connected:boolean; disconnectedAt?:number; }
interface Lobby {
  code:string; hostId:string; players:Player[]; sockets:Map<string,WebSocket>;
  phase:'lobby'|'round'; runEnded:boolean; round:number; score:number; vaultsCracked:number;
  puzzle?:Puzzle; keypadPlayerId?:string; assignments:Record<string,Clue[]>; attempts:number;
  deadline?:number; chat:Array<{id:string;nickname:string;text:string}>;
  redistributionTimers:Map<string,NodeJS.Timeout>;
}

export const lobbies = new Map<string,Lobby>();
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DISCONNECT_RETENTION_MS=5*60*1000;
const REDISTRIBUTE_MS=15*1000;
const HEARTBEAT_MS=20*1000;

function makeCode(){for(let n=0;n<1000;n++){let c='';for(let i=0;i<4;i++)c+=alphabet[Math.floor(Math.random()*alphabet.length)];if(!lobbies.has(c))return c;}throw new Error('room space exhausted');}
function send(ws:WebSocket|undefined,payload:unknown){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(payload));}
function connectedPlayers(l:Lobby){return l.players.filter(p=>p.connected);}
function publicLobby(l:Lobby){return {type:'lobby',roomCode:l.code,hostId:l.hostId,phase:l.phase,runEnded:l.runEnded,round:l.round,score:l.score,vaultsCracked:l.vaultsCracked,players:l.players.map(({id,nickname,connected})=>({id,nickname,connected}))};}
function broadcast(l:Lobby){for(const ws of l.sockets.values())send(ws,publicLobby(l));}
function clearTimers(l:Lobby){for(const t of l.redistributionTimers.values())clearTimeout(t);l.redistributionTimers.clear();}
function cleanupLobby(l:Lobby){const now=Date.now();l.players=l.players.filter(p=>p.connected||!p.disconnectedAt||now-p.disconnectedAt<DISCONNECT_RETENTION_MS);for(const id of [...l.sockets.keys()])if(!l.players.some(p=>p.id===id))l.sockets.delete(id);if(!l.players.length){clearTimers(l);lobbies.delete(l.code);return false;}if(!l.players.some(p=>p.id===l.hostId&&p.connected)){const next=l.players.find(p=>p.connected);if(next)l.hostId=next.id;}broadcast(l);return true;}
function findPlayer(l:Lobby,id:string){return l.players.find(p=>p.id===id);}
function sendRoundTo(l:Lobby,id:string){const p=findPlayer(l,id);if(!p||!p.connected||!l.puzzle||l.phase!=='round')return;const clues=l.assignments[id]||[];send(l.sockets.get(id),{type:'round',...publicPuzzlePayload(l.puzzle,clues,l.keypadPlayerId===id),keypadPlayerId:l.keypadPlayerId,players:l.players.map(({id,nickname,connected})=>({id,nickname,connected})),attemptsRemaining:3-l.attempts,remainingMs:l.deadline?Math.max(0,l.deadline-Date.now()):0});}
function broadcastRound(l:Lobby){for(const p of connectedPlayers(l))sendRoundTo(l,p.id);}
function chooseKeypad(l:Lobby){const ps=connectedPlayers(l);if(ps.length)l.keypadPlayerId=ps[Math.floor(Math.random()*ps.length)].id;}
function buildAssignments(l:Lobby){if(!l.puzzle||!l.keypadPlayerId)throw new Error('round not initialized');l.assignments=assignClues(l.puzzle,connectedPlayers(l).map(p=>p.id),l.keypadPlayerId);}
function broadcastChat(l:Lobby){for(const ws of l.sockets.values())send(ws,{type:'chat',messages:l.chat});}
function resetForNextRound(l:Lobby){l.phase='lobby';l.runEnded=false;l.puzzle=undefined;l.keypadPlayerId=undefined;l.assignments={};l.attempts=0;l.deadline=undefined;l.chat=[];clearTimers(l);broadcast(l);broadcastChat(l);}
function startRound(l:Lobby){const ps=connectedPlayers(l);if(ps.length<2)return send(l.sockets.get(l.hostId),{type:'error',message:'At least 2 connected players are required.'});l.round++;l.phase='round';l.puzzle=generatePuzzle(Math.min(5,Math.max(1,Math.ceil(l.round/2))) as 1|2|3|4|5);l.attempts=0;l.chat=[];chooseKeypad(l);buildAssignments(l);l.deadline=Date.now()+l.puzzle.seconds*1000;broadcastRound(l);broadcastChat(l);broadcast(l);}
function endRound(l:Lobby,won:boolean){
  if(l.phase!=='round'||!l.puzzle)return;
  const secret=l.puzzle.secret;
  const roundNumber=l.round;
  if(won){l.vaultsCracked++;l.score+=100*roundNumber;l.runEnded=false;}else{l.runEnded=true;}
  const result={type:'roundResult',won,score:l.score,round:roundNumber,vaultsCracked:l.vaultsCracked,secret,hostId:l.hostId};
  l.phase='lobby';l.deadline=undefined;
  for(const p of connectedPlayers(l))send(l.sockets.get(p.id),result);
  l.puzzle=undefined;l.keypadPlayerId=undefined;l.assignments={};l.attempts=0;l.chat=[];clearTimers(l);
  broadcast(l);broadcastChat(l);
}
function redistribute(l:Lobby,disconnectedId:string){if(l.phase!=='round'||!l.puzzle)return;const lost=l.assignments[disconnectedId]||[];delete l.assignments[disconnectedId];const ps=connectedPlayers(l);if(ps.length<2){if(l.hostId===disconnectedId&&ps[0])l.hostId=ps[0].id;return;}if(l.keypadPlayerId===disconnectedId)chooseKeypad(l);for(const clue of lost){const targets=ps.filter(p=>p.id!==l.keypadPlayerId).sort((a,b)=>(l.assignments[a.id]?.length||0)-(l.assignments[b.id]?.length||0));const target=targets[0]||ps[0];(l.assignments[target.id]??=[]).push(clue);}for(const p of ps)if(!(l.assignments[p.id]?.length)){
  const donor=ps.filter(x=>x.id!==p.id&&x.id!==l.keypadPlayerId&&(l.assignments[x.id]?.length||0)>1).sort((a,b)=>l.assignments[b.id].length-l.assignments[a.id].length)[0];
  if(donor)l.assignments[p.id].push(l.assignments[donor.id].pop()!);
}
broadcastRound(l);broadcast(l);}
function markDisconnected(l:Lobby,id:string,ws:WebSocket){const current=l.sockets.get(id);if(current!==ws)return;l.sockets.delete(id);const p=findPlayer(l,id);if(!p)return;p.connected=false;p.disconnectedAt=Date.now();if(l.phase==='round'&&!l.redistributionTimers.has(id)){const t=setTimeout(()=>{l.redistributionTimers.delete(id);redistribute(l,id);},REDISTRIBUTE_MS);l.redistributionTimers.set(id,t);}cleanupLobby(l);}

export function createServer(){
 const app=express();const server=http.createServer(app);const wss=new WebSocketServer({server,path:'/ws'});const clientDir=path.join(path.dirname(fileURLToPath(import.meta.url)),'../client');
 app.use(express.static(clientDir));app.get('/health',(_req,res)=>res.json({ok:true,service:'vault-crew'}));app.get('/{*splat}',(_req,res)=>res.sendFile(path.join(clientDir,'index.html')));
 const heartbeat=setInterval(()=>{for(const ws of wss.clients){const sock=ws as WebSocket & {isAlive?:boolean};if(sock.isAlive===false){sock.terminate();continue;}sock.isAlive=false;sock.ping();}},HEARTBEAT_MS);heartbeat.unref();
 const cleanup=setInterval(()=>{for(const l of [...lobbies.values()])cleanupLobby(l);},30_000);cleanup.unref();
 const ticker=setInterval(()=>{for(const l of lobbies.values()){if(l.phase!=='round'||l.deadline===undefined)continue;const remainingMs=Math.max(0,l.deadline-Date.now());for(const p of connectedPlayers(l))send(l.sockets.get(p.id),{type:'timer',remainingMs,attemptsRemaining:3-l.attempts});if(remainingMs===0)endRound(l,false);}},250);ticker.unref();
 wss.on('connection',ws=>{
   const sock=ws as WebSocket & {isAlive?:boolean};sock.isAlive=true;ws.on('pong',()=>{sock.isAlive=true;});
   let lobby:Lobby|undefined;let playerId='';send(ws,{type:'connected'});
   ws.on('message',raw=>{try{const m=JSON.parse(String(raw));const token=String(m.sessionToken||'').trim();
     if(m.type==='create'){const nickname=String(m.nickname||'Player').trim().slice(0,20)||'Player';const sessionToken=token||crypto.randomUUID();const id=crypto.randomUUID();const code=makeCode();lobby={code,hostId:id,players:[{id,sessionToken,nickname,connected:true}],sockets:new Map([[id,ws]]),phase:'lobby',runEnded:false,round:0,score:0,vaultsCracked:0,assignments:{},attempts:0,chat:[],redistributionTimers:new Map()};playerId=id;lobbies.set(code,lobby);send(ws,{type:'joined',playerId:id,sessionToken,roomCode:code});broadcast(lobby);return;}
     if(m.type==='join'){const code=String(m.roomCode||'').toUpperCase();lobby=lobbies.get(code);if(!lobby){send(ws,{type:'error',message:'Room not found'});return;}cleanupLobby(lobby);if(!lobbies.has(code)){send(ws,{type:'error',message:'Room expired'});return;}const nickname=String(m.nickname||'Player').trim().slice(0,20)||'Player';let existing=token?lobby.players.find(p=>p.sessionToken===token):undefined;
       if(existing){const old=lobby.sockets.get(existing.id);if(old&&old!==ws)old.close(4001,'Replaced by reconnecting session');existing.connected=true;delete existing.disconnectedAt;existing.nickname=nickname||existing.nickname;playerId=existing.id;lobby.sockets.set(playerId,ws);if(lobby.redistributionTimers.has(playerId)){clearTimeout(lobby.redistributionTimers.get(playerId)!);lobby.redistributionTimers.delete(playerId);}send(ws,{type:'joined',playerId,sessionToken:existing.sessionToken,roomCode:code,reconnected:true});broadcast(lobby);if(lobby.phase==='round')sendRoundTo(lobby,playerId);broadcastChat(lobby);return;}
       if(lobby.phase!=='lobby'){send(ws,{type:'error',message:'This run is already in progress. Join the lobby for the next round.'});return;}if(connectedPlayers(lobby).length>=8){send(ws,{type:'error',message:'Room is full'});return;}const sessionToken=token||crypto.randomUUID();playerId=crypto.randomUUID();lobby.players.push({id:playerId,sessionToken,nickname,connected:true});lobby.sockets.set(playerId,ws);send(ws,{type:'joined',playerId,sessionToken,roomCode:code});broadcast(lobby);return;}
     if(!lobby||!playerId)return;
     if(m.type==='start'||m.type==='nextRound'){if(lobby.runEnded){send(ws,{type:'error',message:'The run has ended. Use Play again to start a new run.'});return;}if(playerId!==lobby.hostId){send(ws,{type:'error',message:'Only the host can start the next vault.'});return;}if(lobby.phase!=='lobby'){send(ws,{type:'error',message:'The room is not ready for the next vault.'});return;}startRound(lobby);return;}
     if(m.type==='playAgain'){if(playerId!==lobby.hostId){send(ws,{type:'error',message:'Only the host can play again.'});return;}if(!lobby.runEnded){send(ws,{type:'error',message:'The run has not ended.'});return;}lobby.round=0;lobby.score=0;lobby.vaultsCracked=0;lobby.runEnded=false;lobby.phase='lobby';lobby.puzzle=undefined;lobby.assignments={};lobby.attempts=0;lobby.deadline=undefined;lobby.keypadPlayerId=undefined;lobby.chat=[];broadcast(lobby);broadcastChat(lobby);return;}
     if(m.type==='chat'){const text=String(m.text||'').trim().slice(0,300);if(!text||lobby.phase!=='round')return;const p=findPlayer(lobby,playerId);if(!p)return;lobby.chat.push({id:crypto.randomUUID(),nickname:p.nickname,text});if(lobby.chat.length>100)lobby.chat.shift();broadcastChat(lobby);return;}
     if(m.type==='submit'){if(lobby.phase!=='round'||!lobby.puzzle){send(ws,{type:'error',message:'No active round.'});return;}if(lobby.keypadPlayerId!==playerId){send(ws,{type:'error',message:'Only the keypad player can submit a code.'});return;}if(lobby.deadline===undefined||Date.now()>=lobby.deadline){send(ws,{type:'error',message:'Time has expired.'});endRound(lobby,false);return;}if(lobby.attempts>=3){send(ws,{type:'error',message:'No attempts remaining.'});return;}const code=String(m.code||'');if(code.length!==lobby.puzzle.digits||!/^\d+$/.test(code)){send(ws,{type:'error',message:`Enter exactly ${lobby.puzzle.digits} digits.`,attemptUsed:false});return;}lobby.attempts++;const correct=code===lobby.puzzle.secret;const p=findPlayer(lobby,playerId)!;for(const q of connectedPlayers(lobby))send(lobby.sockets.get(q.id),{type:'attempt',nickname:p.nickname,code,correct,attemptsRemaining:3-lobby.attempts});if(correct)endRound(lobby,true);else if(lobby.attempts>=3)endRound(lobby,false);return;}
   }catch{send(ws,{type:'error',message:'Invalid message'});}});
   ws.on('close',()=>{if(lobby&&playerId)markDisconnected(lobby,playerId,ws);});
 });
 return {app,server,wss,close:async()=>{clearInterval(heartbeat);clearInterval(cleanup);clearInterval(ticker);clearTimersForAll();for(const ws of wss.clients)ws.close();await new Promise<void>(resolve=>wss.close(()=>resolve()));if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
function clearTimersForAll(){for(const l of lobbies.values())clearTimers(l);}
