# Vault Crew — Phase 4

Phase 4 adds run/lobby lifecycle, code-length validation, attempt broadcasts, code reveal, join-link/session behavior, and a test-safe server entry point.

## Run

```bash
npm install
npm start
```

The server listens on `PORT` or `2567`.

## Test

```bash
npm test
```

`server/index.ts` exports `createServer()` and does **not** listen when imported. `server/main.ts` is the production entry point.

## Join links

Open `/room/ABCD`. If this browser tab already has a saved session for that room, it reconnects automatically. Otherwise the room code is prefilled and the player is asked for a nickname before joining.

## Round lifecycle

A cracked vault returns the room to the lobby with the current run score preserved; the host starts the next vault. A failed vault ends the run and exposes the final score/code; the room remains joinable in the lobby and the host can Play again to reset the run.
