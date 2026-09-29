import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createServer, lobbies } from './index.ts';

function waitFor(ws:WebSocket,pred:(m:any)=>boolean,timeout=5000):Promise<any>{return new Promise((resolve,reject)=>{const t=setTimeout(()=>{ws.off('message',on);reject(new Error('timeout'))},timeout);function on(raw:any){const m=JSON.parse(String(raw));if(pred(m)){clearTimeout(t);ws.off('message',on);resolve(m)}}ws.on('message',on);});}
function client(port:number){return new WebSocket(`ws://127.0.0.1:${port}/ws`);}
async function connected(ws:WebSocket){if(ws.readyState===WebSocket.OPEN)return;await waitFor(ws,m=>m.type==='connected');}
async function join(ws:WebSocket,type:'create'|'join',token:string,extra:any){await connected(ws);const p=waitFor(ws,m=>m.type==='joined');ws.send(JSON.stringify({type,sessionToken:token,...extra}));return p;}
async function roomServer(){const s=createServer();await new Promise<void>(r=>s.server.listen(0,'127.0.0.1',()=>r()));return {s,port:(s.server.address() as any).port};}
async function closeAll(s:any,clients:WebSocket[]){for(const c of clients)if(c.readyState<2)c.close();await s.close();}
function uniqueCode(i:number){return `T${String(i).padStart(3,'0')}`;}

test('run flow: win returns to lobby, failure ends run, play again resets',async t=>{
  const {s,port}=await roomServer();const clients=[client(port),client(port),client(port)];t.after(()=>closeAll(s,clients));
  const a=await join(clients[0],'create','flow-a',{nickname:'A'});const room=a.roomCode;await join(clients[1],'join','flow-b',{roomCode:room,nickname:'B'});
  let rps=clients.slice(0,2).map(c=>waitFor(c,m=>m.type==='round'));clients[0].send(JSON.stringify({type:'start',sessionToken:'flow-a'}));let rs=await Promise.all(rps);
  let lobby=lobbies.get(room)!;const kp=rs.findIndex(x=>x.role==='keypad');const secret=lobby.puzzle!.secret;const token=kp===0?'flow-a':'flow-b';
  const win=waitFor(clients[kp],m=>m.type==='roundResult'&&m.won);clients[kp].send(JSON.stringify({type:'submit',sessionToken:token,code:secret}));const wr=await win;
  assert.equal(wr.won,true);assert.equal(lobbies.get(room)!.phase,'lobby');assert.equal(lobbies.get(room)!.vaultsCracked,1);assert.equal(lobbies.get(room)!.runEnded,false);
  await join(clients[2],'join','flow-c',{roomCode:room,nickname:'C'});
  const nextResults=clients.map(c=>waitFor(c,m=>m.type==='round'));clients[0].send(JSON.stringify({type:'nextRound',sessionToken:'flow-a'}));const next=await Promise.all(nextResults);assert.equal(lobbies.get(room)!.round,2);
  lobby=lobbies.get(room)!;
  // Force the second round to fail through three valid-length wrong submissions.
  const kpId=lobby.keypadPlayerId!;const idx=next.findIndex(x=>x.role==='keypad');assert.notEqual(idx,-1);const keyToken=['flow-a','flow-b','flow-c'][idx];
  for(let i=0;i<3;i++){
    const p=waitFor(clients[idx],m=>m.type==='attempt'||m.type==='roundResult');clients[idx].send(JSON.stringify({type:'submit',sessionToken:keyToken,code:lobby.puzzle!.secret==='0000'?'9999':'0000'}));await p;
  }
  assert.equal(lobby.runEnded,true);assert.equal(lobby.phase,'lobby');
  const again=waitFor(clients[0],m=>m.type==='lobby'&&m.runEnded===false);clients[0].send(JSON.stringify({type:'playAgain',sessionToken:'flow-a'}));await again;
  assert.equal(lobbies.get(room)!.round,0);assert.equal(lobbies.get(room)!.score,0);assert.equal(lobbies.get(room)!.vaultsCracked,0);assert.equal(lobbies.get(room)!.runEnded,false);
});

test('invalid-length submission does not consume an attempt and keypad shows puzzle digit count',async t=>{const {s,port}=await roomServer();const clients=[client(port),client(port)];t.after(()=>closeAll(s,clients));const a=await join(clients[0],'create','len-a',{nickname:'A'});const room=a.roomCode;await join(clients[1],'join','len-b',{roomCode:room,nickname:'B'});const rps=clients.map(c=>waitFor(c,m=>m.type==='round'));clients[0].send(JSON.stringify({type:'start',sessionToken:'len-a'}));const rs=await Promise.all(rps);const kp=rs.findIndex(x=>x.role==='keypad');const keyToken=kp===0?'len-a':'len-b';const before=lobbies.get(room)!.attempts;const err=waitFor(clients[kp],m=>m.type==='error');clients[kp].send(JSON.stringify({type:'submit',sessionToken:keyToken,code:'1'}));const e=await err;assert.equal(e.attemptUsed,false);assert.equal(lobbies.get(room)!.attempts,before);assert.equal(rs[kp].digits,4);});

test('attempts are broadcast and final code is revealed',async t=>{const {s,port}=await roomServer();const clients=[client(port),client(port)];t.after(()=>closeAll(s,clients));const a=await join(clients[0],'create','att-a',{nickname:'Alex'});const room=a.roomCode;await join(clients[1],'join','att-b',{roomCode:room,nickname:'Bee'});const rps=clients.map(c=>waitFor(c,m=>m.type==='round'));clients[0].send(JSON.stringify({type:'start',sessionToken:'att-a'}));const rs=await Promise.all(rps);const kp=rs.findIndex(x=>x.role==='keypad');const token=kp===0?'att-a':'att-b';const wrong='0000';const ap=clients.map(c=>waitFor(c,m=>m.type==='attempt'));clients[kp].send(JSON.stringify({type:'submit',sessionToken:token,code:wrong}));const attempts=await Promise.all(ap);const expectedName=kp===0?'Alex':'Bee';assert.ok(attempts.every(m=>m.code===wrong&&m.nickname===expectedName&&m.correct===false));});

test('join-link only prefills on client, server rejects new joins during a run and unique room is used',async t=>{const {s,port}=await roomServer();const clients=[client(port),client(port),client(port)];t.after(()=>closeAll(s,clients));const a=await join(clients[0],'create','link-a',{nickname:'A'});const room=a.roomCode;await join(clients[1],'join','link-b',{roomCode:room,nickname:'B'});const rps=clients.slice(0,2).map(c=>waitFor(c,m=>m.type==='round'));clients[0].send(JSON.stringify({type:'start',sessionToken:'link-a'}));await Promise.all(rps);const newcomer=waitFor(clients[2],m=>m.type==='error');await connected(clients[2]);clients[2].send(JSON.stringify({type:'join',sessionToken:'link-c',roomCode:room,nickname:'C'}));const e=await newcomer;assert.match(e.message,/in progress|lobby/i);assert.ok(lobbies.has(room));});
