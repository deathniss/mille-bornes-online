const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.static(path.join(__dirname, '..', 'client')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const MAX_PLAYERS = 8;
const rooms = new Map();
const clientRooms = new Map();

function randomId() {
  return crypto.randomBytes(4).toString('hex');
}

function roomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function createDeck() {
  const d = [];
  for (let i = 0; i < 4; i++) d.push({ t: 'dist', v: 25 });
  for (let i = 0; i < 4; i++) d.push({ t: 'dist', v: 50 });
  for (let i = 0; i < 4; i++) d.push({ t: 'dist', v: 75 });
  for (let i = 0; i < 4; i++) d.push({ t: 'dist', v: 100 });
  for (let i = 0; i < 4; i++) d.push({ t: 'dist', v: 200 });
  for (let i = 0; i < 3; i++) d.push({ t: 'haz', s: 'accident' });
  for (let i = 0; i < 3; i++) d.push({ t: 'haz', s: 'flat_tire' });
  for (let i = 0; i < 3; i++) d.push({ t: 'haz', s: 'out_of_gas' });
  for (let i = 0; i < 4; i++) d.push({ t: 'haz', s: 'speed_limit' });
  for (let i = 0; i < 5; i++) d.push({ t: 'haz', s: 'stop' });
  for (let i = 0; i < 6; i++) d.push({ t: 'rem', s: 'repair' });
  for (let i = 0; i < 6; i++) d.push({ t: 'rem', s: 'go' });
  for (let i = 0; i < 6; i++) d.push({ t: 'rem', s: 'spare_tire' });
  for (let i = 0; i < 6; i++) d.push({ t: 'rem', s: 'gasoline' });
  for (let i = 0; i < 6; i++) d.push({ t: 'rem', s: 'end_speed' });
  d.push({ t: 'safe', s: 'driving_ace' });
  d.push({ t: 'safe', s: 'puncture_proof' });
  d.push({ t: 'safe', s: 'fuel_tank' });
  d.push({ t: 'safe', s: 'emergency_vehicle' });
  return shuffle(d);
}

function cardName(c) {
  const names = {
    dist: c.v + ' km',
    haz: { accident: 'Accident', flat_tire: 'Crevaison', out_of_gas: "Panne d'essence", speed_limit: 'Limitation', stop: 'Feu Rouge' }[c.s],
    rem: { repair: 'Réparation', spare_tire: 'Roue de secours', gasoline: 'Essence', end_speed: 'Fin limitation', go: 'Feu Vert' }[c.s],
    safe: { driving_ace: 'As du volant', puncture_proof: 'Increvable', fuel_tank: 'Réservoir', emergency_vehicle: 'Véhicule prioritaire' }[c.s]
  };
  return names[c.t] || '?';
}

function cardIcon(c) {
  const icons = {
    dist: { 25: '🛣️', 50: '🛣️', 75: '🛣️', 100: '🛣️', 200: '🛣️' }[c.v],
    haz: { accident: '💥', flat_tire: '🔧', out_of_gas: '⛽', speed_limit: '🚦', stop: '🔴' }[c.s],
    rem: { repair: '🔩', spare_tire: '🛞', gasoline: '⛽', end_speed: '✅', go: '🟢' }[c.s],
    safe: { driving_ace: '🏆', puncture_proof: '🛡️', fuel_tank: '🛢️', emergency_vehicle: '🚨' }[c.s]
  };
  return icons[c.t] || '🃏';
}

function createGame(room) {
  const deck = createDeck();
  const p = room.players;
  for (const pl of p) {
    pl.hand = [];
    pl.distance = 0;
    pl.battlePile = 'stop';
    pl.speedPile = null;
    pl.safeties = [];
    pl.hasDrawn = false;
  }
  for (let i = 0; i < 5; i++) {
    for (const pl of p) {
      if (deck.length > 0) pl.hand.push(deck.pop());
    }
  }
  room.deck = deck;
  room.discard = [];
  room.currentPlayer = 0;
  room.phase = 'playing';
  room.winner = null;
  room.turnCount = 0;
  return room;
}

function hazardMatch(hazard, safety) {
  return (
    (hazard === 'accident' && safety === 'driving_ace') ||
    (hazard === 'flat_tire' && safety === 'puncture_proof') ||
    (hazard === 'out_of_gas' && safety === 'fuel_tank') ||
    (hazard === 'speed_limit' && safety === 'emergency_vehicle') ||
    (hazard === 'stop' && safety === 'emergency_vehicle')
  );
}

function remedyFor(hazard) {
  return {
    accident: 'repair',
    flat_tire: 'spare_tire',
    out_of_gas: 'gasoline',
    speed_limit: 'end_speed',
    stop: 'go'
  }[hazard];
}

function canPlayCard(player, card, room, target) {
  if (card.t === 'dist') {
    if (player.battlePile) return 'Bloqué par un incident !';
    if (player.speedPile && card.v > 50) return 'Limité à 50 km/h !';
    if (player.distance + card.v > 1000) return 'Dépasserait 1000 km !';
    return null;
  }
  if (card.t === 'haz') {
    if (player.battlePile) return 'Tu es bloqué, joue d\'abord une défense ou Feu Vert !';
    if (!target || target.id === player.id) return 'Cible invalide';
    if (card.s === 'speed_limit' && target.speedPile) return 'Déjà limité';
    if (target.safeties.some(s => hazardMatch(card.s, s))) return 'Protégé par une botte';
    return null;
  }
  if (card.t === 'rem') {
    const expectedHazard = card.s === 'end_speed' ? 'speed_limit' : card.s === 'go' ? 'stop' : card.s;
    if (expectedHazard === 'speed_limit') {
      if (!player.speedPile) return 'Pas de limitation active';
    } else {
      if (player.battlePile !== expectedHazard) return 'Pas de panne correspondante';
    }
    return null;
  }
  if (card.t === 'safe') {
    if (player.safeties.includes(card.s)) return 'Botte déjà en jeu';
    return null;
  }
  return 'Carte invalide';
}

function playCardInGame(room, playerId, cardIndex, targetId) {
  const player = room.players.find(p => p.id === playerId);
  if (!player) return { error: 'Joueur inconnu' };
  if (room.players[room.currentPlayer].id !== playerId) return { error: "Ce n'est pas ton tour" };

  const card = player.hand[cardIndex];
  if (!card) return { error: 'Carte invalide' };

  const target = targetId ? room.players.find(p => p.id === targetId) : null;
  const err = canPlayCard(player, card, room, target);
  if (err) return { error: err };

  player.hand.splice(cardIndex, 1);
  room.discard.push(card);

  if (card.t === 'dist') {
    player.distance += card.v;
    room.lastMove = { player: player.name, action: `avance de ${card.v} km` };
  } else if (card.t === 'haz') {
    if (card.s === 'speed_limit') {
      target.speedPile = 'speed_limit';
    } else {
      target.battlePile = card.s;
    }
    room.lastMove = { player: player.name, action: `${cardName(card)} sur ${target.name}` };
    target.lastAttacked = { by: playerId, hazard: card.s };
  } else if (card.t === 'rem') {
    if (card.s === 'end_speed') {
      player.speedPile = null;
    } else {
      player.battlePile = null;
    }
    room.lastMove = { player: player.name, action: `${cardName(card)}` };
  } else if (card.t === 'safe') {
    player.safeties.push(card.s);
    if (card.s === 'emergency_vehicle') { player.speedPile = null; if (player.battlePile === 'stop') player.battlePile = null; }
    else if (hazardMatch(card.s === 'driving_ace' ? 'accident' : card.s === 'puncture_proof' ? 'flat_tire' : 'out_of_gas', card.s)) {
      const hazardMap = { driving_ace: 'accident', puncture_proof: 'flat_tire', fuel_tank: 'out_of_gas' };
      if (player.battlePile === hazardMap[card.s]) player.battlePile = null;
    }
    room.lastMove = { player: player.name, action: `joue la botte ${cardName(card)} !` };
    // Safety gives extra turn - don't advance
    return { extraTurn: true };
  }

  // Check win
  if (player.distance >= 1000) {
    room.winner = player.id;
    room.phase = 'finished';
    return { winner: player.id };
  }

  // Check deck empty
  if (room.deck.length === 0 && room.players.every(p => p.hand.length === 0)) {
    const winner = [...room.players].sort((a, b) => b.distance - a.distance)[0];
    room.winner = winner.id;
    room.phase = 'finished';
    return { winner: winner.id, deckEmpty: true };
  }

  // Advance to next turn (auto-draw included)
  advanceTurn(room);
  return { success: true };
}

function drawForPlayer(room, playerId) {
  const player = room.players.find(p => p.id === playerId);
  if (!player) return { error: 'Joueur inconnu' };
  if (room.players[room.currentPlayer].id !== playerId) return { error: "Ce n'est pas ton tour" };
  if (player.hasDrawn) return { error: 'Déjà pioché' };

  if (room.deck.length > 0) {
    player.hand.push(room.deck.pop());
  }
  player.hasDrawn = true;
  return { success: true };
}

function advanceTurn(room) {
  do {
    room.currentPlayer = (room.currentPlayer + 1) % room.players.length;
  } while (!room.players[room.currentPlayer].isConnected && room.players.length > 1);
  room.turnCount++;
  for (const p of room.players) p.hasDrawn = false;
  // Auto-draw for the next player
  const next = room.players[room.currentPlayer];
  if (room.deck.length > 0) next.hand.push(room.deck.pop());
  next.hasDrawn = true;
}

function broadcast(room, msg) {
  for (const p of room.players) {
    if (p.ws && p.ws.readyState === 1) {
      p.ws.send(JSON.stringify(msg));
    }
  }
}

function playerState(room, forPlayerId) {
  return {
    phase: room.phase,
    currentPlayer: room.currentPlayer,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      distance: p.distance,
      battlePile: p.battlePile,
      speedPile: p.speedPile,
      safeties: p.safeties,
      handSize: p.hand.length,
      isConnected: p.isConnected,
      hasDrawn: p.hasDrawn,
      hand: p.id === forPlayerId ? p.hand : undefined
    })),
    deckCount: room.deck.length,
    lastMove: room.lastMove,
    winner: room.winner,
    turnCount: room.turnCount
  };
}

