import type { Board, Hypothesis, HypothesisStatus, Pin } from '../../engine/board';

export type BoardAction =
  | { type: 'pin'; pin: Omit<Pin, 'x' | 'y' | 'rot'> }
  | { type: 'unpin'; pinId: string }
  | { type: 'move'; id: string; x: number; y: number }
  | { type: 'hypothesis'; hypothesis: Omit<Hypothesis, 'x' | 'y' | 'pins' | 'status'> }
  | { type: 'edit'; id: string; text: string; accuses: string | null }
  | { type: 'status'; id: string; status: HypothesisStatus }
  | { type: 'tie'; hypothesisId: string; pinId: string }
  | { type: 'reset'; board: Board };

// Slots on the glass, in board fractions: evidence fills the left panes, hypotheses the right.
const PIN_SLOTS: [number, number][] = [];
for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) PIN_SLOTS.push([0.015 + col * 0.158 + (row % 2) * 0.03, 0.05 + row * 0.24]);
const HYPOTHESIS_SLOTS: [number, number][] = [[0.69, 0.06], [0.69, 0.42], [0.825, 0.24], [0.825, 0.6]];

function freeSlot(taken: { x: number; y: number }[], slots: [number, number][]): [number, number] {
  const free = slots.find(([x, y]) => !taken.some((t) => Math.abs(t.x - x) < 0.06 && Math.abs(t.y - y) < 0.1));
  if (free) return free;
  const n = taken.length;
  return [0.04 + ((n * 0.071) % 0.55), 0.08 + ((n * 0.13) % 0.6)];
}

// Small deterministic tilt from the id, so a reload never reshuffles the board.
function tilt(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 50) - 25) / 10;
}

export function boardReducer(board: Board, action: BoardAction): Board {
  switch (action.type) {
    case 'pin': {
      if (board.pins.some((p) => p.id === action.pin.id)) return board;
      const [x, y] = freeSlot(board.pins, PIN_SLOTS);
      return { ...board, pins: [...board.pins, { ...action.pin, x, y, rot: tilt(action.pin.id) }] };
    }
    case 'unpin':
      return {
        pins: board.pins.filter((p) => p.id !== action.pinId),
        hypotheses: board.hypotheses.map((h) => ({ ...h, pins: h.pins.filter((id) => id !== action.pinId) })),
      };
    case 'move':
      return {
        pins: board.pins.map((p) => (p.id === action.id ? { ...p, x: action.x, y: action.y } : p)),
        hypotheses: board.hypotheses.map((h) => (h.id === action.id ? { ...h, x: action.x, y: action.y } : h)),
      };
    case 'hypothesis': {
      const [x, y] = freeSlot(board.hypotheses, HYPOTHESIS_SLOTS);
      return { ...board, hypotheses: [...board.hypotheses, { ...action.hypothesis, x, y, pins: [], status: 'open' }] };
    }
    case 'edit':
      return { ...board, hypotheses: board.hypotheses.map((h) => (h.id === action.id ? { ...h, text: action.text, accuses: action.accuses } : h)) };
    case 'status':
      return { ...board, hypotheses: board.hypotheses.map((h) => (h.id === action.id ? { ...h, status: action.status } : h)) };
    case 'tie':
      return {
        ...board,
        hypotheses: board.hypotheses.map((h) => {
          if (h.id !== action.hypothesisId) return h;
          const has = h.pins.includes(action.pinId);
          return { ...h, pins: has ? h.pins.filter((id) => id !== action.pinId) : [...h.pins, action.pinId] };
        }),
      };
    case 'reset':
      return action.board;
  }
}
