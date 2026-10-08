import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

interface SessionState {
  sessions: Record<string, { playerId: string }>
  remember: (gameId: string, playerId: string) => void
  forget: (gameId: string) => void
}

export const useSessionStore = create<SessionState>()(persist((set) => ({
  sessions: {},
  remember: (gameId, playerId) => set(state => ({
    sessions: { ...state.sessions, [gameId]: { playerId } },
  })),
  forget: (gameId) => set(state => ({
    sessions: Object.fromEntries(Object.entries(state.sessions).filter(([id]) => id !== gameId)),
  })),
}), {
  name: 'golden-flower-session-v1',
  storage: createJSONStorage(() => sessionStorage),
  partialize: state => ({ sessions: state.sessions }),
}))