wss.on('connection', (ws) => {
  let playerId = randomId();
  let currentRoom = null;
  clientRooms.set(ws, null);

  ws.send(JSON.stringify({ type: 'connected', playerId }));

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    if (msg.type === 'create_room') {
      if (currentRoom) return ws.send(JSON.stringify({ type: 'error', message: 'Déjà dans un salon' }));
      const code = roomCode();
      while (rooms.has(code)) { code = roomCode(); }
      const player = {
        id: playerId,
        name: msg.playerName || 'Joueur',
        ws,
        isHost: true,
        isConnected: true
      };
      const room = {
        code,
        players: [player],
        phase: 'waiting',
        hostId: playerId
      };
      rooms.set(code, room);
      currentRoom = code;
      clientRooms.set(ws, code);
      ws.send(JSON.stringify({ type: 'room_created', roomId: code, players: room.players.map(p => ({ id: p.id, name: p.name, isHost: p.isHost })) }));
      return;
    }

    if (msg.type === 'join_room') {
      if (currentRoom) return ws.send(JSON.stringify({ type: 'error', message: 'Déjà dans un salon' }));
      const room = rooms.get(msg.roomId);
      if (!room) return ws.send(JSON.stringify({ type: 'error', message: 'Salon introuvable' }));
      if (room.phase !== 'waiting') return ws.send(JSON.stringify({ type: 'error', message: 'Partie déjà commencée' }));
      if (room.players.length >= MAX_PLAYERS) return ws.send(JSON.stringify({ type: 'error', message: `Salon plein (max ${MAX_PLAYERS})` }));
      const player = {
        id: playerId,
        name: msg.playerName || 'Joueur',
        ws,
        isHost: false,
        isConnected: true
      };
      room.players.push(player);
      currentRoom = room.code;
      clientRooms.set(ws, room.code);
      broadcast(room, { type: 'player_joined', players: room.players.map(p => ({ id: p.id, name: p.name, isHost: p.isHost })) });
      ws.send(JSON.stringify({ type: 'room_joined', roomId: room.code, players: room.players.map(p => ({ id: p.id, name: p.name, isHost: p.isHost })) }));
      return;
    }

    if (msg.type === 'start_game') {
      const code = clientRooms.get(ws);
      if (!code) return;
      const room = rooms.get(code);
      if (!room) return;
      if (room.hostId !== playerId) return ws.send(JSON.stringify({ type: 'error', message: 'Seul l\'hôte peut lancer' }));
      if (room.players.length < 2) return ws.send(JSON.stringify({ type: 'error', message: 'Minimum 2 joueurs' }));
      createGame(room);
      // Auto-draw for first player
      if (room.deck.length > 0) room.players[room.currentPlayer].hand.push(room.deck.pop());
      room.players[room.currentPlayer].hasDrawn = true;
      for (const p of room.players) {
        if (p.ws && p.ws.readyState === 1) {
          p.ws.send(JSON.stringify({ type: 'game_start', state: playerState(room, p.id), yourTurn: room.players[room.currentPlayer].id === p.id }));
        }
      }
      return;
    }

    if (msg.type === 'draw_card') {
      const code = clientRooms.get(ws);
      if (!code) return;
      const room = rooms.get(code);
      if (!room || room.phase !== 'playing') return;
      const result = drawForPlayer(room, playerId);
      if (result.error) return ws.send(JSON.stringify({ type: 'error', message: result.error }));
      for (const p of room.players) {
        if (p.ws && p.ws.readyState === 1) {
          p.ws.send(JSON.stringify({ type: 'game_update', state: playerState(room, p.id), yourTurn: room.players[room.currentPlayer].id === p.id }));
        }
      }
      return;
    }

    if (msg.type === 'play_card') {
      const code = clientRooms.get(ws);
      if (!code) return;
      const room = rooms.get(code);
      if (!room || room.phase !== 'playing') return;
      const player = room.players.find(p => p.id === playerId);
      if (!player || !player.hasDrawn) return ws.send(JSON.stringify({ type: 'error', message: 'Tu dois d\'abord piocher' }));
      const result = playCardInGame(room, playerId, msg.cardIndex, msg.targetId);
      if (result.error) return ws.send(JSON.stringify({ type: 'error', message: result.error }));
      if (result.winner) {
        for (const p of room.players) {
          if (p.ws && p.ws.readyState === 1) {
            p.ws.send(JSON.stringify({ type: 'game_over', state: playerState(room, p.id), winner: result.winner }));
          }
        }
        return;
      }
      if (result.extraTurn) {
        const cur = room.players[room.currentPlayer];
        // Extra turn: keep turn, auto-draw again
        if (room.deck.length > 0) cur.hand.push(room.deck.pop());
        cur.hasDrawn = true;
      }
      for (const p of room.players) {
        if (p.ws && p.ws.readyState === 1) {
          p.ws.send(JSON.stringify({ type: 'game_update', state: playerState(room, p.id), yourTurn: room.players[room.currentPlayer].id === p.id }));
        }
      }
      return;
    }

    if (msg.type === 'discard_card') {
      const code = clientRooms.get(ws);
      if (!code) return;
      const room = rooms.get(code);
      if (!room || room.phase !== 'playing') return;
      const player = room.players.find(p => p.id === playerId);
      if (!player || !player.hasDrawn) return ws.send(JSON.stringify({ type: 'error', message: 'Tu dois d\'abord piocher' }));
      if (room.players[room.currentPlayer].id !== playerId) return ws.send(JSON.stringify({ type: 'error', message: "Ce n'est pas ton tour" }));
      const cardIndex = msg.cardIndex;
      if (cardIndex === undefined || cardIndex < 0 || cardIndex >= player.hand.length) return ws.send(JSON.stringify({ type: 'error', message: 'Carte invalide' }));
      const card = player.hand.splice(cardIndex, 1)[0];
      room.discard.push(card);
      room.lastMove = { player: player.name, action: `défausse ${cardName(card)}` };
      advanceTurn(room);
      for (const p of room.players) {
        if (p.ws && p.ws.readyState === 1) {
          p.ws.send(JSON.stringify({ type: 'game_update', state: playerState(room, p.id), yourTurn: room.players[room.currentPlayer].id === p.id }));
        }
      }
      return;
    }

    if (msg.type === 'end_turn') {
      const code = clientRooms.get(ws);
      if (!code) return;
      const room = rooms.get(code);
      if (!room || room.phase !== 'playing') return;
      if (room.players[room.currentPlayer].id !== playerId) return;
      room.lastMove = null;
      advanceTurn(room);
      for (const p of room.players) {
        if (p.ws && p.ws.readyState === 1) {
          p.ws.send(JSON.stringify({ type: 'game_update', state: playerState(room, p.id), yourTurn: room.players[room.currentPlayer].id === p.id }));
        }
      }
      return;
    }

    if (msg.type === 'chat') {
      const code = clientRooms.get(ws);
      if (!code) return;
      const room = rooms.get(code);
      if (!room) return;
      const player = room.players.find(p => p.id === playerId);
      broadcast(room, { type: 'chat', playerName: player ? player.name : '?', message: msg.message });
      return;
    }
  });

  ws.on('close', () => {
    const code = clientRooms.get(ws);
    if (code) {
      const room = rooms.get(code);
      if (room) {
        const player = room.players.find(p => p.id === playerId);
        if (player) {
          player.isConnected = false;
          player.ws = null;
          if (room.phase === 'playing' && room.players[room.currentPlayer]?.id === playerId) {
            advanceTurn(room);
            room.lastMove = null;
            broadcast(room, { type: 'game_update', state: playerState(room, p.id), yourTurn: room.players[room.currentPlayer]?.id === p.id });
          }
          broadcast(room, { type: 'player_disconnected', playerId, players: room.players.map(p => ({ id: p.id, name: p.name, isHost: p.isHost })) });
          // Check if all disconnected
          if (room.players.every(p => !p.isConnected)) {
            rooms.delete(code);
          }
        }
      }
      clientRooms.delete(ws);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Mille Bornes Online - Serveur démarré sur http://0.0.0.0:${PORT}`);
  console.log(`Partage cette URL avec tes amis pour jouer !`);
});
